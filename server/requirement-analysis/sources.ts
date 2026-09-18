import { tool, type ClientTool } from "@langchain/core/tools";
import path from "node:path";
import { z } from "zod";

export const MAX_FILES = 6;
export const MAX_FILE_BYTES = 8 * 1024 * 1024;
export const PDF_PAGE_LOCATOR_PATTERN = /(?:第\s*)?\d+\s*页|页码\s*(?:第\s*)?\d+(?:\s*页)?|[Pp](?:age)?\.?\s*\d+|^\s*\d+(?:\s*-\s*\d+)?\s*$/;

const TEXT_EXTENSIONS = new Set([".txt", ".md", ".json", ".html", ".xml"]);
const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);
const DOCUMENT_EXTENSIONS = new Set([".pdf", ".doc", ".docx", ".rtf", ".odt", ".ppt", ".pptx"]);

export const ACCEPTED_EXTENSIONS = new Set([
  ...TEXT_EXTENSIONS,
  ...IMAGE_EXTENSIONS,
  ...DOCUMENT_EXTENSIONS,
]);

export type SourceScope = "attachment" | "knowledge";
export type LocationCapability = "page" | "paragraph" | "image" | "limited";

export interface SourceFile {
  id: string;
  name: string;
  mimeType: string;
  buffer: Buffer;
  scope: SourceScope;
  capability: LocationCapability;
  capabilityNote: string;
}

export interface UploadLike {
  originalname: string;
  mimetype: string;
  buffer: Buffer;
}

export type SourceInputContent =
  | { type: "input_text"; text: string }
  | { type: "input_image"; image_url: string; detail: "high" }
  | { type: "input_file"; filename: string; file_data: string; detail?: "high" };

export type RequirementSourceContentBlock =
  | { type: "text"; text: string }
  | {
    type: "image";
    data: string;
    mimeType: string;
    metadata: { sourceFileId: string; filename: string; detail: "high" };
  }
  | {
    type: "file";
    data: string;
    mimeType: string;
    metadata: { sourceFileId: string; filename: string; detail?: "high" };
  };

export function extensionOf(filename: string): string {
  return path.extname(filename).toLowerCase();
}

export function isAcceptedFilename(filename: string): boolean {
  return ACCEPTED_EXTENSIONS.has(extensionOf(filename));
}

export function normalizeUploadFilename(filename: string): string {
  if (Buffer.byteLength(filename, "utf8") === filename.length || [...filename].some((character) => character.codePointAt(0)! > 0xff)) {
    return filename;
  }

  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(Buffer.from(filename, "latin1"));
  } catch {
    return filename;
  }
}

function normalizedMime(file: UploadLike): string {
  const ext = extensionOf(file.originalname);
  const byExtension: Record<string, string> = {
    ".pdf": "application/pdf",
    ".txt": "text/plain",
    ".md": "text/markdown",
    ".json": "application/json",
    ".html": "text/html",
    ".xml": "application/xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".doc": "application/msword",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".rtf": "application/rtf",
    ".odt": "application/vnd.oasis.opendocument.text",
    ".ppt": "application/vnd.ms-powerpoint",
    ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  };

  return byExtension[ext] ?? file.mimetype ?? "application/octet-stream";
}

export function locationCapability(filename: string): {
  capability: LocationCapability;
  note: string;
} {
  const ext = extensionOf(filename);
  if (ext === ".pdf") {
    return { capability: "page", note: "PDF 同时输入抽取文本与页面图像；正文按页定位，嵌入图可使用图片定位并注明页码。" };
  }
  if (TEXT_EXTENSIONS.has(ext)) {
    return { capability: "paragraph", note: "文本已在发送前加入稳定段落编号。" };
  }
  if (IMAGE_EXTENSIONS.has(ext)) {
    return { capability: "image", note: "原文可定位到整张上传图片。" };
  }
  return {
    capability: "limited",
    note: "该格式只能抽取文本，无法可靠定位页码，且嵌入图片不会进入模型上下文；请转为 PDF 或单独上传图片。",
  };
}

export function createSources(attachments: UploadLike[], knowledge: UploadLike[]): SourceFile[] {
  const scoped = [
    ...attachments.map((file) => ({ file, scope: "attachment" as const, prefix: "ATT" })),
    ...knowledge.map((file) => ({ file, scope: "knowledge" as const, prefix: "KNOW" })),
  ];
  const counters: Record<SourceScope, number> = { attachment: 0, knowledge: 0 };

  return scoped.map(({ file, scope, prefix }) => {
    counters[scope] += 1;
    const name = normalizeUploadFilename(file.originalname);
    const location = locationCapability(name);
    return {
      id: `${prefix}-${counters[scope]}`,
      name,
      mimeType: normalizedMime(file),
      buffer: file.buffer,
      scope,
      capability: location.capability,
      capabilityNote: location.note,
    };
  });
}

export function formatTextWithParagraphs(source: SourceFile): string {
  const decoded = source.buffer.toString("utf8").trim();
  const paragraphs = decoded.split(/(?:\r?\n){2,}/).filter((part) => part.trim().length > 0);
  return paragraphs
    .map((paragraph, index) => `【${source.id} 段落 ${index + 1}】\n${paragraph.trim()}`)
    .join("\n\n");
}

export function sourceCatalog(sources: SourceFile[]): string {
  return sources
    .map((source) => `- ${source.id} | ${source.name} | 范围=${source.scope} | 定位能力=${source.capability} | ${source.capabilityNote}`)
    .join("\n");
}

function assertUniqueSources(sources: SourceFile[]): Map<string, SourceFile> {
  const byId = new Map<string, SourceFile>();
  for (const source of sources) {
    if (byId.has(source.id)) throw new Error(`来源文件 ID 重复：${source.id}`);
    byId.set(source.id, source);
  }
  return byId;
}

export function validateSourceLocator(
  source: SourceFile,
  locatorType: LocationCapability,
  locator: string,
): void {
  if (source.capability === "limited" && locatorType !== "limited") {
    throw new Error(`来源文件 ${source.id} 为定位受限格式，不能使用 ${locatorType}`);
  }
  const isPdfImage = source.capability === "page" && locatorType === "image";
  if (locatorType !== source.capability && !isPdfImage && source.capability !== "limited") {
    throw new Error(`来源文件 ${source.id} 的定位类型 ${locatorType} 与文件定位能力 ${source.capability} 不一致`);
  }
  if (isPdfImage && !PDF_PAGE_LOCATOR_PATTERN.test(locator)) {
    throw new Error(`来源文件 ${source.id} 的 PDF 图片定位没有可核对的页码：${locator || "（空）"}`);
  }
  if (source.capability === "page" && locatorType === "page" && !PDF_PAGE_LOCATOR_PATTERN.test(locator)) {
    throw new Error(`来源文件 ${source.id} 的 PDF 页码定位没有可核对的页码：${locator || "（空）"}`);
  }
}

export function buildSourceInput(message: string, sources: SourceFile[]): SourceInputContent[] {
  assertUniqueSources(sources);
  const content: SourceInputContent[] = [{
    type: "input_text",
    text: [`用户请求：${message}`, "", "来源目录：", sourceCatalog(sources)].join("\n"),
  }];

  for (const source of sources) {
    const extension = extensionOf(source.name);
    if (TEXT_EXTENSIONS.has(extension)) {
      content.push({
        type: "input_text",
        text: `以下是来源 ${source.id}（${source.name}）的带编号正文：\n\n${formatTextWithParagraphs(source)}`,
      });
      continue;
    }
    const dataUrl = `data:${source.mimeType};base64,${source.buffer.toString("base64")}`;
    content.push({
      type: "input_text",
      text: `紧接着的视觉或文件输入来自来源 ${source.id}（${source.name}）。请只把对它的观察关联到该来源；跨来源判断分别保留引用。`,
    });
    if (IMAGE_EXTENSIONS.has(extension)) {
      content.push({ type: "input_image", image_url: dataUrl, detail: "high" });
    } else {
      content.push({
        type: "input_file",
        filename: source.name,
        file_data: dataUrl,
        ...(extension === ".pdf" ? { detail: "high" as const } : {}),
      });
    }
  }
  return content;
}

export function buildRequirementSourceContent(
  message: string,
  sources: SourceFile[],
): RequirementSourceContentBlock[] {
  assertUniqueSources(sources);
  const blocks: RequirementSourceContentBlock[] = [{
    type: "text",
    text: [`用户请求：${message}`, "", "来源目录：", sourceCatalog(sources)].join("\n"),
  }];
  for (const source of sources) {
    const extension = extensionOf(source.name);
    if (TEXT_EXTENSIONS.has(extension)) {
      blocks.push({
        type: "text",
        text: `以下是来源 ${source.id}（${source.name}）的带编号正文：\n\n${formatTextWithParagraphs(source)}`,
      });
    } else if (IMAGE_EXTENSIONS.has(extension)) {
      blocks.push({
        type: "text",
        text: `紧接着的图片来自来源 ${source.id}（${source.name}）。`,
      }, {
        type: "image",
        data: source.buffer.toString("base64"),
        mimeType: source.mimeType,
        metadata: { sourceFileId: source.id, filename: source.name, detail: "high" },
      });
    } else {
      blocks.push({
        type: "text",
        text: `紧接着的文件来自来源 ${source.id}（${source.name}）。`,
      }, {
        type: "file",
        data: source.buffer.toString("base64"),
        mimeType: source.mimeType,
        metadata: {
          sourceFileId: source.id,
          filename: source.name,
          ...(extension === ".pdf" ? { detail: "high" as const } : {}),
        },
      });
    }
  }
  return blocks;
}

export function createRequirementSourceTools(sources: SourceFile[]): ClientTool[] {
  const byId = assertUniqueSources(sources);
  const sourceIdSchema = z.object({ source_file_id: z.string().min(1) });

  const readSource = tool(({ source_file_id }) => {
    const source = byId.get(source_file_id);
    if (!source) throw new Error(`当前任务不存在来源文件：${source_file_id}`);
    return JSON.stringify({
      source_file_id: source.id,
      filename: source.name,
      mime_type: source.mimeType,
      scope: source.scope,
      capability: source.capability,
      content: source.capability === "paragraph" ? formatTextWithParagraphs(source) : null,
      multimodal_context: source.capability !== "paragraph",
      note: source.capabilityNote,
    });
  }, {
    name: "read_source",
    description: "读取当前需求分析任务中的一个来源。文本返回带段落编号正文；图片和文件已作为本次多模态上下文提供，不返回原始字节。",
    schema: sourceIdSchema,
  });

  const locateSource = tool(({ source_file_id }) => {
    const source = byId.get(source_file_id);
    if (!source) throw new Error(`当前任务不存在来源文件：${source_file_id}`);
    return JSON.stringify({
      source_file_id: source.id,
      locator_type: source.capability,
      locator_rule: source.capabilityNote,
      pdf_image_allowed: source.capability === "page",
    });
  }, {
    name: "locate_source",
    description: "查询来源支持的页码、段落、图片或定位受限规则。",
    schema: sourceIdSchema,
  });

  const validateReference = tool(({ source_file_id, locator_type, locator }) => {
    const source = byId.get(source_file_id);
    if (!source) throw new Error(`当前任务不存在来源文件：${source_file_id}`);
    validateSourceLocator(source, locator_type, locator);
    return JSON.stringify({ valid: true, source_file_id, locator_type, locator });
  }, {
    name: "validate_reference",
    description: "校验来源文件、定位类型与定位值是否可核对。",
    schema: z.object({
      source_file_id: z.string().min(1),
      locator_type: z.enum(["page", "paragraph", "image", "limited"]),
      locator: z.string(),
    }),
  });

  return [readSource, locateSource, validateReference];
}
