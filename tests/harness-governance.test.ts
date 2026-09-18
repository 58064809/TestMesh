import { describe, expect, it } from "vitest";
import { assembleStage } from "../server/harness/assembler.js";
import { evaluateCompletion } from "../server/harness/completion.js";

const task = {
  task_id: "task-1",
  stage: "requirement_analysis" as const,
  stage_profile_version: "1.0.0",
  input_refs: [{ slot: "current_sources", kind: "source" as const, id: "source-1", required: true }],
  requested_by: "user-1",
  created_at: "2026-09-17T02:00:00.000Z",
};

const profile = {
  id: "requirement_analysis" as const,
  version: "1.0.0",
  description: "需求分析阶段",
  context: [{ id: "current_sources", description: "当前来源", required: true }],
  knowledge: [{ id: "approved_rules", description: "已确认规则", required: false }],
  skills: [{ id: "requirement_extraction", description: "需求提取", required: true, version: "1.0.0", activation: "always" as const }],
  tools: [{ id: "read_source", description: "读取来源", required: true, version: "1.0.0", mutating: false, approval: "never" as const }],
  policies: [{ id: "source_required", description: "重要结果需要来源", enforcement: "completion_gate" as const }],
  output_schema: { name: "RequirementAnalysis", version: "1.0.0" },
  completion_criteria: [
    { id: "schema_valid", description: "结构合法", evidence_required: false },
    { id: "source_valid", description: "来源有效", evidence_required: true },
  ],
};

const artifact = {
  artifact_id: "artifact-1",
  task_id: "task-1",
  stage: "requirement_analysis" as const,
  schema_name: "RequirementAnalysis",
  schema_version: "1.0.0",
  status: "candidate" as const,
  evidence_refs: [{ kind: "source" as const, id: "source-1" }],
  payload: { summary: "候选结果", reported_complete: true },
  created_at: "2026-09-17T02:01:00.000Z",
};

describe("H00 capability assembly and completion gate", () => {
  it("exposes only capabilities declared by the Stage Profile", () => {
    const assembled = assembleStage(task, profile, {
      knowledge: new Set(["approved_rules", "unapproved_history"]),
      skills: new Set(["requirement_extraction", "playwright"]),
      tools: new Set(["read_source", "write_file", "run_terminal"]),
    });
    expect(assembled.skill_ids).toEqual(["requirement_extraction"]);
    expect(assembled.tool_ids).toEqual(["read_source"]);
    expect(assembled.knowledge_ids).toEqual(["approved_rules"]);
    expect(assembled.tool_ids).not.toContain("write_file");
  });

  it("stops assembly when a required capability is unavailable", () => {
    expect(() => assembleStage(task, profile, {
      knowledge: new Set(),
      skills: new Set(),
      tools: new Set(["read_source"]),
    })).toThrow("缺少必需 skill：requirement_extraction");
  });

  it("accepts completion only when every declared check passes with required evidence", () => {
    const report = evaluateCompletion({
      task,
      profile,
      artifact,
      checks: [
        { criterion_id: "schema_valid", passed: true, message: "结构合法", evidence_refs: [] },
        { criterion_id: "source_valid", passed: true, message: "来源可核对", evidence_refs: [{ kind: "source", id: "source-1" }] },
      ],
      completedAt: "2026-09-17T02:02:00.000Z",
    });
    expect(report.accepted).toBe(true);
  });

  it("ignores completion claims in payload and rejects a check without evidence", () => {
    const report = evaluateCompletion({
      task,
      profile,
      artifact,
      checks: [
        { criterion_id: "schema_valid", passed: true, message: "结构合法", evidence_refs: [] },
        { criterion_id: "source_valid", passed: true, message: "模型说来源正确", evidence_refs: [] },
      ],
    });
    expect(report.accepted).toBe(false);
    expect(report.failed_at).toContain("source_valid: 完成检查缺少证据");
  });
});
