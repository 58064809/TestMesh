import express, { type ErrorRequestHandler } from "express";
import multer from "multer";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer as createViteServer } from "vite";
import {
  MAX_FILE_BYTES,
  MAX_FILES,
  MODEL,
  RequirementAnalysisValidationError,
  createSources,
  isAcceptedFilename,
  normalizeUploadFilename,
} from "./analysis.js";
import { MAX_OPENAPI_BYTES, parseHeaderLines, parseOpenApi, validateTargetBaseUrl } from "./openapi.js";
import { SCHEMATHESIS_VERSION, runSchemathesis, type RunnerAuth } from "./schemathesis.js";
import { inspectRepository } from "./repository.js";
import { PLAYWRIGHT_IMAGE, PLAYWRIGHT_VERSION, runPlaywrightTest } from "./playwright.js";
import {
  APPIUM_VERSION,
  UIAUTOMATOR2_VERSION,
  WDIO_VERSION,
  runAndroidTest,
} from "./android.js";
import { K6_VERSION, runK6Test } from "./k6.js";
import { ZAP_VERSION, runZapBaseline } from "./zap.js";
import { DomainStore, defaultDatabasePath } from "./store.js";
import { createHarnessPostgresResources } from "./harness/postgres.js";
import {
  RequirementAnalysisCompletionError,
  RequirementAnalysisRuntime,
} from "./requirement-analysis/runtime.js";
import { z } from "zod";

const app = express();
const port = Number(process.env.PORT ?? 3000);
const isProduction = process.env.NODE_ENV === "production";
const store = new DomainStore(defaultDatabasePath());
const harnessResources = await createHarnessPostgresResources();
const requirementAnalysisStore = harnessResources.requirementAnalysisStore;
const requirementAnalysisRuntime = new RequirementAnalysisRuntime(harnessResources);

app.use(express.json({ limit: "256kb" }));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_FILE_BYTES,
    files: MAX_FILES,
  },
  fileFilter: (_request, file, callback) => {
    if (!isAcceptedFilename(file.originalname)) {
      callback(new Error(`不支持的文件格式：${file.originalname}`));
      return;
    }
    callback(null, true);
  },
});

const openApiUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_OPENAPI_BYTES, files: 1 },
  fileFilter: (_request, file, callback) => {
    if (!/\.(json|ya?ml)$/i.test(file.originalname)) {
      callback(new Error(`OpenAPI 只支持 JSON/YAML：${file.originalname}`));
      return;
    }
    callback(null, true);
  },
});

const baselineUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_BYTES, files: 1 },
  fileFilter: (_request, file, callback) => {
    if (!/\.(pdf|docx?|rtf|odt|md|txt|html?)$/i.test(file.originalname)) {
      callback(new Error(`获批 PRD 只接受 PDF、Word、RTF、ODT、Markdown、TXT 或 HTML：${file.originalname}`));
      return;
    }
    callback(null, true);
  },
});

const AnalysisReviewInputSchema = z.object({
  status: z.enum(["accepted", "rejected", "merged", "clarify"]),
  reviewer: z.string().default(""),
  reason: z.string().default(""),
  issueType: z.union([z.enum(["missing", "ambiguity", "conflict"]), z.literal("")]).default(""),
  mergeInto: z.string().default(""),
  decision: z.string().default(""),
  decisionBy: z.string().default(""),
  prdRevision: z.string().default(""),
}).strict();

app.get("/api/health", (_request, response) => {
  response.json({
    ok: true,
    phase: "RA01 Requirement Analysis",
    model: MODEL,
    schemathesisVersion: SCHEMATHESIS_VERSION,
    playwrightVersion: PLAYWRIGHT_VERSION,
    playwrightImage: PLAYWRIGHT_IMAGE,
    appiumVersion: APPIUM_VERSION,
    uiautomator2Version: UIAUTOMATOR2_VERSION,
    webdriverioVersion: WDIO_VERSION,
    k6Version: K6_VERSION,
    zapVersion: ZAP_VERSION,
    openaiConfigured: Boolean(process.env.OPENAI_API_KEY),
  });
});

app.post(
  "/api/analyze",
  upload.fields([
    { name: "attachments", maxCount: MAX_FILES },
    { name: "knowledge", maxCount: MAX_FILES },
  ]),
  async (request, response, next) => {
    try {
      const message = typeof request.body.message === "string" ? request.body.message.trim() : "";
      if (!message) {
        response.status(400).json({ error: "请输入分析指令" });
        return;
      }

      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) {
        response.status(503).json({ error: "服务端未配置 OPENAI_API_KEY，分析已停止" });
        return;
      }

      const files = (request.files ?? {}) as Record<string, Express.Multer.File[]>;
      const attachments = files.attachments ?? [];
      const knowledge = files.knowledge ?? [];
      if (attachments.length + knowledge.length > MAX_FILES) {
        response.status(400).json({ error: `单次最多上传 ${MAX_FILES} 个文件` });
        return;
      }

      const sources = createSources(attachments, knowledge);
      const analysis = await requirementAnalysisRuntime.start({
        message,
        sources,
        apiKey,
      });
      response.json({
        ...analysis,
        model: MODEL,
        sources: sources.map((source) => ({
          id: source.id,
          name: source.name,
          mimeType: source.mimeType,
          scope: source.scope,
          capability: source.capability,
          capabilityNote: source.capabilityNote,
        })),
      });
    } catch (error) {
      next(error);
    }
  },
);

app.get("/api/p02/trace-sources", (_request, response) => {
  response.json(store.listTraceSources());
});

app.get("/api/analyses", (_request, response) => {
  void requirementAnalysisStore.listAnalyses()
    .then((records) => response.json(records.map((record) => ({ ...record, protocol: "current" }))))
    .catch((error) => response.status(500).json({ error: error instanceof Error ? error.message : "无法读取分析列表" }));
});

app.get("/api/analyses/:id", async (request, response) => {
  try {
    const { document } = await requirementAnalysisStore.getAnalysis(request.params.id);
    response.json(document);
  } catch (error) {
    const message = error instanceof Error ? error.message : "分析结果不存在";
    response.status(404).json({ error: message });
  }
});

app.get("/api/analyses/:id/reviews", async (request, response) => {
  try {
    response.json(await requirementAnalysisStore.listReviews(request.params.id));
  } catch (error) {
    response.status(404).json({ error: error instanceof Error ? error.message : "分析结果不存在" });
  }
});

app.get("/api/analyses/:id/reviews/:itemId/history", async (request, response) => {
  try {
    response.json(await requirementAnalysisStore.listReviewHistory(request.params.id, request.params.itemId));
  } catch (error) {
    response.status(404).json({ error: error instanceof Error ? error.message : "评审历史不存在" });
  }
});

app.get("/api/analyses/:id/source-files", async (request, response) => {
  try {
    response.json(await requirementAnalysisStore.listSourceFiles(request.params.id));
  } catch (error) {
    response.status(404).json({ error: error instanceof Error ? error.message : "原文件目录不存在" });
  }
});

app.get("/api/analyses/:id/source-files/:sourceFileId", async (request, response) => {
  try {
    const source = await requirementAnalysisStore.getSourceFile(request.params.id, request.params.sourceFileId);
    response.type(source.mimeType);
    response.setHeader("Content-Disposition", source.mimeType === "application/pdf" || source.mimeType.startsWith("image/") ? "inline" : "attachment");
    response.send(source.file);
  } catch (error) {
    response.status(404).json({ error: error instanceof Error ? error.message : "原始来源文件不存在" });
  }
});

app.put("/api/analyses/:id/reviews/:itemId", async (request, response) => {
  try {
    const parsed = AnalysisReviewInputSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: "评审信息不完整或格式不正确" });
      return;
    }
    response.json(await requirementAnalysisStore.recordReview(request.params.id, request.params.itemId, parsed.data));
  } catch (error) {
    response.status(400).json({ error: error instanceof Error ? error.message : "评审记录无效" });
  }
});

app.get("/api/requirement-baselines", (_request, response) => {
  void requirementAnalysisStore.listBaselines()
    .then((records) => response.json(records))
    .catch((error) => response.status(500).json({ error: error instanceof Error ? error.message : "无法读取需求基线" }));
});

app.post("/api/analyses/:id/baselines", baselineUpload.single("reviewedPrd"), async (request, response) => {
  try {
    const file = request.file;
    if (!file) throw new Error("请上传评审后的 PRD 文件");
    const record = await requirementAnalysisRuntime.createBaselineAndResume(String(request.params.id), {
      prdRevision: String(request.body.prdRevision ?? ""),
      approvedBy: String(request.body.approvedBy ?? ""),
      previousBaselineId: request.body.previousBaselineId ? String(request.body.previousBaselineId) : null,
      prdFilename: normalizeUploadFilename(file.originalname),
      prdFile: file.buffer,
    });
    response.status(201).json(record);
  } catch (error) {
    response.status(409).json({ error: error instanceof Error ? error.message : "无法建立需求基线" });
  }
});

app.get("/api/requirement-baselines/:id", async (request, response) => {
  try {
    const { record, snapshot } = await requirementAnalysisStore.getBaseline(request.params.id);
    response.json({ ...record, snapshot });
  } catch (error) {
    response.status(404).json({ error: error instanceof Error ? error.message : "需求基线不存在" });
  }
});

app.get("/api/requirement-baselines/:id/prd", async (request, response) => {
  try {
    const { record, file } = await requirementAnalysisStore.getBaseline(request.params.id);
    response.attachment(record.prdFilename);
    response.send(file);
  } catch (error) {
    response.status(404).json({ error: error instanceof Error ? error.message : "需求基线不存在" });
  }
});

app.post("/api/p02/openapi", openApiUpload.single("spec"), (request, response) => {
  try {
    if (!request.file) {
      response.status(400).json({ error: "请选择 OpenAPI JSON/YAML 文件" });
      return;
    }
    const filename = normalizeUploadFilename(request.file.originalname);
    const content = request.file.buffer.toString("utf8");
    const parsed = parseOpenApi(content);
    response.json(
      store.createOpenApiSpec({
        name: parsed.name,
        version: parsed.version,
        filename,
        content,
        operations: parsed.operations,
      }),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "OpenAPI 导入失败";
    response.status(400).json({ error: message });
  }
});

app.put("/api/p02/test-cases/:id/links", (request, response) => {
  try {
    const requirementIds = Array.isArray(request.body.requirementIds)
      ? request.body.requirementIds.filter((item: unknown): item is string => typeof item === "string")
      : [];
    const evidenceIds = Array.isArray(request.body.evidenceIds)
      ? request.body.evidenceIds.filter((item: unknown): item is string => typeof item === "string")
      : [];
    store.updateTestCaseLinks(request.params.id, requirementIds, evidenceIds);
    response.status(204).end();
  } catch (error) {
    const message = error instanceof Error ? error.message : "追溯关系保存失败";
    response.status(400).json({ error: message });
  }
});

app.post("/api/p02/test-runs", async (request, response) => {
  try {
    const specId = typeof request.body.specId === "string" ? request.body.specId : "";
    const targetBaseUrl = validateTargetBaseUrl(
      typeof request.body.targetBaseUrl === "string" ? request.body.targetBaseUrl : "",
    );
    const headers = parseHeaderLines(request.body.headers);
    const rawAuth = request.body.auth;
    const auth: RunnerAuth =
      rawAuth && typeof rawAuth === "object"
        ? {
            type:
              rawAuth.type === "bearer" || rawAuth.type === "basic" ? rawAuth.type : "none",
            token: typeof rawAuth.token === "string" ? rawAuth.token : undefined,
            username: typeof rawAuth.username === "string" ? rawAuth.username : undefined,
            password: typeof rawAuth.password === "string" ? rawAuth.password : undefined,
          }
        : { type: "none" };
    const run = await runSchemathesis({ specId, targetBaseUrl, headers, auth }, store);
    response.status(run.status === "error" ? 502 : 200).json(run);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Schemathesis 运行失败";
    response.status(502).json({ error: `Schemathesis 运行失败，流程已停止：${message}` });
  }
});

app.post("/api/p03/repository/inspect", async (request, response) => {
  try {
    const repoPath = typeof request.body.repoPath === "string" ? request.body.repoPath : "";
    response.json(await inspectRepository(repoPath));
  } catch (error) {
    const message = error instanceof Error ? error.message : "仓库检查失败";
    response.status(400).json({ error: message });
  }
});

app.get("/api/p04/ui-runs", (_request, response) => {
  response.json(store.listUiTestRuns());
});

app.get("/api/p04/ui-runs/:id", (request, response) => {
  try {
    response.json(store.getUiTestRun(request.params.id));
  } catch (error) {
    response.status(404).json({ error: error instanceof Error ? error.message : "UI TestRun 不存在" });
  }
});

app.post("/api/p04/ui-runs", async (request, response) => {
  try {
    const run = await runPlaywrightTest(
      {
        repoPath: typeof request.body.repoPath === "string" ? request.body.repoPath : "",
        testFile: typeof request.body.testFile === "string" ? request.body.testFile : "",
        authorized: request.body.authorized === true,
      },
      store,
    );
    response.json(run);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Playwright UI 测试未启动";
    response.status(400).json({ error: `Playwright UI 测试未启动：${message}` });
  }
});

app.get("/api/p04/ui-runs/:id/artifacts/:artifactId", (request, response) => {
  try {
    const artifact = store.getUiTestArtifact(request.params.id, request.params.artifactId);
    response.download(artifact.path, artifact.name);
  } catch (error) {
    response.status(404).json({ error: error instanceof Error ? error.message : "Trace Evidence 不存在" });
  }
});

app.get("/api/p04/android-runs", (_request, response) => {
  response.json(store.listAndroidTestRuns());
});

app.get("/api/p04/android-runs/:id", (request, response) => {
  try {
    response.json(store.getAndroidTestRun(request.params.id));
  } catch (error) {
    response.status(404).json({ error: error instanceof Error ? error.message : "Android TestRun 不存在" });
  }
});

app.post("/api/p04/android-runs", async (request, response) => {
  try {
    const run = await runAndroidTest(
      {
        repoPath: typeof request.body.repoPath === "string" ? request.body.repoPath : "",
        configFile: typeof request.body.configFile === "string" ? request.body.configFile : "",
        testFile: typeof request.body.testFile === "string" ? request.body.testFile : "",
        authorized: request.body.authorized === true,
      },
      store,
    );
    response.json(run);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Android Emulator 测试未启动";
    response.status(400).json({ error: `Android Emulator 测试未启动：${message}` });
  }
});

app.get("/api/p04/android-runs/:id/artifacts/:artifactId", (request, response) => {
  try {
    const artifact = store.getAndroidTestArtifact(request.params.id, request.params.artifactId);
    response.download(artifact.path, artifact.name);
  } catch (error) {
    response.status(404).json({ error: error instanceof Error ? error.message : "Android Evidence 不存在" });
  }
});

app.get("/api/p04/performance-runs", (_request, response) => {
  response.json(store.listPerformanceTestRuns());
});

app.get("/api/p04/performance-runs/:id", (request, response) => {
  try {
    response.json(store.getPerformanceTestRun(request.params.id));
  } catch (error) {
    response.status(404).json({ error: error instanceof Error ? error.message : "性能 TestRun 不存在" });
  }
});

app.post("/api/p04/performance-runs", async (request, response) => {
  try {
    const run = await runK6Test(
      {
        repoPath: typeof request.body.repoPath === "string" ? request.body.repoPath : "",
        scriptFile: typeof request.body.scriptFile === "string" ? request.body.scriptFile : "",
        authorized: request.body.authorized === true,
      },
      store,
    );
    response.json(run);
  } catch (error) {
    const message = error instanceof Error ? error.message : "k6 性能测试未启动";
    response.status(400).json({ error: `k6 性能测试未启动：${message}` });
  }
});

app.get("/api/p04/performance-runs/:id/artifacts/:artifactId", (request, response) => {
  try {
    const artifact = store.getPerformanceTestArtifact(request.params.id, request.params.artifactId);
    response.download(artifact.path, artifact.name);
  } catch (error) {
    response.status(404).json({ error: error instanceof Error ? error.message : "性能测试 Evidence 不存在" });
  }
});

app.get("/api/p04/security-runs", (_request, response) => {
  response.json(store.listSecurityTestRuns());
});

app.get("/api/p04/security-runs/:id", (request, response) => {
  try {
    response.json(store.getSecurityTestRun(request.params.id));
  } catch (error) {
    response.status(404).json({ error: error instanceof Error ? error.message : "安全 TestRun 不存在" });
  }
});

app.post("/api/p04/security-runs", async (request, response) => {
  try {
    const run = await runZapBaseline(
      {
        targetUrl: typeof request.body.targetUrl === "string" ? request.body.targetUrl : "",
        authorized: request.body.authorized === true,
      },
      store,
    );
    response.json(run);
  } catch (error) {
    const message = error instanceof Error ? error.message : "ZAP 安全测试未启动";
    response.status(400).json({ error: `ZAP 安全测试未启动：${message}` });
  }
});

app.get("/api/p04/security-runs/:id/artifacts/:artifactId", (request, response) => {
  try {
    const artifact = store.getSecurityTestArtifact(request.params.id, request.params.artifactId);
    response.download(artifact.path, artifact.name);
  } catch (error) {
    response.status(404).json({ error: error instanceof Error ? error.message : "安全测试 Evidence 不存在" });
  }
});

if (isProduction) {
  const serverDir = path.dirname(fileURLToPath(import.meta.url));
  const clientDir = path.resolve(serverDir, "../client");
  app.use(express.static(clientDir));
  app.use((request, response, next) => {
    if (request.path.startsWith("/api/")) {
      next();
      return;
    }
    response.sendFile(path.join(clientDir, "index.html"));
  });
} else {
  const vite = await createViteServer({
    server: { middlewareMode: true },
    appType: "spa",
  });
  app.use(vite.middlewares);
}

const errorHandler: ErrorRequestHandler = (error, _request, response, _next) => {
  void _next;
  const message = error instanceof Error ? error.message : "未知错误";
  const isUploadError =
    error instanceof multer.MulterError ||
    message.startsWith("不支持的文件格式") ||
    message.startsWith("OpenAPI 只支持");
  const isAnalysisValidation = error instanceof RequirementAnalysisValidationError;
  const isCompletionFailure = error instanceof RequirementAnalysisCompletionError;
  const status = isUploadError ? 400 : isAnalysisValidation || isCompletionFailure ? 422 : 502;
  response.status(status).json({
    error: isUploadError
      ? message
      : isAnalysisValidation || isCompletionFailure
        ? `需求分析结构、来源或完成条件校验失败：${message}`
        : `需求分析运行失败：${message}`,
  });
};

app.use(errorHandler);

app.listen(port, () => {
  console.log(`TestMesh 需求分析运行中：http://localhost:${port}`);
});
