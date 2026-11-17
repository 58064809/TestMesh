import { describe, expect, it, vi } from "vitest";
import {
  buildFrozenExamples,
  buildDatasetSpecification,
  EvaluationSamplePayloadSchema,
  EvaluationSampleReviewSchema,
  EvaluationSampleService,
} from "../server/ai-quality/evaluation-samples.js";

const approved = {
  record: { id: "approved-v1", designId: "design-1", version: 1, approvedBy: "reviewer", approvedAt: "2026-10-30T00:00:00Z" },
  snapshot: {
    test_cases: [
      { id: "TC-001", primary_test_condition_ref: "TCND-001", primary_trace_ref: "BR-001", risk_refs: ["RISK-001"], ai_evaluation: { dimension: "intent_recognition", evaluator: "intent-code" } },
      { id: "TC-002", primary_test_condition_ref: "TCND-002", primary_trace_ref: "BR-001", risk_refs: ["RISK-001"], ai_evaluation: { dimension: "multi_turn_context", evaluator: "context-code" } },
    ],
  },
};

function set(samples: Array<Record<string, unknown>> = []) {
  return {
    id: "set-1", approvedTestCaseVersionId: "approved-v1", name: "售后 Agent 回归集",
    status: "draft", version: 1, contentSha256: "", frozenBy: "", frozenAt: null,
    createdBy: "路昭凡", createdAt: "2026-10-30T00:00:00Z", samples,
  };
}

function sample(id: string, testCaseId: string, status: "draft" | "approved" | "rejected") {
  return {
    id, sampleSetId: "set-1", approvedTestCaseId: testCaseId,
    aiDimension: testCaseId === "TC-002" ? "multi_turn_context" : "intent_recognition",
    input: { message: "我要退款" }, expected: { intent: "refund" }, metadata: {}, status,
    reviewNote: "", reviewedBy: status === "draft" ? "" : "路昭凡",
    reviewedAt: status === "draft" ? null : "2026-10-30T00:00:00Z",
    createdBy: "路昭凡", createdAt: "2026-10-30T00:00:00Z", updatedAt: "2026-10-30T00:00:00Z",
  };
}

describe("AI evaluation sample lifecycle", () => {
  it("keeps model, condition, case, risk and evaluator lineage in Phoenix examples", () => {
    const rows = buildFrozenExamples(set([sample("s1", "TC-001", "approved")]) as never, "model-v1", approved.snapshot.test_cases as never);
    expect(rows[0].metadata).toMatchObject({
      approvedTestModelVersionId: "model-v1", modelElementId: "BR-001", testConditionId: "TCND-001",
      approvedTestCaseId: "TC-001", riskIds: ["RISK-001"], evaluatorName: "intent-code",
    });
  });

  it("derives dataset design from approved AI cases and their test conditions", () => {
    const specification = buildDatasetSpecification("approved-v1", [{
      id: "TC-001", title: "退款意图", priority: "P1", source_refs: ["SRC-001"], risk_refs: ["RISK-001"],
      primary_test_condition_ref: "TCND-001", ai_evaluation: {
        dimension: "intent_recognition", evaluation_subjects: ["target_application"], evaluation_layers: ["agent_decision"],
        oracle_type: "exact_match", evaluator: "intent-code", threshold: "exact", expected_behavior: "识别退款",
        dataset_requirements: ["正常与歧义表达"], evidence_requirements: ["决策事件"],
      },
    }] as never);
    expect(specification.cases[0]).toMatchObject({
      testCaseId: "TC-001", testConditionId: "TCND-001", datasetRequirements: ["正常与歧义表达"],
    });
  });

  it("blocks a frozen dataset when accepted samples duplicate the same case and input", async () => {
    const aiStore = { getEvaluationSampleSet: vi.fn().mockResolvedValue(set([
      sample("s1", "TC-001", "approved"), sample("s2", "TC-001", "approved"), sample("s3", "TC-002", "approved"),
    ])) };
    const service = new EvaluationSampleService(
      { getApprovedVersionById: vi.fn().mockResolvedValue(approved), getDesign: vi.fn().mockResolvedValue({ approvedTestModelVersionId: "model-v1" }) } as never, aiStore as never,
    );
    expect((await service.readiness("set-1")).blockers).toContain("用例 TC-001 存在重复输入样本");
  });

  it("requires executable input and rejects placeholder evidence", async () => {
    expect(EvaluationSamplePayloadSchema.safeParse({
      approvedTestCaseId: "TC-001", input: {}, expected: { intent: "refund" }, operator: "路昭凡",
    }).success).toBe(false);
    const store = { getEvaluationSampleSet: vi.fn().mockResolvedValue(set()) };
    const service = new EvaluationSampleService(
      { getApprovedVersionById: vi.fn().mockResolvedValue(approved) } as never, store as never,
    );
    await expect(service.saveSample("set-1", {
      approvedTestCaseId: "TC-001", input: { message: "待配置" }, expected: { intent: "refund" },
      metadata: { fixtureRefs: [], sourceRefs: [], expectedTools: [], forbiddenTools: [], tags: [], heldOut: false, sourceKind: "human_curated", evaluationSubject: "target_application", evaluationLayer: "final_response" }, operator: "路昭凡",
    })).rejects.toThrow("占位内容");
  });

  it("requires a reason when a human rejects a sample", () => {
    expect(EvaluationSampleReviewSchema.safeParse({ status: "rejected", reviewedBy: "路昭凡", reviewNote: "" }).success).toBe(false);
  });

  it("blocks freezing until every approved AI TestCase has accepted evidence", async () => {
    const aiStore = { getEvaluationSampleSet: vi.fn().mockResolvedValue(set([sample("s1", "TC-001", "approved")])) };
    const service = new EvaluationSampleService(
      { getApprovedVersionById: vi.fn().mockResolvedValue(approved) } as never, aiStore as never,
    );
    const readiness = await service.readiness("set-1");
    expect(readiness.ready).toBe(false);
    expect(readiness.missingTestCaseIds).toEqual(["TC-002"]);
    expect(readiness.coveredAiTestCases).toBe(1);
  });

  it("freezes a complete human-approved sample set with a deterministic hash", async () => {
    const current = set([sample("s1", "TC-001", "approved"), sample("s2", "TC-002", "approved")]);
    const aiStore = {
      getEvaluationSampleSet: vi.fn().mockResolvedValue(current),
      freezeEvaluationSampleSet: vi.fn().mockImplementation((_id, hash) => ({ ...current, status: "frozen", contentSha256: hash })),
    };
    const service = new EvaluationSampleService(
      { getApprovedVersionById: vi.fn().mockResolvedValue(approved), getDesign: vi.fn().mockResolvedValue({ approvedTestModelVersionId: "model-v1" }) } as never, aiStore as never,
    );
    const frozen = await service.freeze("set-1", "路昭凡");
    expect(frozen.status).toBe("frozen");
    expect(frozen.contentSha256).toMatch(/^[a-f0-9]{64}$/);
  });
});
