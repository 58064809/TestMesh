import express, { type ErrorRequestHandler } from "express";
import multer from "multer";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer as createViteServer } from "vite";
import {
  MAX_FILE_BYTES,
  MAX_FILES,
  MODEL,
  analyzeRequirement,
  createSources,
  isAcceptedFilename,
  normalizeUploadFilename,
} from "./analysis.js";
import { MAX_OPENAPI_BYTES, parseHeaderLines, parseOpenApi, validateTargetBaseUrl } from "./openapi.js";
import { SCHEMATHESIS_VERSION, runSchemathesis, type RunnerAuth } from "./schemathesis.js";
import {
  OPENHANDS_AGENT_SERVER_IMAGE,
  OPENHANDS_CLIENT_VERSION,
  OPENHANDS_MODEL,
  inspectRepository,
  listDockerContainers,
  startEngineeringTask,
  stopEngineeringTask,
} from "./openhands.js";
import { PLAYWRIGHT_IMAGE, PLAYWRIGHT_VERSION, runPlaywrightTest } from "./playwright.js";
import {
  APPIUM_VERSION,
  UIAUTOMATOR2_VERSION,
  WDIO_VERSION,
  runAndroidTest,
} from "./android.js";
import { DomainStore, defaultDatabasePath } from "./store.js";

const app = express();
const port = Number(process.env.PORT ?? 3000);
const isProduction = process.env.NODE_ENV === "production";
const store = new DomainStore(defaultDatabasePath());

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

app.get("/api/health", (_request, response) => {
  response.json({
    ok: true,
    phase: "P04-B",
    model: MODEL,
    schemathesisVersion: SCHEMATHESIS_VERSION,
    openhandsModel: OPENHANDS_MODEL,
    openhandsAgentServerImage: OPENHANDS_AGENT_SERVER_IMAGE,
    openhandsClientVersion: OPENHANDS_CLIENT_VERSION,
    playwrightVersion: PLAYWRIGHT_VERSION,
    playwrightImage: PLAYWRIGHT_IMAGE,
    appiumVersion: APPIUM_VERSION,
    uiautomator2Version: UIAUTOMATOR2_VERSION,
    webdriverioVersion: WDIO_VERSION,
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
      const analysis = await analyzeRequirement(message, sources, apiKey);
      const analysisId = store.saveAnalysis(analysis.result, MODEL);
      response.json({
        ...analysis,
        analysisId,
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

app.get("/api/p03/docker/containers", async (_request, response) => {
  try {
    response.json(await listDockerContainers());
  } catch (error) {
    const message = error instanceof Error ? error.message : "Docker 容器读取失败";
    response.status(502).json({ error: `Docker 上下文读取失败，流程已停止：${message}` });
  }
});

app.get("/api/p03/tasks", (_request, response) => {
  response.json(store.listEngineeringTasks());
});

app.get("/api/p03/tasks/:id", (request, response) => {
  try {
    response.json(store.getEngineeringTask(request.params.id));
  } catch (error) {
    const message = error instanceof Error ? error.message : "工程任务不存在";
    response.status(404).json({ error: message });
  }
});

app.post("/api/p03/tasks", async (request, response) => {
  try {
    const selectedFiles = Array.isArray(request.body.selectedFiles)
      ? request.body.selectedFiles.filter((item: unknown): item is string => typeof item === "string")
      : [];
    const task = await startEngineeringTask(
      {
        repoPath: typeof request.body.repoPath === "string" ? request.body.repoPath : "",
        instruction: typeof request.body.instruction === "string" ? request.body.instruction : "",
        selectedFiles,
        logContext: typeof request.body.logContext === "string" ? request.body.logContext : "",
        dockerContainerId:
          typeof request.body.dockerContainerId === "string" ? request.body.dockerContainerId : "",
        authorized: request.body.authorized === true,
      },
      store,
    );
    response.status(202).json(task);
  } catch (error) {
    const message = error instanceof Error ? error.message : "工程任务启动失败";
    response.status(400).json({ error: `OpenHands 工程任务未启动：${message}` });
  }
});

app.post("/api/p03/tasks/:id/stop", async (request, response) => {
  try {
    await stopEngineeringTask(request.params.id);
    response.status(202).json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "工程任务停止失败";
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
  const status = isUploadError ? 400 : 502;
  response.status(status).json({
    error: isUploadError ? message : `OpenAI Responses API 分析失败：${message}`,
  });
};

app.use(errorHandler);

app.listen(port, () => {
  console.log(`TestMesh P04-B running at http://localhost:${port}`);
});
