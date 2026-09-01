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
import { DomainStore, defaultDatabasePath } from "./store.js";

const app = express();
const port = Number(process.env.PORT ?? 3000);
const isProduction = process.env.NODE_ENV === "production";
const store = new DomainStore(defaultDatabasePath());

app.use(express.json({ limit: "64kb" }));

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
    phase: "P02",
    model: MODEL,
    schemathesisVersion: SCHEMATHESIS_VERSION,
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
  console.log(`TestMesh P02 running at http://localhost:${port}`);
});
