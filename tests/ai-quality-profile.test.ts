import { describe, expect, it } from "vitest";
import { assessProfileReadiness } from "../server/ai-quality/profile.js";
import type { RequirementAnalysis } from "../server/requirement-analysis/schema.js";
import type { AnalysisReviewRecord } from "../server/requirement-analysis/postgres-store.js";

const document = {
  open_questions: [
    { id: "OQ-1" },
    { id: "OQ-2" },
  ],
} as RequirementAnalysis;

function review(itemId: string, status: AnalysisReviewRecord["status"]): AnalysisReviewRecord {
  return {
    id: `REV-${itemId}`, analysisId: "AN-1", itemId, status, reviewer: "张三", reason: "已核对",
    issueType: "missing", mergeInto: "", decision: "待补充", decisionBy: "李四", prdRevision: "V1.1",
    createdAt: "2026-10-09T00:00:00.000Z",
  };
}

describe("AI 质量评测配置批准前置检查", () => {
  it("阻止尚有待评审问题的配置被批准", () => {
    const result = assessProfileReadiness(document, [review("OQ-1", "accepted")]);
    expect(result.ready).toBe(false);
    expect(result.reviewedOpenQuestions).toBe(1);
    expect(result.blockers[0]).toContain("OQ-2");
  });

  it("所有待确认问题形成明确结论后允许提交批准", () => {
    const result = assessProfileReadiness(document, [
      review("OQ-1", "accepted"),
      review("OQ-2", "rejected"),
    ]);
    expect(result).toMatchObject({ ready: true, totalOpenQuestions: 2, reviewedOpenQuestions: 2, blockers: [] });
  });

  it("需要继续澄清的问题不计为完成", () => {
    const result = assessProfileReadiness(document, [review("OQ-1", "accepted"), review("OQ-2", "clarify")]);
    expect(result.ready).toBe(false);
    expect(result.reviewedOpenQuestions).toBe(1);
  });
});
