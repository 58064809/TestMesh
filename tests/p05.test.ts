import { describe, expect, it } from "vitest";
import type { AnalysisResult, SourceFile } from "../server/analysis.js";
import {
  createTestDesignSchema,
  validateGeneratedTestCases,
  validateGeneratedTestDesign,
  validateReviewedPartition,
  type AliasTestCase,
  type CoveragePartition,
} from "../server/test-design.js";
import { DomainStore, type GeneratedTestCaseInput } from "../server/store.js";

const analysisResult: AnalysisResult = {
  summary: "真实售后流程分析",
  requirements: [{
    id: "REQ-001",
    title: "提交售后申请",
    description: "用户可为已完成订单提交售后申请",
    priority: "must",
    acceptanceCriteria: ["申请成功后展示售后单号"],
    evidenceIds: ["EV-001"],
  }],
  risks: [{
    id: "RISK-001",
    title: "重复提交",
    description: "重复点击可能创建多个售后单",
    severity: "high",
    mitigation: "提交动作应具备幂等保护",
    evidenceIds: ["EV-001"],
  }],
  pendingQuestions: [],
  evidence: [{
    id: "EV-001",
    sourceId: "ATT-1",
    sourceName: "售后 PRD.pdf",
    locatorType: "page",
    locator: "第 3 页",
    excerpt: "用户提交申请后生成售后单号",
    note: "",
  }],
};

const pdfSource: SourceFile = {
  id: "ATT-1",
  name: "售后 PRD.pdf",
  mimeType: "application/pdf",
  buffer: Buffer.from("pdf"),
  scope: "attachment",
  capability: "page",
  capabilityNote: "PDF 同时输入抽取文本与页面图像，可按页定位。",
};

function completeDesign(
  analysis: ReturnType<DomainStore["getTestDesignAnalysis"]>,
  draft: GeneratedTestCaseInput,
) {
  return {
    sourceReviews: [{
      sourceId: pdfSource.id,
      reviewedText: true,
      reviewedImages: true,
      visualFindings: [{
        locator: "第 3 页",
        description: "页面流程展示提交成功后出现售后单号",
        evidenceIds: [analysis.evidence[0].id],
      }],
    }],
    notPlaywrightApplicable: {
      requirements: [],
      acceptanceCriteria: [],
      risks: [],
    },
    testCases: [{
      ...draft,
      acceptanceCriteriaRefs: [`${analysis.requirements[0].id}#1`],
    }],
  };
}

describe("P05 test design domain", () => {
  it("persists generated drafts in the unified TestCase table with real trace links", () => {
    const store = new DomainStore(":memory:");
    try {
      const analysisId = store.saveAnalysis(analysisResult, "gpt-5.6-luna");
      const analysis = store.getTestDesignAnalysis(analysisId);
      const draft: GeneratedTestCaseInput = {
        title: "重复提交售后申请只创建一个售后单",
        objective: "验证重复提交的幂等保护",
        preconditions: ["存在可申请售后的已完成订单"],
        steps: ["打开订单详情", "连续两次提交同一售后申请"],
        expectedResults: ["只生成一个售后单号"],
        priority: "must",
        requirementIds: [analysis.requirements[0].id],
        riskIds: [analysis.risks[0].id],
        evidenceIds: [analysis.evidence[0].id],
      };

      validateGeneratedTestCases(analysis, [draft]);
      const saved = store.saveGeneratedTestCases(analysisId, [draft])[0];
      expect(saved).toMatchObject({ reviewStatus: "draft", testType: "playwright" });
      expect(saved.requirementIds).toEqual(draft.requirementIds);
      expect(saved.riskIds).toEqual(draft.riskIds);
      expect(saved.evidenceIds).toEqual(draft.evidenceIds);
      expect(store.approveTestDesignCase(saved.id).reviewStatus).toBe("approved");
    } finally {
      store.close();
    }
  });

  it("rejects model trace IDs that are not part of the selected real analysis", () => {
    const store = new DomainStore(":memory:");
    try {
      const analysisId = store.saveAnalysis(analysisResult, "gpt-5.6-luna");
      const analysis = store.getTestDesignAnalysis(analysisId);
      expect(() => validateGeneratedTestCases(analysis, [{
        title: "伪造追溯",
        objective: "不应保存",
        preconditions: [],
        steps: ["执行"],
        expectedResults: ["停止"],
        priority: "must",
        requirementIds: ["unknown"],
        riskIds: [analysis.risks[0].id],
        evidenceIds: [analysis.evidence[0].id],
      }])).toThrow("未知 Requirement");
    } finally {
      store.close();
    }
  });

  it("requires at least one analysis, PRD, or RAG evidence item per test case", () => {
    const store = new DomainStore(":memory:");
    try {
      const analysisId = store.saveAnalysis(analysisResult, "gpt-5.6-luna");
      const analysis = store.getTestDesignAnalysis(analysisId);
      const base = {
        title: "售后申请",
        objective: "验证售后申请流程",
        preconditions: [],
        steps: ["提交售后申请"],
        expectedResults: ["展示售后单号"],
        priority: "must" as const,
      };

      const analysisBacked = {
        ...base,
        requirementIds: [analysis.requirements[0].id],
        riskIds: [],
        evidenceIds: [],
      };
      const prdBacked = {
        ...base,
        title: "PRD 证据支持的售后申请",
        requirementIds: [],
        riskIds: [],
        evidenceIds: [analysis.evidence[0].id],
      };
      expect(() => validateGeneratedTestCases(analysis, [analysisBacked])).not.toThrow();
      expect(() => validateGeneratedTestCases(analysis, [prdBacked])).not.toThrow();
      expect(() => store.saveGeneratedTestCases(analysisId, [analysisBacked])).not.toThrow();
      expect(() => store.saveGeneratedTestCases(analysisId, [prdBacked])).not.toThrow();
      expect(() => validateGeneratedTestCases(analysis, [{
        ...base,
        requirementIds: [],
        riskIds: [],
        evidenceIds: [],
      }])).toThrow("没有任何需求分析、PRD 或 RAG 证据");
    } finally {
      store.close();
    }
  });

  it("constrains structured output IDs to the selected real analysis", () => {
    const store = new DomainStore(":memory:");
    try {
      const analysisId = store.saveAnalysis(analysisResult, "gpt-5.6-luna");
      const analysis = store.getTestDesignAnalysis(analysisId);
      const draft: GeneratedTestCaseInput = {
        title: "售后申请",
        objective: "验证售后申请流程",
        preconditions: [],
        steps: ["提交售后申请"],
        expectedResults: ["展示售后单号"],
        priority: "must",
        requirementIds: [analysis.requirements[0].id],
        riskIds: [analysis.risks[0].id],
        evidenceIds: [analysis.evidence[0].id],
      };
      const schema = createTestDesignSchema(analysis, [pdfSource]);
      const output = completeDesign(analysis, draft);

      expect(schema.safeParse(output).success).toBe(true);
      const coveredDraft = output.testCases[0];
      expect(schema.safeParse({ ...output, testCases: [{ ...coveredDraft, requirementIds: ["unknown"] }] }).success).toBe(false);
      expect(schema.safeParse({ ...output, testCases: [{ ...coveredDraft, riskIds: ["unknown"] }] }).success).toBe(false);
      expect(schema.safeParse({ ...output, testCases: [{ ...coveredDraft, evidenceIds: ["unknown"] }] }).success).toBe(false);
    } finally {
      store.close();
    }
  });

  it("does not impose a fixed test case count", () => {
    const store = new DomainStore(":memory:");
    try {
      const analysisId = store.saveAnalysis(analysisResult, "gpt-5.6-luna");
      const analysis = store.getTestDesignAnalysis(analysisId);
      const draft: GeneratedTestCaseInput = {
        title: "售后申请 1",
        objective: "验证售后申请流程",
        preconditions: [],
        steps: ["提交售后申请"],
        expectedResults: ["展示售后单号"],
        priority: "must",
        requirementIds: [analysis.requirements[0].id],
        riskIds: [analysis.risks[0].id],
        evidenceIds: [analysis.evidence[0].id],
      };
      const output = completeDesign(analysis, draft);
      const testCases = Array.from({ length: 25 }, (_, index) => ({
        ...draft,
        title: `售后申请 ${index + 1}`,
        acceptanceCriteriaRefs: [`${analysis.requirements[0].id}#1`],
      }));
      const expanded = {
        ...output,
        testCases,
      };

      expect(createTestDesignSchema(analysis, [pdfSource]).safeParse(expanded).success).toBe(true);
      expect(() => validateGeneratedTestDesign(analysis, [pdfSource], expanded)).not.toThrow();
    } finally {
      store.close();
    }
  });

  it("stops when a PDF has no image review evidence", () => {
    const store = new DomainStore(":memory:");
    try {
      const analysisId = store.saveAnalysis(analysisResult, "gpt-5.6-luna");
      const analysis = store.getTestDesignAnalysis(analysisId);
      const draft: GeneratedTestCaseInput = {
        title: "售后申请",
        objective: "验证售后申请流程",
        preconditions: [],
        steps: ["提交售后申请"],
        expectedResults: ["展示售后单号"],
        priority: "must",
        requirementIds: [analysis.requirements[0].id],
        riskIds: [analysis.risks[0].id],
        evidenceIds: [analysis.evidence[0].id],
      };
      const output = completeDesign(analysis, draft);
      output.sourceReviews[0].reviewedImages = false;
      output.sourceReviews[0].visualFindings = [];

      expect(() => validateGeneratedTestDesign(analysis, [pdfSource], output)).toThrow("缺少图片审阅证明");
    } finally {
      store.close();
    }
  });

  it("stops when requirement, criterion, or risk coverage is omitted", () => {
    const store = new DomainStore(":memory:");
    try {
      const analysisId = store.saveAnalysis(analysisResult, "gpt-5.6-luna");
      const analysis = store.getTestDesignAnalysis(analysisId);
      const draft: GeneratedTestCaseInput = {
        title: "售后申请",
        objective: "验证售后申请流程",
        preconditions: [],
        steps: ["提交售后申请"],
        expectedResults: ["展示售后单号"],
        priority: "must",
        requirementIds: [analysis.requirements[0].id],
        riskIds: [analysis.risks[0].id],
        evidenceIds: [analysis.evidence[0].id],
      };
      const output = completeDesign(analysis, draft);
      output.testCases[0].acceptanceCriteriaRefs = [];

      expect(() => validateGeneratedTestDesign(analysis, [pdfSource], output)).toThrow("验收标准覆盖不完整");
    } finally {
      store.close();
    }
  });

  it("maps compact model aliases back to the selected analysis trace IDs", () => {
    const store = new DomainStore(":memory:");
    try {
      const analysisId = store.saveAnalysis(analysisResult, "gpt-5.6-luna");
      const analysis = store.getTestDesignAnalysis(analysisId);
      const partition: CoveragePartition = {
        partitionKey: "after-sale-request",
        title: "售后申请",
        requirementAliases: ["R1"],
        acceptanceCriterionAliases: ["Q1"],
        riskAliases: ["K1"],
        evidenceAliases: ["E1"],
      };
      const modelCase: AliasTestCase = {
        title: "重复提交只生成一个售后单",
        objective: "验证重复提交的幂等性",
        preconditions: ["存在可申请售后的订单"],
        steps: ["连续两次提交同一售后申请"],
        expectedResults: ["页面只展示一个售后单号"],
        priority: "must",
        requirementAliases: ["R1"],
        acceptanceCriterionAliases: ["Q1"],
        riskAliases: ["K1"],
        evidenceAliases: ["E1"],
      };

      const mapped = validateReviewedPartition(analysis, [pdfSource], partition, [modelCase]);
      expect(mapped[0]).toMatchObject({
        requirementIds: [analysis.requirements[0].id],
        riskIds: [analysis.risks[0].id],
        evidenceIds: [analysis.evidence[0].id],
      });
    } finally {
      store.close();
    }
  });

  it("rejects an independently reviewed batch before persistence when evidence is absent or outside its partition", () => {
    const store = new DomainStore(":memory:");
    try {
      const analysisId = store.saveAnalysis(analysisResult, "gpt-5.6-luna");
      const analysis = store.getTestDesignAnalysis(analysisId);
      const partition: CoveragePartition = {
        partitionKey: "after-sale-request",
        title: "售后申请",
        requirementAliases: ["R1"],
        acceptanceCriterionAliases: ["Q1"],
        riskAliases: ["K1"],
        evidenceAliases: ["E1"],
      };
      const base: AliasTestCase = {
        title: "提交售后申请",
        objective: "验证申请流程",
        preconditions: [],
        steps: ["提交售后申请"],
        expectedResults: ["展示售后单号"],
        priority: "must",
        requirementAliases: [],
        acceptanceCriterionAliases: [],
        riskAliases: [],
        evidenceAliases: [],
      };

      expect(() => validateReviewedPartition(analysis, [pdfSource], partition, [base]))
        .toThrow("没有任何需求分析、PRD 或 RAG 证据");
      expect(() => validateReviewedPartition(analysis, [pdfSource], partition, [{
        ...base,
        requirementAliases: ["R2"],
      }])).toThrow("引用了分区外的 Requirement");
    } finally {
      store.close();
    }
  });
});
