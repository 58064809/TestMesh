import { describe, expect, it } from "vitest";
import {
  ImprovementActionUpdateSchema,
  QualityPlanInputSchema,
  RiskAcceptanceSchema,
} from "../server/quality-management/schema.js";
import { assessAiEvaluationEvidence } from "../server/quality-management/service.js";

function qualityPlan() {
  return {
    projectId: "project-1",
    name: "AI 售后系统质量计划",
    release: "R1",
    owner: "质量负责人",
    objectives: ["核心业务和 AI 回复均具有可复核证据"],
    qualityCharacteristics: [
      "functional_suitability",
      "ai_intent_recognition",
      "ai_multi_turn_context",
      "ai_constraint_adherence",
      "ai_response_correctness",
      "ai_groundedness_hallucination",
    ],
    risks: [{ id: "R-001", title: "AI 幻觉", probability: "medium", impact: "high", treatment: "基于证据回答并运行 groundedness evaluator", owner: "AI测试" }],
    scope: "需求、业务测试、Testing for AI、API/UI执行和发布准入",
    exclusions: [],
    strategies: ["风险驱动测试设计", "Phoenix Dataset/Experiment/Eval"],
    entryCriteria: ["需求基线已批准"],
    exitCriteria: ["OPA 发布准入通过"],
    requiredEvidence: ["Approved TestCase", "TestRun", "Phoenix Experiment"],
    approvers: ["质量负责人"],
    baselineId: "baseline-1",
    approvedTestModelVersionId: "test-model-version-1",
    approvedTestCaseVersionId: "testcase-version-1",
    aiQualityProfileId: "ai-profile-1",
    gateRules: {
      requireApprovedBaseline: true,
      requireApprovedTestModel: true,
      requireApprovedTestCases: true,
      minimumRequirementCoveragePct: 100,
      minimumExecutionPassRatePct: 100,
      maximumFailedTests: 0,
      requireApiExecution: true,
      requireUiExecution: true,
      requireApprovedAiQualityProfile: true,
      maximumOpenImprovementActions: 0,
    },
  };
}

describe("QM01 quality management schemas", () => {
  it("accepts a quality plan that governs business and AI quality together", () => {
    expect(QualityPlanInputSchema.parse(qualityPlan()).qualityCharacteristics).toContain("ai_groundedness_hallucination");
  });

  it("requires verification evidence before an improvement can be verified or closed", () => {
    expect(ImprovementActionUpdateSchema.safeParse({ status: "closed", verificationEvidence: "", updatedBy: "tester" }).success).toBe(false);
    expect(ImprovementActionUpdateSchema.safeParse({ status: "closed", verificationEvidence: "Phoenix experiment exp-1 passed", updatedBy: "tester" }).success).toBe(true);
  });

  it("requires an accountable owner and reason for release risk acceptance", () => {
    expect(RiskAcceptanceSchema.safeParse({ acceptedBy: "", reason: "", expiresAt: null }).success).toBe(false);
    expect(RiskAcceptanceSchema.safeParse({ acceptedBy: "质量负责人", reason: "限定灰度范围并在两天内关闭", expiresAt: null }).success).toBe(true);
  });
});

describe("QM01 Testing for AI evidence linkage", () => {
  const profile = (phoenixOverrides: Record<string, unknown> = {}) => ({
    id: "profile-1", name: "AI售后评测", version: "v1", status: "approved" as const,
    targetName: "AI售后Agent", targetVersion: "v1", environment: "test", sourceAnalysisId: "analysis-1",
    sourceFilename: "prd.pdf", sourceSha256: "sha",
    criteria: { minimumOpenQuestions: 0, requiredIssueTypes: [], requiredTopicGroups: [], maximumAgentLatencyMs: 1, maximumTotalTokens: 1 },
    phoenix: { endpoint: "http://127.0.0.1:6006", projectName: "ai-after-sales", datasetId: "dataset-1", experimentId: "experiment-1", traceId: "trace-1", ...phoenixOverrides },
    approvedBy: "路昭凡", approvalNote: "approved", approvedAt: "2026-10-18T00:00:00.000Z", createdAt: "2026-10-18T00:00:00.000Z",
  });

  it("rejects an approved but unrelated Phoenix profile", () => {
    const result = assessAiEvaluationEvidence("approved-v2", ["TC-001", "TC-002"], profile());
    expect(result.linked).toBe(false);
    expect(result.missingTestCaseIds).toEqual(["TC-001", "TC-002"]);
  });

  it("rejects Phoenix evidence linked to another Approved TestCase version", () => {
    const result = assessAiEvaluationEvidence("approved-v2", ["TC-001"], profile({ testCaseEvaluation: {
      approvedTestCaseVersionId: "approved-v1", datasetVersionId: "dataset-version-1", evaluatedTestCaseIds: ["TC-001"], evaluatorNames: ["groundedness"], status: "passed", completedAt: "2026-10-18T00:00:00.000Z",
    } }));
    expect(result.linked).toBe(false);
    expect(result.evaluatedTestCases).toBe(0);
  });

  it("accepts complete passing Phoenix references for the current AI TestCases", () => {
    const result = assessAiEvaluationEvidence("approved-v2", ["TC-001", "TC-002"], profile({ testCaseEvaluation: {
      approvedTestCaseVersionId: "approved-v2", datasetVersionId: "dataset-version-2", evaluatedTestCaseIds: ["TC-001", "TC-002"], evaluatorNames: ["groundedness", "code-evaluator"], status: "passed", completedAt: "2026-10-18T00:00:00.000Z",
    } }));
    expect(result).toEqual({ linked: true, evaluatedTestCases: 2, missingTestCaseIds: [] });
  });
});
