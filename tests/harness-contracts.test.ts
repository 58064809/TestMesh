import { describe, expect, it } from "vitest";
import {
  ArtifactEnvelopeSchema,
  CompletionReportSchema,
  StageProfileSchema,
  TaskManifestSchema,
} from "../server/harness/contracts.js";

const profile = {
  id: "requirement_analysis" as const,
  version: "1.0.0",
  description: "需求分析阶段",
  context: [{ id: "current_sources", description: "当前需求来源", required: true }],
  knowledge: [{ id: "approved_rules", description: "已确认规则", required: false }],
  skills: [{ id: "requirement_extraction", description: "需求提取", required: true, version: "1.0.0", activation: "always" as const }],
  tools: [{ id: "read_source", description: "读取来源", required: true, version: "1.0.0", mutating: false, approval: "never" as const }],
  policies: [{ id: "evidence_required", description: "重要结论带来源", enforcement: "completion_gate" as const }],
  output_schema: { name: "RequirementAnalysis", version: "1.0.0" },
  completion_criteria: [{ id: "schema_valid", description: "结构合法", evidence_required: false }],
};

describe("H00 Harness contracts", () => {
  it("records all six assembly dimensions and their versions", () => {
    expect(StageProfileSchema.parse(profile)).toEqual(profile);
    expect(() => StageProfileSchema.parse({ ...profile, tools: [...profile.tools, profile.tools[0]] })).toThrow("tools 中的 ID 不能重复");
  });

  it("keeps task inputs as typed references instead of an unbounded prompt", () => {
    const task = {
      task_id: "task-1",
      stage: "requirement_analysis",
      stage_profile_version: "1.0.0",
      input_refs: [{ slot: "current_sources", kind: "source", id: "source-1", required: true }],
      requested_by: "user-1",
      created_at: "2026-09-17T02:00:00.000Z",
    };
    expect(TaskManifestSchema.parse(task)).toEqual(task);
    expect(() => TaskManifestSchema.parse({ ...task, prompt: "把所有资料都给 Agent" })).toThrow();
  });

  it("separates candidate artifacts from Harness completion reports", () => {
    const artifact = ArtifactEnvelopeSchema.parse({
      artifact_id: "artifact-1",
      task_id: "task-1",
      stage: "requirement_analysis",
      schema_name: "RequirementAnalysis",
      schema_version: "1.0.0",
      status: "candidate",
      evidence_refs: [],
      payload: { summary: null },
      created_at: "2026-09-17T02:01:00.000Z",
    });
    expect(artifact.status).toBe("candidate");
    expect(() => CompletionReportSchema.parse({
      task_id: "task-1",
      artifact_id: "artifact-1",
      accepted: true,
      checks: [{ criterion_id: "schema_valid", passed: true, message: "通过", evidence_refs: [] }],
      failed_at: "",
      completed_at: "not-a-date",
    })).toThrow();
  });
});
