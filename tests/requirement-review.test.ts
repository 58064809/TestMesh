import { describe, expect, it } from "vitest";
import { DomainStore, type AnalysisReviewInput } from "../server/store.js";
import { createSources, type RequirementAnalysis } from "../server/analysis.js";
import { renderReviewMarkdown, reviewEntries, unresolvedDecisionEntries, visibleReviewEntries } from "../src/review-report.js";

const document: RequirementAnalysis = {
  summary: null,
  requirements: [{ id: "REQ-1", description: "续费成功后增加 365 天", origin: "explicit", source_refs: ["SRC-1"], confidence: 0.95, acceptance_criteria: [] }],
  actors: [], business_rules: [], flows: [], states: [], constraints: [], exceptions: [],
  open_questions: [{ id: "OQ-1", description: "从支付时间还是原到期时间开始算？", origin: "inferred", issue_type: "ambiguity", source_refs: ["SRC-1"], confidence: 0.9 }],
  sources: [{ id: "SRC-1", description: "续费规则原文", origin: "explicit", source_refs: [], confidence: 1,
    source_file_id: "ATT-1", source_file_name: "prd.md", locator_type: "paragraph", locator: "1", excerpt: "续费成功后有效期增加 365 天" }],
};

const accepted: AnalysisReviewInput = {
  status: "accepted", reviewer: "测试评审人", reason: "原文已核对", evidenceChecked: true,
  issueType: "", mergeInto: "", decision: "", decisionBy: "", prdRevision: "",
};
const sourceFiles = createSources([{ originalname: "prd.md", mimetype: "text/markdown", buffer: Buffer.from("续费成功后有效期增加 365 天") }], []);

describe("requirement review and approved baseline", () => {
  it("exports only the selected review projection and keeps rejected items in history", () => {
    const store = new DomainStore(":memory:");
    try {
      const analysisId = store.saveRequirementAnalysis(document, "gpt-5.6-luna", sourceFiles);
      store.recordAnalysisReview(analysisId, "REQ-1", accepted);
      store.recordAnalysisReview(analysisId, "OQ-1", { ...accepted, status: "rejected", reviewer: "", reason: "", evidenceChecked: false });
      const reviews = store.listAnalysisReviews(analysisId);
      const entries = reviewEntries(document, reviews);
      expect(visibleReviewEntries(entries, "pending")).toHaveLength(0);
      expect(visibleReviewEntries(entries, "accepted").map(({ item }) => item.id)).toEqual(["REQ-1"]);
      expect(renderReviewMarkdown(document, reviews, "accepted")).toContain("REQ-1");
      expect(renderReviewMarkdown(document, reviews, "accepted")).not.toContain("OQ-1");
      expect(renderReviewMarkdown(document, reviews, "all")).toContain("OQ-1");
      expect(renderReviewMarkdown(document, reviews, "all")).toContain("AI 问题分类：歧义");
      expect(store.listAnalysisReviewHistory(analysisId, "OQ-1")).toHaveLength(1);
    } finally { store.close(); }
  });

  it("keeps AI output unchanged while filtering decisions and freezing an approved revision", () => {
    const store = new DomainStore(":memory:");
    try {
      const analysisId = store.saveRequirementAnalysis(document, "gpt-5.6-luna", sourceFiles);
      expect(store.listAnalysisReviews(analysisId)).toEqual([]);
      store.recordAnalysisReview(analysisId, "REQ-1", { ...accepted, reviewer: "", reason: "", evidenceChecked: false });
      store.recordAnalysisReview(analysisId, "REQ-1", { ...accepted, reviewer: "复核人", reason: "再次核对图片" });
      expect(store.listAnalysisReviewHistory(analysisId, "REQ-1").map((event) => event.reviewer)).toEqual(["复核人", ""]);
      expect(store.listAnalysisReviews(analysisId).find((event) => event.itemId === "REQ-1")?.reviewer).toBe("复核人");
      expect(() => store.createRequirementBaseline(analysisId, {
        prdRevision: "v1.0", approvedBy: "产品负责人", previousBaselineId: null,
        prdFilename: "评审后PRD.md", prdFile: Buffer.from("续费从原到期时间累加365天"),
      })).toThrow("未完成评审");

      store.recordAnalysisReview(analysisId, "OQ-1", {
        ...accepted, issueType: "ambiguity", decision: "从原到期时间继续累加 365 天",
        decisionBy: "产品负责人", prdRevision: "v1.0",
      });
      const reviews = store.listAnalysisReviews(analysisId);
      expect(reviews).toHaveLength(2);
      expect(reviews.find((item) => item.itemId === "OQ-1")?.issueType).toBe("ambiguity");
      expect(store.getRequirementAnalysis(analysisId)).toEqual(document);

      const file = Buffer.from("续费从原到期时间累加365天");
      expect(() => store.createRequirementBaseline(analysisId, {
        prdRevision: "v1.1", approvedBy: "产品负责人", previousBaselineId: null,
        prdFilename: "评审后PRD.md", prdFile: file,
      })).toThrow("不一致");
      const baseline = store.createRequirementBaseline(analysisId, {
        prdRevision: "v1.0", approvedBy: "产品负责人", previousBaselineId: null,
        prdFilename: "评审后PRD.md", prdFile: file,
      });
      expect(baseline.version).toBe(1);
      expect(store.getRequirementBaseline(baseline.id).file).toEqual(file);
      expect(store.listRequirementBaselines()).toHaveLength(1);
      expect(() => store.recordAnalysisReview(analysisId, "REQ-1", accepted)).toThrow("已冻结");
      expect(() => store.createRequirementBaseline(analysisId, {
        prdRevision: "v1.1", approvedBy: "产品负责人", previousBaselineId: baseline.id,
        prdFilename: "更新PRD.md", prdFile: file,
      })).toThrow("不能覆盖");
    } finally {
      store.close();
    }
  });

  it("lists every accepted open question that still lacks a complete baseline decision", () => {
    const store = new DomainStore(":memory:");
    const secondQuestion = { ...document.open_questions[0], id: "OQ-2", description: "退款到账时间是否按自然日计算？" };
    const expandedDocument: RequirementAnalysis = { ...document, open_questions: [...document.open_questions, secondQuestion] };
    try {
      const analysisId = store.saveRequirementAnalysis(expandedDocument, "gpt-5.6-luna", sourceFiles);
      store.recordAnalysisReview(analysisId, "REQ-1", accepted);
      store.recordAnalysisReview(analysisId, "OQ-1", { ...accepted, issueType: "ambiguity" });
      store.recordAnalysisReview(analysisId, "OQ-2", { ...accepted, issueType: "missing" });
      const entries = reviewEntries(expandedDocument, store.listAnalysisReviews(analysisId));
      expect(unresolvedDecisionEntries(entries).map(({ item }) => item.id)).toEqual(["OQ-1", "OQ-2"]);
      expect(() => store.createRequirementBaseline(analysisId, {
        prdRevision: "v1.0", approvedBy: "产品负责人", previousBaselineId: null,
        prdFilename: "评审后PRD.md", prdFile: Buffer.from("approved"),
      })).toThrow("OQ-1、OQ-2");
    } finally { store.close(); }
  });

  it("creates a later baseline from a new analysis without overwriting the previous one", () => {
    const store = new DomainStore(":memory:");
    try {
      const firstId = store.saveRequirementAnalysis(document, "gpt-5.6-luna", sourceFiles);
      store.recordAnalysisReview(firstId, "REQ-1", accepted);
      store.recordAnalysisReview(firstId, "OQ-1", { ...accepted, issueType: "ambiguity", decision: "原到期日累加", decisionBy: "产品负责人", prdRevision: "v1" });
      const first = store.createRequirementBaseline(firstId, { prdRevision: "v1", approvedBy: "产品负责人", previousBaselineId: null,
        prdFilename: "prd.md", prdFile: Buffer.from("v1") });

      const secondId = store.saveRequirementAnalysis(document, "gpt-5.6-luna", sourceFiles);
      store.recordAnalysisReview(secondId, "REQ-1", accepted);
      store.recordAnalysisReview(secondId, "OQ-1", { ...accepted, issueType: "ambiguity", decision: "原到期日累加", decisionBy: "产品负责人", prdRevision: "v2" });
      const second = store.createRequirementBaseline(secondId, { prdRevision: "v2", approvedBy: "产品负责人", previousBaselineId: first.id,
        prdFilename: "prd.md", prdFile: Buffer.from("v2") });
      expect(second.version).toBe(2);
      expect(second.previousBaselineId).toBe(first.id);
      expect(store.getRequirementBaseline(first.id).file.toString()).toBe("v1");
      expect(store.getRequirementBaseline(second.id).file.toString()).toBe("v2");
    } finally {
      store.close();
    }
  });
});
