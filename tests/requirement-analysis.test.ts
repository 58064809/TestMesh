import { describe, expect, it } from "vitest";
import {
  RequirementAnalysisSchema,
  attachRequirementSources,
  buildSourceInput,
  createSources,
  validateRequirementAnalysis,
  type RequirementAnalysis,
} from "../server/analysis.js";
import { toJsonSchema } from "@langchain/core/utils/json_schema";
import { renderAnalysisMarkdown } from "../src/analysis-report.js";
import { ModelRequirementAnalysisSchema } from "../server/analysis.js";
import { createModelRequirementAnalysisSchema } from "../server/requirement-analysis/schema.js";
import { parseAnalysisSources } from "../server/document-parsing/parse-sources.js";
import type { DocumentParser } from "../server/document-parsing/docling.js";
import { canonicalizeModelRequirementSources } from "../server/requirement-analysis/validation.js";

const parser: DocumentParser = {
  async parse(input) {
    return {
      parser: "docling",
      markdown: `# ${input.filename}`,
      schemaVersion: "1.9.0",
      processingTimeSeconds: 0.1,
      elements: [{ ref: "#/texts/0", kind: "text", text: `Docling:${input.filename}`, pageNumbers: [1] }],
    };
  },
};

const emptyDocument: RequirementAnalysis = {
  summary: null,
  requirements: [],
  actors: [],
  business_rules: [],
  flows: [],
  states: [],
  constraints: [],
  exceptions: [],
  open_questions: [],
  sources: [],
};

const files = createSources(
  [{ originalname: "prd.pdf", mimetype: "application/pdf", buffer: Buffer.from("pdf") }],
  [],
).map((source) => ({
  ...source,
  parser: "docling" as const,
  capability: "page" as const,
  capabilityNote: "Docling page provenance",
  parsed: {
    parser: "docling" as const,
    markdown: "用户可以查看订单",
    schemaVersion: "1.9.0",
    processingTimeSeconds: 0,
    elements: [{ ref: "#/texts/0", kind: "text" as const, text: "用户可以查看订单", pageNumbers: [2] }],
  },
}));

function documentWithSource(): RequirementAnalysis {
  const source = {
    id: "SRC-1", description: "第 2 页原文", origin: "explicit" as const,
    source_refs: [], confidence: 1, source_file_id: "ATT-1", source_file_name: "prd.pdf",
    locator_type: "page" as const, locator: "2", excerpt: "用户可以查看订单",
  };
  return {
    ...emptyDocument,
    summary: { id: "SUM-1", description: "订单查询需求", origin: "explicit", source_refs: ["SRC-1"], confidence: 0.9 },
    requirements: [{ id: "REQ-1", description: "用户可以查看订单", origin: "explicit", source_refs: ["SRC-1"], confidence: 0.95, acceptance_criteria: [] }],
    sources: [source],
  };
}

describe("fixed RequirementAnalysis document", () => {
  it("keeps all ten keys and leaves absent categories empty without invented content", () => {
    expect(Object.keys(RequirementAnalysisSchema.parse(emptyDocument))).toEqual([
      "summary", "requirements", "actors", "business_rules", "flows", "states",
      "constraints", "exceptions", "open_questions", "sources",
    ]);
    expect(() => RequirementAnalysisSchema.parse({ ...emptyDocument, risks: [] })).toThrow();
    expect(() => RequirementAnalysisSchema.parse({
      ...emptyDocument,
      open_questions: [{ id: "OQ-1", description: "时限未明确", origin: "missing", source_refs: [], confidence: 0.8, issue_type: "missing" }],
    })).toThrow();
    expect(() => RequirementAnalysisSchema.parse({
      ...emptyDocument,
      open_questions: [{ id: "OQ-1", description: "时限未明确", origin: "inferred", source_refs: [], confidence: 0.8 }],
    })).toThrow();
  });

  it("converts the fixed document to the ten-field Schema used by LangChain structured output", () => {
    const schema = toJsonSchema(ModelRequirementAnalysisSchema);
    expect(Object.keys(schema.properties ?? {})).toHaveLength(10);
    expect(schema.required).toHaveLength(10);
    expect(schema.additionalProperties).toBe(false);
  });

  it("constrains locator types and page numbers from Docling provenance", async () => {
    const pdf = (await parseAnalysisSources(createSources(
      [{ originalname: "flow.pdf", mimetype: "application/pdf", buffer: Buffer.from("pdf") }],
      [],
    ), parser))[0];
    const screenshot = (await parseAnalysisSources(createSources(
      [{ originalname: "screen.png", mimetype: "image/png", buffer: Buffer.from("png") }],
      [],
    ), parser))[0];
    const pdfSchema = createModelRequirementAnalysisSchema([pdf]);
    const imageSchema = createModelRequirementAnalysisSchema([screenshot]);
    const base = {
      id: "SRC-1",
      description: "流程图",
      origin: "explicit" as const,
      source_refs: [],
      confidence: 0.9,
      source_file_id: "ATT-1",
      locator_type: "image" as const,
      excerpt: "",
    };

    expect(pdfSchema.safeParse({
      ...emptyDocument,
      sources: [{ ...base, locator: "流程图" }],
    }).success).toBe(false);
    expect(pdfSchema.safeParse({
      ...emptyDocument,
      sources: [{ ...base, locator: "第 3 页 · #/pictures/0" }],
    }).success).toBe(true);
    expect(imageSchema.safeParse({
      ...emptyDocument,
      sources: [{ ...base, locator: "第 1 页 · #/texts/0" }],
    }).success).toBe(true);
    expect(pdfSchema.safeParse({
      ...emptyDocument,
      sources: [{ ...base, source_file_id: "UNKNOWN", locator: "第 3 页 · #/pictures/0" }],
    }).success).toBe(false);
  });

  it("binds source file names to uploaded files and refuses invented references", () => {
    const modelDocument = documentWithSource();
    const modelSource = { ...modelDocument.sources[0] };
    const sourceWithoutName = Object.fromEntries(Object.entries(modelSource).filter(([key]) => key !== "source_file_name"));
    const attached = attachRequirementSources({ ...modelDocument, sources: [sourceWithoutName as Omit<typeof modelSource, "source_file_name">] }, files);
    expect(attached.sources[0].source_file_name).toBe("prd.pdf");
    expect(() => validateRequirementAnalysis(attached, files)).not.toThrow();
    expect(() => validateRequirementAnalysis({ ...attached, requirements: [{ ...attached.requirements[0], source_refs: ["fake"] }] }, files)).toThrow("不存在的原文来源");
  });

  it("replaces model-written excerpts with the exact Docling element selected by page and ref", () => {
    const modelDocument = documentWithSource();
    const modelSource = {
      ...modelDocument.sources[0],
      locator: "第 2 页 · #/texts/0",
      excerpt: "模型改写的句子",
    };
    const sourceWithoutName = Object.fromEntries(Object.entries(modelSource).filter(([key]) => key !== "source_file_name"));
    const canonical = canonicalizeModelRequirementSources({
      ...modelDocument,
      sources: [sourceWithoutName as Omit<typeof modelSource, "source_file_name">],
    }, files);
    expect(canonical.sources[0].excerpt).toBe("用户可以查看订单");
    expect(canonical.sources[0].locator).toBe("第 2 页 · #/texts/0");
  });

  it("checks source-priority claims only when multiple source files can conflict", () => {
    const document = documentWithSource();
    document.summary = {
      ...document.summary!,
      description: "截图优先于需求文档",
    };
    expect(() => validateRequirementAnalysis(document, files)).not.toThrow();
    expect(() => validateRequirementAnalysis(document, [
      ...files,
      { ...files[0], id: "ATT-2", name: "screen.pdf" },
    ])).toThrow("来源优先级");
  });

  it("accepts Docling image references only when their page exists in provenance", () => {
    const document = documentWithSource();
    const imageSource = { ...document.sources[0], locator_type: "image" as const, locator: "第 2 页 · 架构图", excerpt: "", description: "架构图显示用户层、AI 服务层和业务系统对接层" };
    expect(() => validateRequirementAnalysis({ ...document, sources: [imageSource] }, files)).not.toThrow();
    expect(() => validateRequirementAnalysis({ ...document, sources: [{ ...imageSource, locator: "架构图" }] }, files)).toThrow("没有可核对的页码");
    expect(() => validateRequirementAnalysis({ ...document, sources: [{ ...imageSource, locator_type: "paragraph" }] }, files)).toThrow("与文件定位能力");
  });

  it("passes text, PDF, image and Office content only through Docling structured output", async () => {
    const mixed = await parseAnalysisSources(createSources(
      [
        { originalname: "需求.md", mimetype: "text/markdown", buffer: Buffer.from("下单后显示订单状态") },
        { originalname: "流程.pdf", mimetype: "application/pdf", buffer: Buffer.from("pdf") },
        { originalname: "状态图.png", mimetype: "image/png", buffer: Buffer.from("image") },
      ],
      [{ originalname: "补充.docx", mimetype: "application/octet-stream", buffer: Buffer.from("docx") }],
    ), parser);
    const input = buildSourceInput("分析需求", mixed);
    expect(input[1]).toEqual(expect.objectContaining({ type: "input_text", text: expect.stringContaining("ATT-1 段落 1") }));
    expect(input[2]).toEqual(expect.objectContaining({ type: "input_text", text: expect.stringContaining("Docling:流程.pdf") }));
    expect(input[3]).toEqual(expect.objectContaining({ type: "input_text", text: expect.stringContaining("Docling:状态图.png") }));
    expect(input[4]).toEqual(expect.objectContaining({ type: "input_text", text: expect.stringContaining("Docling:补充.docx") }));
    expect(JSON.stringify(input)).not.toContain("base64");
    expect(input).toHaveLength(5);
  });

  it("retains both sides of a multi-file conflict without assigning source priority", () => {
    const conflictFiles = createSources(
      [{ originalname: "prd.md", mimetype: "text/markdown", buffer: Buffer.from("30分钟未支付关闭订单") }],
      [{ originalname: "补充说明.md", mimetype: "text/markdown", buffer: Buffer.from("15分钟未支付关闭订单") }],
    );
    const conflictSources = [
      { id: "SRC-A", description: "PRD 关闭规则", origin: "explicit" as const, source_refs: [], confidence: 1,
        source_file_id: "ATT-1", source_file_name: "prd.md", locator_type: "paragraph" as const, locator: "1", excerpt: "30分钟未支付关闭订单" },
      { id: "SRC-B", description: "补充说明关闭规则", origin: "explicit" as const, source_refs: [], confidence: 1,
        source_file_id: "KNOW-1", source_file_name: "补充说明.md", locator_type: "paragraph" as const, locator: "1", excerpt: "15分钟未支付关闭订单" },
    ];
    const conflict = { id: "OQ-1", description: "订单关闭时间是30分钟还是15分钟？", origin: "inferred" as const,
      issue_type: "conflict" as const, source_refs: ["SRC-A", "SRC-B"], confidence: 0.9 };
    const result = { ...emptyDocument, open_questions: [conflict], sources: conflictSources };
    expect(() => validateRequirementAnalysis(result, conflictFiles)).not.toThrow();
    expect(() => validateRequirementAnalysis({ ...result, open_questions: [{ ...conflict, source_refs: ["SRC-A"] }] }, conflictFiles)).toThrow("至少要关联");
    expect(result.business_rules).toEqual([]);
  });

  it("separates conclusion origin from open-question issue type", () => {
    const document = documentWithSource();
    const ambiguity = { id: "OQ-1", description: "长时间具体指多久？", origin: "inferred" as const,
      issue_type: "ambiguity" as const, source_refs: ["SRC-1"], confidence: 0.9 };
    const missing = { id: "OQ-2", description: "未说明失败重试规则", origin: "inferred" as const,
      issue_type: "missing" as const, source_refs: [], confidence: 0.85 };
    expect(() => validateRequirementAnalysis({ ...document, open_questions: [ambiguity, missing] }, files)).not.toThrow();
    expect(() => validateRequirementAnalysis({ ...document, open_questions: [{ ...ambiguity, source_refs: [] }] }, files)).toThrow("缺少原文来源");
  });

  it("renders Markdown solely from the structured document and shows true references", () => {
    const markdown = renderAnalysisMarkdown(documentWithSource());
    expect(markdown).toContain("## 业务规则\n\n暂无已识别内容。");
    expect(markdown).toContain("prd.pdf · 页码 2 · SRC-1");
    expect(markdown).toContain("用户可以查看订单");
    expect(markdown).not.toContain("风险");
  });
});
