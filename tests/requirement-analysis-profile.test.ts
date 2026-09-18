import { describe, expect, it } from "vitest";
import { assembleStage } from "../server/harness/assembler.js";
import {
  REQUIREMENT_ANALYSIS_PROFILE_VERSION,
  RequirementAnalysisStageProfile,
} from "../server/harness/profiles/requirement-analysis.js";

const requiredSkills = [
  "requirement-extraction",
  "business-rule-analysis",
  "ambiguity-detection",
  "source-conflict-analysis",
];
const allTools = [
  "read_file",
  "read_source",
  "locate_source",
  "validate_reference",
];

describe("RA01 Requirement Analysis Stage Profile", () => {
  it("fixes the six assembly dimensions and RequirementAnalysis protocol", () => {
    expect(RequirementAnalysisStageProfile.version).toBe(REQUIREMENT_ANALYSIS_PROFILE_VERSION);
    expect(RequirementAnalysisStageProfile.output_schema).toEqual({
      name: "RequirementAnalysis",
      version: "1.0.0",
    });
    expect(RequirementAnalysisStageProfile.context.map((item) => item.id)).toEqual([
      "current_sources",
      "previous_baseline",
      "human_decisions",
    ]);
    expect(RequirementAnalysisStageProfile.knowledge.map((item) => item.id)).toEqual([
      "project_glossary",
      "approved_domain_rules",
      "historical_decisions",
      "source_priority_rules",
    ]);
    expect(RequirementAnalysisStageProfile.policies.map((item) => item.id)).toContain("conflict_not_decided");
    expect(RequirementAnalysisStageProfile.completion_criteria.map((item) => item.id)).toEqual([
      "schema_valid",
      "references_valid",
      "source_locations_valid",
      "issues_valid",
      "source_priority_valid",
    ]);
  });

  it("assembles only current sources and available declared capabilities", () => {
    const assembled = assembleStage({
      task_id: "ra-task-1",
      stage: "requirement_analysis",
      stage_profile_version: "1.0.0",
      input_refs: [
        { slot: "current_sources", kind: "source", id: "SRC-FILE-1", required: true },
        { slot: "current_sources", kind: "source", id: "SRC-IMAGE-1", required: true },
      ],
      requested_by: "reviewer-1",
      created_at: "2026-09-17T05:00:00.000Z",
    }, RequirementAnalysisStageProfile, {
      knowledge: new Set(["unapproved_knowledge"]),
      skills: new Set([...requiredSkills, "flow-analysis", "unrelated-skill"]),
      tools: new Set([...allTools, "write_file", "execute"]),
    });

    expect(assembled.context_refs).toHaveLength(2);
    expect(assembled.skill_ids).toEqual([...requiredSkills.slice(0, 2), "flow-analysis", ...requiredSkills.slice(2)]);
    expect(assembled.tool_ids).toEqual(allTools);
    expect(assembled.knowledge_ids).toEqual([]);
    expect(assembled.unavailable_optional).toEqual(expect.arrayContaining([
      { kind: "context", id: "previous_baseline" },
      { kind: "context", id: "human_decisions" },
      { kind: "tool", id: "search_knowledge" },
    ]));
  });

  it("stops when any required analysis capability is missing", () => {
    expect(() => assembleStage({
      task_id: "ra-task-2",
      stage: "requirement_analysis",
      stage_profile_version: "1.0.0",
      input_refs: [{ slot: "current_sources", kind: "source", id: "SRC-1", required: true }],
      requested_by: "reviewer-1",
      created_at: "2026-09-17T05:00:00.000Z",
    }, RequirementAnalysisStageProfile, {
      knowledge: new Set(),
      skills: new Set(requiredSkills.filter((id) => id !== "source-conflict-analysis")),
      tools: new Set(allTools),
    })).toThrow("缺少必需 skill：source-conflict-analysis");
  });
});
