import { describe, expect, it, vi } from "vitest";
import { AiDatasetExportService, buildAiDatasetPreview } from "../server/ai-quality/dataset-export.js";
import { TestCaseSchema } from "../server/test-design/schema.js";

function aiTestCase(id = "TC-001") {
  return TestCaseSchema.parse({
    id,
    module: "售后 Agent",
    title: "识别退款意图",
    objective: "验证用户表达退款诉求时识别正确意图",
    primary_trace_ref: "REQ-001",
    primary_test_condition_ref: "TCND-001",
    test_condition_refs: ["TCND-001"],
    scenario_type: "ai_behavior",
    technique: "ai_evaluation",
    priority: "P0",
    preconditions: ["目标 Agent 版本已部署"],
    test_data: ["我要退掉刚买的商品"],
    steps: [{ order: 1, action: "发送退款表达", expected: "识别为退款意图并进入退款流程" }],
    gherkin: "# language: zh-CN\n场景: 识别退款意图\n假如 Agent 可用\n当 用户表达退款诉求\n那么 应识别退款意图",
    trace_refs: ["REQ-001"],
    risk_refs: ["RISK-001"],
    test_point_refs: ["TP-001"],
    source_refs: ["SRC-001"],
    knowledge_refs: [],
    ai_evaluation: {
      dimension: "intent_recognition",
      oracle_type: "reference_answer",
      expected_behavior: "识别为退款意图，不得误判为物流查询",
      evaluator: "intent_correctness",
      threshold: "score >= 0.9",
      dataset_requirements: ["包含标准表达、口语改写和相近干扰意图"],
      evidence_requirements: ["保存输出、Trace ID 和评测得分"],
    },
  });
}

describe("AIAT02 Phoenix Dataset export", () => {
  it("maps only frozen AI test semantics into deterministic Phoenix examples", () => {
    const first = buildAiDatasetPreview({
      approvedVersionId: "approved-v2",
      approvedVersion: 2,
      testCases: [aiTestCase()],
    });
    const second = buildAiDatasetPreview({
      approvedVersionId: "approved-v2",
      approvedVersion: 2,
      testCases: [aiTestCase()],
    });

    expect(first.preview.contentSha256).toBe(second.preview.contentSha256);
    expect(first.preview.exampleCount).toBe(1);
    expect(first.preview.dataClass).toBe("test-plan-manifest");
    expect(first.preview.aiDimensions).toEqual(["intent_recognition"]);
    expect(first.examples[0].id).toBe("approved-v2:TC-001");
    expect(first.examples[0].metadata).toMatchObject({
      approvedTestCaseVersionId: "approved-v2",
      approvedTestCaseId: "TC-001",
      evaluator: "intent_correctness",
    });
    expect(first.examples[0].output).toMatchObject({
      oracleType: "reference_answer",
      threshold: "score >= 0.9",
    });
  });

  it("refuses to create an AI dataset when the approved version has no AI cases", () => {
    const ordinary = aiTestCase();
    delete ordinary.ai_evaluation;
    expect(() => buildAiDatasetPreview({
      approvedVersionId: "approved-v1",
      approvedVersion: 1,
      testCases: [ordinary],
    })).toThrow("没有 Testing for AI 用例");
  });

  it("reuses an existing immutable mapping instead of creating another Phoenix version", async () => {
    const approved = {
      record: { id: "approved-v2", designId: "design-2", version: 2, approvedBy: "reviewer", approvedAt: "2026-10-29T00:00:00Z" },
      snapshot: { test_cases: [aiTestCase()] },
    };
    const preview = buildAiDatasetPreview({
      approvedVersionId: "approved-v2", approvedVersion: 2, testCases: approved.snapshot.test_cases,
    }).preview;
    const existing = {
      id: "export-1", approvedTestCaseVersionId: "approved-v2", datasetName: preview.datasetName,
      datasetId: "dataset-1", datasetVersionId: "version-1", contentSha256: preview.contentSha256,
      exampleCount: 1, aiDimensions: ["intent_recognition"], dataClass: "test-plan-manifest", exportedBy: "reviewer", createdAt: "2026-10-29T00:00:00Z",
    };
    const sync = vi.fn();
    const service = new AiDatasetExportService(
      { getApprovedVersionById: vi.fn().mockResolvedValue(approved) } as never,
      { findDatasetExport: vi.fn().mockResolvedValue(existing) } as never,
      "http://127.0.0.1:6006",
      sync,
    );

    await expect(service.export("approved-v2", "reviewer")).resolves.toEqual(existing);
    expect(sync).not.toHaveBeenCalled();
  });
});
