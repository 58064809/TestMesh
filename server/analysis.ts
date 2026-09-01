import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import path from "node:path";
import { z } from "zod";

export const MODEL = "gpt-5.6-luna";
export const MAX_FILES = 6;
export const MAX_FILE_BYTES = 8 * 1024 * 1024;
export const MAX_OUTPUT_TOKENS = 40_000;
export const MODEL_CONTEXT_TOKENS = 1_050_000;

// Current GPT-5.6 Luna pricing applies a 2x input and 1.5x output multiplier
// above 272K input tokens. Implicit prompt caching is disabled below, so the
// maximum token cost is bounded by the context window and this output cap.
export function worstCaseTokenCostUsd(maxOutputTokens = MAX_OUTPUT_TOKENS): number {
  const maximumInputTokens = MODEL_CONTEXT_TOKENS - maxOutputTokens;
  const inputCost = (maximumInputTokens / 1_000_000) * 0.4;
  const outputCost = (maxOutputTokens / 1_000_000) * 1.8;
  return inputCost + outputCost;
}

const TEXT_EXTENSIONS = new Set([".txt", ".md", ".json", ".html", ".xml"]);
const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);
const DOCUMENT_EXTENSIONS = new Set([".pdf", ".doc", ".docx", ".rtf", ".odt", ".ppt", ".pptx"]);

export const ACCEPTED_EXTENSIONS = new Set([
  ...TEXT_EXTENSIONS,
  ...IMAGE_EXTENSIONS,
  ...DOCUMENT_EXTENSIONS,
]);

const ModelEvidenceSchema = z.object({
  id: z.string().min(1),
  sourceId: z.string().min(1),
  locatorType: z.enum(["page", "paragraph", "image", "limited"]),
  locator: z.string(),
  excerpt: z.string(),
  note: z.string(),
});

const analysisFields = {
  summary: z.string().min(1),
  requirements: z.array(
    z.object({
      id: z.string().min(1),
      title: z.string().min(1),
      description: z.string().min(1),
      priority: z.enum(["must", "should", "could"]),
      acceptanceCriteria: z.array(z.string().min(1)),
      evidenceIds: z.array(z.string().min(1)),
    }),
  ),
  risks: z.array(
    z.object({
      id: z.string().min(1),
      title: z.string().min(1),
      description: z.string().min(1),
      severity: z.enum(["high", "medium", "low"]),
      mitigation: z.string().min(1),
      evidenceIds: z.array(z.string().min(1)),
    }),
  ),
  pendingQuestions: z.array(
    z.object({
      id: z.string().min(1),
      question: z.string().min(1),
      reason: z.string().min(1),
      relatedRequirementIds: z.array(z.string().min(1)),
    }),
  ),
};

const ModelAnalysisSchema = z.object({
  ...analysisFields,
  evidence: z.array(ModelEvidenceSchema).min(1),
});

export const AnalysisSchema = z.object({
  ...analysisFields,
  evidence: z.array(ModelEvidenceSchema.extend({ sourceName: z.string().min(1) })).min(1),
});

export type AnalysisResult = z.infer<typeof AnalysisSchema>;
export type Evidence = AnalysisResult["evidence"][number];
type ModelAnalysisResult = z.infer<typeof ModelAnalysisSchema>;

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

type InputText = { type: "input_text"; text: string };
type InputImage = { type: "input_image"; image_url: string; detail: "high" };
type InputFile = {
  type: "input_file";
  filename: string;
  file_data: string;
  detail?: "high";
};
type InputContent = InputText | InputImage | InputFile;

export function extensionOf(filename: string): string {
  return path.extname(filename).toLowerCase();
}

export function isAcceptedFilename(filename: string): boolean {
  return ACCEPTED_EXTENSIONS.has(extensionOf(filename));
}

export function normalizeUploadFilename(filename: string): string {
  if (Buffer.byteLength(filename, "utf8") === filename.length) {
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
    return { capability: "page", note: "PDF 同时输入抽取文本与页面图像，可按页定位。" };
  }
  if (TEXT_EXTENSIONS.has(ext)) {
    return { capability: "paragraph", note: "文本已在发送前加入稳定段落编号。" };
  }
  if (IMAGE_EXTENSIONS.has(ext)) {
    return { capability: "image", note: "Evidence 可定位到整张上传图片。" };
  }
  return {
    capability: "limited",
    note: "该格式只能抽取文本，无法可靠定位页码，且嵌入图片不会进入模型上下文；请转为 PDF 或单独上传图片。",
  };
}

export function createSources(
  attachments: UploadLike[],
  knowledge: UploadLike[],
): SourceFile[] {
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

function sourceCatalog(sources: SourceFile[]): string {
  return sources
    .map(
      (source) =>
        `- ${source.id} | ${source.name} | 范围=${source.scope} | 定位能力=${source.capability} | ${source.capabilityNote}`,
    )
    .join("\n");
}

export function validateEvidenceSources(result: AnalysisResult, sources: SourceFile[]): void {
  const sourceById = new Map(sources.map((source) => [source.id, source]));
  const evidenceIds = new Set(result.evidence.map((item) => item.id));

  for (const evidence of result.evidence) {
    const source = sourceById.get(evidence.sourceId);
    if (!source) {
      throw new Error(`Evidence ${evidence.id} 引用了未知来源 ${evidence.sourceId}`);
    }
    if (evidence.sourceName !== source.name) {
      throw new Error(`Evidence ${evidence.id} 的来源名称与 ${evidence.sourceId} 不一致`);
    }
    if (source.capability === "limited" && evidence.locatorType !== "limited") {
      throw new Error(`Evidence ${evidence.id} 对定位受限格式给出了未经保证的位置`);
    }
  }

  const references = [
    ...result.requirements.flatMap((item) => item.evidenceIds),
    ...result.risks.flatMap((item) => item.evidenceIds),
  ];
  for (const evidenceId of references) {
    if (!evidenceIds.has(evidenceId)) {
      throw new Error(`分析条目引用了不存在的 Evidence ${evidenceId}`);
    }
  }
}

export function attachEvidenceSourceNames(
  result: ModelAnalysisResult,
  sources: SourceFile[],
): AnalysisResult {
  const sourceById = new Map(sources.map((source) => [source.id, source]));
  const evidence = result.evidence.map((item) => {
    const source = sourceById.get(item.sourceId);
    if (!source) {
      throw new Error(`Evidence ${item.id} 引用了未知来源 ${item.sourceId}`);
    }
    return { ...item, sourceName: source.name };
  });

  return AnalysisSchema.parse({ ...result, evidence });
}

function buildInput(message: string, sources: SourceFile[]): InputContent[] {
  const content: InputContent[] = [
    {
      type: "input_text",
      text: [
        `用户请求：${message}`,
        "",
        "来源目录：",
        sourceCatalog(sources),
      ].join("\n"),
    },
  ];

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
    if (IMAGE_EXTENSIONS.has(extension)) {
      content.push({ type: "input_image", image_url: dataUrl, detail: "high" });
      continue;
    }

    content.push({
      type: "input_file",
      filename: source.name,
      file_data: dataUrl,
      ...(extension === ".pdf" ? { detail: "high" as const } : {}),
    });
  }

  return content;
}

const INSTRUCTIONS = `你是 TestMesh 的资深测试分析师。请用中文分析用户提供的 PRD、截图和项目资料。

必须遵守：
1. 只依据用户文本和来源目录中的文件；不得臆测不存在的业务规则。
2. 输出 Requirement、Risk、Pending Question、Evidence，并严格符合给定结构。
3. Requirement 和 Risk 的 evidenceIds 只能引用本次输出中的 Evidence id。
4. Evidence.sourceId 必须逐字使用来源目录中的值；来源文件名由服务端依据 sourceId 确定性填入。
5. PDF 可用 page 定位；带编号文本用 paragraph 定位；独立图片用 image 定位。
6. 定位能力为 limited 的来源，locatorType 必须为 limited，locator 留空，并在 note 明确说明无法可靠定位页/段及嵌入图片限制。
7. excerpt 应简短；如果图片没有可引用文字，可为空并在 note 描述视觉依据。
8. 不要把推断伪装成 Evidence。资料不足时生成 Pending Question。
9. 优先识别功能需求、边界条件、异常路径、权限、数据一致性和可测试性风险。`;

export async function analyzeRequirement(
  message: string,
  sources: SourceFile[],
  apiKey: string,
): Promise<{ result: AnalysisResult; usage: { inputTokens: number; outputTokens: number; totalTokens: number } }> {
  if (sources.length === 0) {
    throw new Error("至少需要上传一个 PRD、文档或图片来源");
  }
  if (sources.length > MAX_FILES) {
    throw new Error(`单次最多上传 ${MAX_FILES} 个文件`);
  }

  const client = new OpenAI({ apiKey });
  const response = await client.responses.parse({
    model: MODEL,
    instructions: INSTRUCTIONS,
    input: [
      {
        role: "user",
        content: buildInput(message, sources),
      },
    ],
    text: {
      format: zodTextFormat(ModelAnalysisSchema, "requirement_analysis"),
    },
    max_output_tokens: MAX_OUTPUT_TOKENS,
    prompt_cache_options: { mode: "explicit" },
    store: false,
  });

  const parsed = response.output_parsed;
  if (!parsed) {
    const detail = response.incomplete_details?.reason ?? response.status;
    throw new Error(`OpenAI 未返回可解析的结构化结果（${detail ?? "未知状态"}）`);
  }

  const result = attachEvidenceSourceNames(parsed, sources);
  validateEvidenceSources(result, sources);

  return {
    result,
    usage: {
      inputTokens: response.usage?.input_tokens ?? 0,
      outputTokens: response.usage?.output_tokens ?? 0,
      totalTokens: response.usage?.total_tokens ?? 0,
    },
  };
}
