import { tool, type ClientTool } from "@langchain/core/tools";
import path from "node:path";
import { z } from "zod";
import type { DoclingParseResult } from "../document-parsing/docling.js";

export const MAX_FILES = 6;
export const MAX_FILE_BYTES = 8 * 1024 * 1024;
export const PDF_PAGE_LOCATOR_PATTERN = /(?:第\s*)?\d+\s*页|页码\s*(?:第\s*)?\d+(?:\s*页)?|[Pp](?:age)?\.?\s*\d+|^\s*\d+(?:\s*-\s*\d+)?\s*$/;

const TEXT_EXTENSIONS = new Set([".txt", ".md", ".json", ".xml"]);
const DOCUMENT_EXTENSIONS = new Set([
  ".pdf", ".docx", ".odt", ".pptx",
  ".xlsx", ".ods", ".csv", ".html", ".htm",
  ".png", ".jpg", ".jpeg", ".webp", ".tif", ".tiff", ".bmp",
]);

export const ACCEPTED_EXTENSIONS = new Set([
  ...TEXT_EXTENSIONS,
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
  parser?: "native-text" | "docling";
  parsed?: DoclingParseResult;
}

export interface UploadLike {
  originalname: string;
  mimetype: string;
  buffer: Buffer;
}

export type SourceInputContent = { type: "input_text"; text: string };

export type RequirementSourceContentBlock = { type: "text"; text: string };

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
    ".csv": "text/csv",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".tif": "image/tiff",
    ".tiff": "image/tiff",
    ".bmp": "image/bmp",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".odt": "application/vnd.oasis.opendocument.text",
    ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".ods": "application/vnd.oasis.opendocument.spreadsheet",
  };

  return byExtension[ext] ?? file.mimetype ?? "application/octet-stream";
}

export function locationCapability(filename: string): {
  capability: LocationCapability;
  note: string;
} {
  const ext = extensionOf(filename);
  if (TEXT_EXTENSIONS.has(ext)) {
    return { capability: "paragraph", note: "纯文本将在发送前加入稳定段落编号。" };
  }
  return {
    capability: "limited",
    note: "等待 Docling 完成 OCR、表格与版面解析后确定引用定位能力。",
  };
}

export function requiresDocumentParser(filename: string): boolean {
  return !TEXT_EXTENSIONS.has(extensionOf(filename));
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
      parser: TEXT_EXTENSIONS.has(extensionOf(name)) ? "native-text" : undefined,
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

export function formattedSourceContent(source: SourceFile): string {
  if (source.parser !== "docling" || !source.parsed) return formatTextWithParagraphs(source);
  return source.parsed.elements.map((element, index) => {
    const locator = source.capability === "page" && element.pageNumbers.length > 0
      ? `页码 ${element.pageNumbers.join("、")}`
      : `段落 ${index + 1}`;
    return `【${source.id} ${locator} · ${element.ref} · ${element.kind}】\n${element.text}`;
  }).join("\n\n");
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
    throw new Error(`来源文件 ${source.id} 的 Docling 图片定位没有可核对的页码：${locator || "（空）"}`);
  }
  if (source.capability === "page" && locatorType === "page" && !PDF_PAGE_LOCATOR_PATTERN.test(locator)) {
    throw new Error(`来源文件 ${source.id} 的 Docling 页码定位没有可核对的页码：${locator || "（空）"}`);
  }
}

export function validateSourceQuote(
  source: SourceFile,
  locatorType: LocationCapability,
  locator: string,
  excerpt: string,
): void {
  validateSourceLocator(source, locatorType, locator);
  if (source.parser !== "docling" || !source.parsed) return;
  const normalizedExcerpt = excerpt.replace(/\s+/g, "").trim();
  if (!normalizedExcerpt) return;
  const indexMatch = locator.match(/\d+/);
  const index = indexMatch ? Number(indexMatch[0]) : undefined;
  const elementRef = locator.match(/#\/(?:texts|tables|pictures|key_value_items)\/\d+/)?.[0];
  const candidates = elementRef
    ? source.parsed.elements.filter((element) => element.ref === elementRef)
    : locatorType === "paragraph" && index !== undefined
    ? [source.parsed.elements[index - 1]].filter(Boolean)
    : index !== undefined
      ? source.parsed.elements.filter((element) => element.pageNumbers.includes(index))
      : source.parsed.elements;
  if (candidates.length === 0) {
    throw new Error(`来源 ${source.id} 的定位在 Docling 结果中不存在：${locator}`);
  }
  if (elementRef && index !== undefined && !candidates[0].pageNumbers.includes(index)) {
    throw new Error(`来源 ${source.id} 的元素 ${elementRef} 不属于 ${locator} 声明的页码`);
  }
  if (!candidates.some((element) => element.text.replace(/\s+/g, "").includes(normalizedExcerpt))) {
    throw new Error(`摘录不是来源 ${source.id} 在 ${locator} 下单个 Docling 元素的逐字原文`);
  }
}

export function buildSourceInput(message: string, sources: SourceFile[]): SourceInputContent[] {
  assertUniqueSources(sources);
  const content: SourceInputContent[] = [{
    type: "input_text",
    text: [`用户请求：${message}`, "", "来源目录：", sourceCatalog(sources)].join("\n"),
  }];

  for (const source of sources) {
    if (requiresDocumentParser(source.name) && source.parser !== "docling") {
      throw new Error(`来源 ${source.id} 尚未经过 Docling 解析`);
    }
    content.push({
      type: "input_text",
      text: `以下是来源 ${source.id}（${source.name}）的结构化正文：\n\n${formattedSourceContent(source)}`,
    });
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
    if (requiresDocumentParser(source.name) && source.parser !== "docling") {
      throw new Error(`来源 ${source.id} 尚未经过 Docling 解析`);
    }
    blocks.push({
      type: "text",
      text: `以下是来源 ${source.id}（${source.name}）的结构化正文：\n\n${formattedSourceContent(source)}`,
    });
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
      parser: source.parser ?? "unparsed",
      content: formattedSourceContent(source),
      multimodal_context: false,
      note: source.capabilityNote,
    });
  }, {
    name: "read_source",
    description: "读取当前需求分析任务中的一个来源。复杂文档返回 Docling 解析后的带页码或元素序号正文，不返回原始字节。",
    schema: sourceIdSchema,
  });

  const locateSource = tool(({ source_file_id }) => {
    const source = byId.get(source_file_id);
    if (!source) throw new Error(`当前任务不存在来源文件：${source_file_id}`);
    return JSON.stringify({
      source_file_id: source.id,
      locator_type: source.capability,
      locator_rule: source.capabilityNote,
      page_image_allowed: source.capability === "page",
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
