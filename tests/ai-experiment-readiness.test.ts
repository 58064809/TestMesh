import { describe, expect, it } from "vitest";
import { buildAiExperimentReadiness } from "../server/ai-quality/experiment-readiness.js";
import { AiExperimentRunInputSchema, deterministicExecutionEvaluations } from "../server/ai-quality/experiment-run.js";
import type { AiDatasetExportRecord, ApprovedApiScenarioRecord } from "../server/ai-quality/postgres-store.js";

const datasetExport: AiDatasetExportRecord = {
  id: "export-1",
  approvedTestCaseVersionId: "approved-v2",
  datasetName: "approved-ai-v2",
  datasetId: "dataset-1",
  datasetVersionId: "dataset-version-1",
  contentSha256: "a".repeat(64),
  exampleCount: 2,
  aiDimensions: ["intent_recognition", "tool_invocation"],
  dataClass: "evaluation-dataset",
  exportedBy: "路昭凡",
  createdAt: "2026-10-29T00:00:00.000Z",
};

function asset(id: string, testCaseIds: string[], contract = true): ApprovedApiScenarioRecord {
  return {
    id,
    approvedTestCaseVersionId: "approved-v2",
    approvedTestCaseIds: testCaseIds,
    name: id,
    yamlContent: contract ? `format: testmesh-api/v1
name: ${id}
ai_application:
  target_id: after-sales-agent
  target_version: candidate-v1
  interaction: agent
  session_id_variable: session_id
  trace_id_variable: trace_id
  require_trace: true
  observability_standard: openinference
  evaluation_provider: phoenix
  evaluator_names: [intent_correctness, tool_trajectory]
steps:
  - request:
      name: sample
      method: POST
      path: /agent
      json: {message: "\${dataset_input.message}"}
` : "format: testmesh-api/v1\nname: missing-contract\nsteps: []\n",
    contentSha256: id.padEnd(64, "0"),
    approvedBy: "reviewer",
    approvedAt: "2026-10-29T00:00:00.000Z",
  };
}

describe("AIAT03 experiment execution readiness", () => {
  it("requires one valid approved AI execution asset for every frozen AI TestCase", () => {
    const result = buildAiExperimentReadiness({
      datasetExport,
      aiTestCaseIds: ["TC-AI-001", "TC-AI-002"],
      approvedAssets: [asset("scenario-1", ["TC-AI-001"]), asset("scenario-2", ["TC-AI-002"])],
    });

    expect(result.ready).toBe(true);
    expect(result.mappedAiTestCases).toBe(2);
    expect(result.validExecutionAssets).toBe(2);
    expect(result.gateEligible).toBe(false);
  });

  it("reports missing scripts and invalid AI contracts without inventing execution evidence", () => {
    const result = buildAiExperimentReadiness({
      datasetExport,
      aiTestCaseIds: ["TC-AI-001", "TC-AI-002"],
      approvedAssets: [asset("scenario-invalid", ["TC-AI-001"], false)],
    });

    expect(result.ready).toBe(false);
    expect(result.missingTestCaseIds).toEqual(["TC-AI-001", "TC-AI-002"]);
    expect(result.invalidAssets).toHaveLength(1);
    expect(result.blockers.join(" ")).toContain("尚未关联");
  });

  it("rejects ambiguous duplicate execution mappings", () => {
    const result = buildAiExperimentReadiness({
      datasetExport,
      aiTestCaseIds: ["TC-AI-001"],
      approvedAssets: [asset("scenario-1", ["TC-AI-001"]), asset("scenario-2", ["TC-AI-001"])],
    });

    expect(result.ready).toBe(false);
    expect(result.duplicateTestCaseIds).toEqual(["TC-AI-001"]);
  });

  it("uses deterministic TestRun and OpenInference evidence checks without pretending to be a semantic judge", () => {
    expect(deterministicExecutionEvaluations({
      status: "passed",
      items_json: [{ name: "AI 应用证据契约", status: "passed" }],
    })).toEqual({ executionPassed: true, evidencePassed: true });
    expect(deterministicExecutionEvaluations({
      status: "failed",
      items_json: [{ name: "AI 应用证据契约", status: "failed" }],
    })).toEqual({ executionPassed: false, evidencePassed: false });
  });

  it("bounds experiment concurrency and requires an operator", () => {
    expect(AiExperimentRunInputSchema.safeParse({ datasetExportId: "export-1", requestedBy: "路昭凡", concurrency: 2 }).success).toBe(true);
    expect(AiExperimentRunInputSchema.safeParse({ datasetExportId: "export-1", requestedBy: "", concurrency: 2 }).success).toBe(false);
    expect(AiExperimentRunInputSchema.safeParse({ datasetExportId: "export-1", requestedBy: "路昭凡", concurrency: 20 }).success).toBe(false);
  });
});
