import { describe, expect, it } from "vitest";
import {
  assessControlledBenchmarkReadiness,
  assessProfileReadiness,
  assessQuality,
  type ControlledBenchmarkEvidence,
} from "../server/ai-quality/profile.js";
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

describe("AI 质量证据画像", () => {
  const qualityDocument = {
    open_questions: [
      { id: "OQ-1", issue_type: "missing", source_refs: [] },
      { id: "OQ-2", issue_type: "ambiguity", source_refs: ["SRC-1"] },
      { id: "OQ-3", issue_type: "conflict", source_refs: ["SRC-1", "SRC-2"] },
    ],
  } as RequirementAnalysis;

  it("区分已测指标和当前无法证明的召回率、鲁棒性", () => {
    const result = assessQuality(qualityDocument, [
      review("OQ-1", "accepted"),
      review("OQ-2", "merged"),
      review("OQ-3", "rejected"),
    ]);

    expect(result.verdict).toBe("candidate");
    expect(result.metrics.find((metric) => metric.id === "human-confirmed-rate")).toMatchObject({
      status: "warning",
      value: "66.7%（2/3）",
    });
    expect(result.metrics.find((metric) => metric.id === "citation-completeness")).toMatchObject({
      status: "passed",
      value: "100.0%（2/2）",
    });
    expect(result.metrics.find((metric) => metric.id === "defect-recall")?.status).toBe("unknown");
    expect(result.unknown.join(" ")).toContain("漏掉");
  });

  it("人工评审未完成时不把单次运行描述成质量基线", () => {
    const result = assessQuality(qualityDocument, [review("OQ-1", "accepted")]);
    expect(result.verdict).toBe("insufficient-evidence");
    expect(result.confidence).toBe("low");
  });

  it("引用缺失会形成明确告警", () => {
    const invalidCitationDocument = {
      open_questions: [{ id: "OQ-1", issue_type: "conflict", source_refs: ["SRC-1"] }],
    } as RequirementAnalysis;
    const result = assessQuality(invalidCitationDocument, [review("OQ-1", "accepted")]);
    expect(result.metrics.find((metric) => metric.id === "citation-completeness")).toMatchObject({
      status: "warning",
      value: "0.0%（0/1）",
    });
  });

  it("接入受控实验后展示检出率，但不冒充真实业务召回率", () => {
    const controlled: ControlledBenchmarkEvidence = {
      datasetId: "DS-1", datasetVersionId: "DV-1", experimentId: "EXP-1",
      benchmarkVersion: "controlled-v0", dataClass: "controlled-synthetic",
      totalRuns: 20, successfulRuns: 19, detectedRuns: 19, overreportingReviewRuns: 12,
      averageOpenQuestions: 3.79, latencyP50Ms: 15_171, latencyP95Ms: 23_074, totalTokens: 182_449,
    };
    const result = assessQuality(qualityDocument, [
      review("OQ-1", "accepted"), review("OQ-2", "accepted"), review("OQ-3", "accepted"),
    ], controlled);
    expect(result.metrics.find((metric) => metric.id === "defect-recall")).toMatchObject({
      status: "passed",
      value: "95.0%（19/20）",
    });
    expect(result.metrics.find((metric) => metric.id === "overreporting-review-rate")).toMatchObject({
      status: "warning",
      value: "60.0%（12/20）",
    });
    expect(result.unknown.join(" ")).toContain("真实业务问题仍然未知");
  });
});

describe("受控基准准入", () => {
  const evidence: ControlledBenchmarkEvidence = {
    datasetId: "DS-1", datasetVersionId: "DV-1", experimentId: "EXP-1",
    benchmarkVersion: "controlled-v0", dataClass: "controlled-synthetic",
    totalRuns: 20, successfulRuns: 19, detectedRuns: 19, overreportingReviewRuns: 12,
    averageOpenQuestions: 3.79, latencyP50Ms: 15_171, latencyP95Ms: 23_074, totalTokens: 182_449,
  };

  it("不会用高召回率抵消运行失败和过度报告", () => {
    const blockers = assessControlledBenchmarkReadiness({
      minimumOpenQuestions: 8,
      requiredIssueTypes: ["missing", "ambiguity"],
      requiredTopicGroups: [],
      maximumAgentLatencyMs: 600_000,
      maximumTotalTokens: 300_000,
      minimumControlledRecall: 0.9,
      minimumControlledRunSuccess: 1,
      maximumOverreportingReviewRate: 0.5,
    }, evidence);
    expect(blockers).toHaveLength(2);
    expect(blockers.join(" ")).toContain("运行成功率 95.0%");
    expect(blockers.join(" ")).toContain("过度报告复核率 60.0%");
  });
});
