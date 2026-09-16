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

// The document is the source of truth for new analyses. The older AnalysisResult
// shape is retained only for previously saved analyses and their trace records.
const AnalysisItemSchema = z.object({
  id: z.string().min(1),
  description: z.string(),
  origin: z.enum(["explicit", "inferred"]),
  source_refs: z.array(z.string().min(1)),
  confidence: z.number().min(0).max(1),
}).strict();

const OpenQuestionSchema = AnalysisItemSchema.extend({
  issue_type: z.enum(["missing", "ambiguity", "conflict"]),
}).strict();

const ModelSourceSchema = AnalysisItemSchema.extend({
  source_file_id: z.string().min(1),
  locator_type: z.enum(["page", "paragraph", "image", "limited"]),
  locator: z.string(),
  excerpt: z.string(),
}).strict();

const documentFields = {
  summary: AnalysisItemSchema.nullable(),
  requirements: z.array(AnalysisItemSchema.extend({ acceptance_criteria: z.array(z.string()) })),
  actors: z.array(AnalysisItemSchema),
  business_rules: z.array(AnalysisItemSchema),
  flows: z.array(AnalysisItemSchema),
  states: z.array(AnalysisItemSchema),
  constraints: z.array(AnalysisItemSchema),
  exceptions: z.array(AnalysisItemSchema),
  open_questions: z.array(OpenQuestionSchema),
};

export const ModelRequirementAnalysisSchema = z.object({
  ...documentFields,
  sources: z.array(ModelSourceSchema),
}).strict();

export const RequirementAnalysisSchema = z.object({
  ...documentFields,
  sources: z.array(ModelSourceSchema.extend({ source_file_name: z.string().min(1) })),
}).strict();

export type RequirementAnalysis = z.infer<typeof RequirementAnalysisSchema>;
type ModelRequirementAnalysis = z.infer<typeof ModelRequirementAnalysisSchema>;

export class RequirementAnalysisValidationError extends Error {}

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
  const validated = ModelAnalysisSchema.parse(result);
  const sourceById = new Map(sources.map((source) => [source.id, source]));
  const evidence = validated.evidence.map((item) => {
    const source = sourceById.get(item.sourceId);
    if (!source) {
      throw new Error(`Evidence ${item.id} 引用了未知来源 ${item.sourceId}`);
    }
    return { ...item, sourceName: source.name };
  });

  return AnalysisSchema.parse({ ...validated, evidence });
}

export function attachRequirementSources(
  result: ModelRequirementAnalysis,
  files: SourceFile[],
): RequirementAnalysis {
  const byId = new Map(files.map((file) => [file.id, file]));
  const sources = result.sources.map((source) => {
    const file = byId.get(source.source_file_id);
    if (!file) throw new Error(`来源引用 ${source.id} 引用了未知文件 ${source.source_file_id}`);
    return { ...source, source_file_name: file.name };
  });
  return RequirementAnalysisSchema.parse({ ...result, sources });
}

export function validateRequirementAnalysis(result: RequirementAnalysis, files: SourceFile[]): void {
  const fileById = new Map(files.map((file) => [file.id, file]));
  const entries = [
    ...(result.summary ? [{ section: "summary", item: result.summary }] : []),
    ...result.requirements.map((item) => ({ section: "requirements", item })),
    ...result.actors.map((item) => ({ section: "actors", item })),
    ...result.business_rules.map((item) => ({ section: "business_rules", item })),
    ...result.flows.map((item) => ({ section: "flows", item })),
    ...result.states.map((item) => ({ section: "states", item })),
    ...result.constraints.map((item) => ({ section: "constraints", item })),
    ...result.exceptions.map((item) => ({ section: "exceptions", item })),
    ...result.open_questions.map((item) => ({ section: "open_questions", item })),
    ...result.sources.map((item) => ({ section: "sources", item })),
  ];
  const itemIds = new Set<string>();
  for (const { item } of entries) {
    if (itemIds.has(item.id)) throw new Error(`需求分析条目 ID 重复：${item.id}`);
    itemIds.add(item.id);
  }
  const sourceIds = new Set(result.sources.map((source) => source.id));
  for (const { section, item } of entries) {
    for (const ref of item.source_refs) {
      if (!sourceIds.has(ref)) throw new Error(`需求分析条目 ${item.id} 引用了不存在的原文来源 ${ref}`);
    }
    const missingQuestion = section === "open_questions" && "issue_type" in item && item.issue_type === "missing";
    if (!missingQuestion && item.description && item.source_refs.length === 0 && section !== "sources") {
      throw new Error(`需求分析条目 ${item.id} 缺少原文来源`);
    }
    if (section === "open_questions" && "issue_type" in item && item.issue_type === "conflict" && item.source_refs.length < 2) {
      throw new Error(`冲突条目 ${item.id} 至少要关联相互矛盾的两处原文；单处表述歧义请作为待确认问题保留，不标成冲突`);
    }
  }
  for (const source of result.sources) {
    const file = fileById.get(source.source_file_id);
    if (!file) throw new Error(`来源引用 ${source.id} 引用了未知文件`);
    if (source.source_file_name !== file.name) throw new Error(`来源引用 ${source.id} 的文件名不一致`);
    if (file.capability === "limited" && source.locator_type !== "limited") {
      throw new Error(`来源引用 ${source.id} 对定位受限文件给出了未经保证的位置`);
    }
    const isPdfImage = file.capability === "page" && source.locator_type === "image";
    if (source.locator_type !== file.capability && !isPdfImage && file.capability !== "limited") {
      throw new Error(`来源引用 ${source.id} 的定位类型 ${source.locator_type} 与文件定位能力 ${file.capability} 不一致（locator=${source.locator}）`);
    }
    if (isPdfImage && !/(?:第\s*)?\d+\s*页|page\s*\d+|p\.\s*\d+/i.test(source.locator)) {
      throw new Error(`来源引用 ${source.id} 指向 PDF 嵌入图片，但没有可核对的页码（locator=${source.locator}）`);
    }
  }
}

export function buildSourceInput(message: string, sources: SourceFile[]): InputContent[] {
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
    content.push({
      type: "input_text",
      text: `紧接着的视觉或文件输入来自来源 ${source.id}（${source.name}）。请只把对它的观察关联到该来源；跨来源判断分别保留引用。`,
    });
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

const INSTRUCTIONS = `你是 TestMesh 的需求分析师。请用中文理解用户提供的 PRD、截图和项目资料；逐页审阅 PDF 正文与页面图像，并审阅独立截图的视觉内容。返回固定的 RequirementAnalysis JSON，不撰写自由格式作文。

1. 顶层固定为 summary、requirements、actors、business_rules、flows、states、constraints、exceptions、open_questions、sources；不存在的类别返回空数组，无法概述时 summary 返回 null，不为填满栏目编造内容。
2. 每个条目填写 id、description、origin、source_refs、confidence。origin 只表达结论来源，使用 explicit（原文明确）或 inferred（根据原文推导）；推断不能伪装成明确事实。
3. sources 是可查看的原文引用，每条有独立 id、source_file_id、locator_type、locator、excerpt，并使用共同基础属性。source_file_id 逐字使用来源目录的文件 ID；文件名由服务端填入。其他条目的 source_refs 引用 sources 的 id。明确事实、推断和冲突都给出真实引用；缺失项没有可引用材料时留空。
4. PDF 正文使用 page；PDF 内的流程图、架构图或截图可使用 image，但 locator 写明真实页码；带编号文本使用 paragraph、独立图片使用 image。定位能力 limited 的文件使用 limited，locator 留空，并在 description 说明定位限制。图片没有文字时 excerpt 可以为空，description 记录实际视觉依据。
5. requirements 的 acceptance_criteria 只记录原文明确给出的标准；没有就返回空数组。不要将测试风险和测试用例放进需求分析，它们属于测试设计阶段。
6. open_questions 的 issue_type 只表达问题类型，使用 missing（缺失）、ambiguity（歧义）或 conflict（冲突）。缺失项没有可引用材料时 source_refs 可为空；歧义至少引用一处导致歧义的原文；冲突至少引用两处相互矛盾的原文。
7. 多文件来源默认没有优先级。PRD、流程图、截图或补充说明规则不同时，不擅自选定一个版本；在 open_questions 中描述差异，issue_type 标记 conflict，并关联每一方独立的原文引用。只有上传材料明确给出“PRD 优先”等来源优先规则，才作为 explicit 的 business_rules 记录，引用规则原文；即使有规则，也保留冲突双方引用，让人工确认规则适用范围。单一表述不清使用 ambiguity。`;

export async function analyzeRequirement(
  message: string,
  sources: SourceFile[],
  apiKey: string,
): Promise<{ result: RequirementAnalysis; usage: { inputTokens: number; outputTokens: number; totalTokens: number } }> {
  if (sources.length === 0) {
    throw new Error("至少需要上传一个 PRD、文档或图片来源");
  }
  if (sources.length > MAX_FILES) {
    throw new Error(`单次最多上传 ${MAX_FILES} 个文件`);
  }

  const client = new OpenAI({ apiKey, maxRetries: 0 });
  const response = await client.responses.parse({
    model: MODEL,
    instructions: INSTRUCTIONS,
    input: [
      {
        role: "user",
        content: buildSourceInput(message, sources),
      },
    ],
    text: {
      format: zodTextFormat(ModelRequirementAnalysisSchema, "requirement_analysis"),
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

  let result: RequirementAnalysis;
  try {
    result = attachRequirementSources(parsed, sources);
    validateRequirementAnalysis(result, sources);
  } catch (error) {
    throw new RequirementAnalysisValidationError(error instanceof Error ? error.message : "结构或来源校验失败");
  }

  return {
    result,
    usage: {
      inputTokens: response.usage?.input_tokens ?? 0,
      outputTokens: response.usage?.output_tokens ?? 0,
      totalTokens: response.usage?.total_tokens ?? 0,
    },
  };
}
