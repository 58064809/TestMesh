import { describe, expect, it } from "vitest";
import {
  RequirementAnalysisSchema,
  attachRequirementSources,
  buildSourceInput,
  createSources,
  validateRequirementAnalysis,
  type RequirementAnalysis,
} from "../server/analysis.js";
import { DomainStore } from "../server/store.js";
import { generateTestCases } from "../server/test-design.js";
import { renderAnalysisMarkdown } from "../src/analysis-report.js";
import { zodTextFormat } from "openai/helpers/zod";
import { ModelRequirementAnalysisSchema } from "../server/analysis.js";

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
);

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
  });

  it("sends a strict ten-field JSON Schema to the existing OpenAI helper", () => {
    const format = zodTextFormat(ModelRequirementAnalysisSchema, "requirement_analysis");
    expect(format.type).toBe("json_schema");
    expect(format.strict).toBe(true);
    expect(Object.keys(format.schema.properties ?? {})).toHaveLength(10);
    expect(format.schema.required).toHaveLength(10);
    expect(format.schema.additionalProperties).toBe(false);
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

  it("accepts PDF-embedded image references only when their page can be located", () => {
    const document = documentWithSource();
    const imageSource = { ...document.sources[0], locator_type: "image" as const, locator: "第 3 页 · 架构图", excerpt: "", description: "架构图显示用户层、AI 服务层和业务系统对接层" };
    expect(() => validateRequirementAnalysis({ ...document, sources: [imageSource] }, files)).not.toThrow();
    expect(() => validateRequirementAnalysis({ ...document, sources: [{ ...imageSource, locator: "架构图" }] }, files)).toThrow("没有可核对的页码");
    expect(() => validateRequirementAnalysis({ ...document, sources: [{ ...imageSource, locator_type: "paragraph" }] }, files)).toThrow("与文件定位能力");
  });

  it("passes text, PDF pages and a standalone diagram through one multimodal request with source markers", () => {
    const mixed = createSources(
      [
        { originalname: "需求.md", mimetype: "text/markdown", buffer: Buffer.from("下单后显示订单状态") },
        { originalname: "流程.pdf", mimetype: "application/pdf", buffer: Buffer.from("pdf") },
        { originalname: "状态图.png", mimetype: "image/png", buffer: Buffer.from("image") },
      ],
      [{ originalname: "补充.docx", mimetype: "application/octet-stream", buffer: Buffer.from("docx") }],
    );
    const input = buildSourceInput("分析需求", mixed);
    expect(input[1]).toEqual(expect.objectContaining({ type: "input_text", text: expect.stringContaining("ATT-1 段落 1") }));
    expect(input[2]).toEqual(expect.objectContaining({ type: "input_text", text: expect.stringContaining("来源 ATT-2（流程.pdf）") }));
    expect(input[3]).toEqual(expect.objectContaining({ type: "input_file", filename: "流程.pdf", detail: "high", file_data: expect.stringMatching(/^data:application\/pdf;base64,/) }));
    expect(input[4]).toEqual(expect.objectContaining({ type: "input_text", text: expect.stringContaining("来源 ATT-3（状态图.png）") }));
    expect(input[5]).toEqual(expect.objectContaining({ type: "input_image", detail: "high", image_url: expect.stringMatching(/^data:image\/png;base64,/) }));
    expect(input[6]).toEqual(expect.objectContaining({ type: "input_text", text: expect.stringContaining("来源 KNOW-1（补充.docx）") }));
    expect(input[7]).toEqual(expect.objectContaining({ type: "input_file", filename: "补充.docx", file_data: expect.stringMatching(/^data:application\/vnd.openxmlformats-officedocument.wordprocessingml.document;base64,/) }));
    expect("detail" in input[7]).toBe(false);
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
    const conflict = { id: "OQ-1", description: "订单关闭时间是30分钟还是15分钟？", origin: "conflict" as const,
      source_refs: ["SRC-A", "SRC-B"], confidence: 0.9 };
    const result = { ...emptyDocument, open_questions: [conflict], sources: conflictSources };
    expect(() => validateRequirementAnalysis(result, conflictFiles)).not.toThrow();
    expect(() => validateRequirementAnalysis({ ...result, open_questions: [{ ...conflict, source_refs: ["SRC-A"] }] }, conflictFiles)).toThrow("至少要关联");
    expect(result.business_rules).toEqual([]);
  });

  it("stores the canonical JSON and derives trace indexes without analysis risks", () => {
    const store = new DomainStore(":memory:");
    try {
      const document = documentWithSource();
      const id = store.saveRequirementAnalysis(document, "gpt-5.6-luna", files);
      expect(store.getRequirementAnalysis(id)).toEqual(document);
      expect(store.listAnalysisSourceFiles(id)).toEqual([
        expect.objectContaining({ sourceFileId: "ATT-1", filename: "prd.pdf", provenance: "at_analysis" }),
      ]);
      expect(store.getAnalysisSourceFile(id, "ATT-1").file).toEqual(Buffer.from("pdf"));
      expect(store.listRequirementAnalyses()).toEqual([
        expect.objectContaining({ id, summary: "订单查询需求", model: "gpt-5.6-luna" }),
      ]);
      const trace = store.getTestDesignAnalysis(id);
      expect(trace.requirements).toHaveLength(1);
      expect(trace.requirements[0].evidenceIds).toHaveLength(1);
      expect(trace.risks).toEqual([]);
      expect(trace.requirements[0].priority).toBe("unspecified");
    } finally {
      store.close();
    }
  });

  it("keeps the old analysis format untouched and stops new documents before P05 requests", async () => {
    const store = new DomainStore(":memory:");
    try {
      const oldId = store.saveAnalysis({
        summary: "旧分析", requirements: [], risks: [], pendingQuestions: [],
        evidence: [{ id: "EV-1", sourceId: "ATT-1", sourceName: "prd.pdf", locatorType: "page", locator: "1", excerpt: "旧原文", note: "" }],
      }, "gpt-5.6-luna");
      expect(store.getRequirementAnalysis(oldId)).toBeNull();
      expect(store.listRequirementAnalyses()).toEqual([]);
      expect(store.getTestDesignAnalysis(oldId).analysisFormat).toBe("legacy");
      const newId = store.saveRequirementAnalysis(documentWithSource(), "gpt-5.6-luna", files);
      const newTrace = store.getTestDesignAnalysis(newId);
      expect(newTrace.analysisFormat).toBe("requirement-analysis");
      await expect(generateTestCases(newTrace, [], "not-a-real-key")).rejects.toThrow("尚未适配");
    } finally {
      store.close();
    }
  });

  it("renders Markdown solely from the structured document and shows true references", () => {
    const markdown = renderAnalysisMarkdown(documentWithSource());
    expect(markdown).toContain("## 业务规则\n\n暂无已识别内容。");
    expect(markdown).toContain("prd.pdf · 页码 2 · SRC-1");
    expect(markdown).toContain("用户可以查看订单");
    expect(markdown).not.toContain("风险");
  });
});
