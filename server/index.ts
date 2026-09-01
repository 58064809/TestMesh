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
} from "./analysis.js";

const app = express();
const port = Number(process.env.PORT ?? 3000);
const isProduction = process.env.NODE_ENV === "production";

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

app.get("/api/health", (_request, response) => {
  response.json({
    ok: true,
    phase: "P01",
    model: MODEL,
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
  const isUploadError = error instanceof multer.MulterError || message.startsWith("不支持的文件格式");
  const status = isUploadError ? 400 : 502;
  response.status(status).json({
    error: isUploadError ? message : `OpenAI Responses API 分析失败：${message}`,
  });
};

app.use(errorHandler);

app.listen(port, () => {
  console.log(`TestMesh P01 running at http://localhost:${port}`);
});
