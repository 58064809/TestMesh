import type { BaselineSnapshot } from "./schema.js";

export interface TestDesignSkillDecision {
  skill_id: string;
  applicable: boolean;
  reason: string;
}

export function selectTestDesignSkills(baseline: BaselineSnapshot): TestDesignSkillDecision[] {
  const sections = new Set(baseline.accepted.map((item) => item.section));
  const text = baseline.accepted.map((item) => item.item.description).join("\n");
  return [
    { skill_id: "scenario-design", applicable: true, reason: "所有 TestCase 均使用 Cucumber/Gherkin 表达业务场景" },
    {
      skill_id: "equivalence-boundary",
      applicable: sections.has("constraints") || /(?:范围|最少|最多|超过|以内|不少于|不超过|\d+)/.test(text),
      reason: "基线包含约束、阈值或可能形成输入域的描述",
    },
    {
      skill_id: "decision-table",
      applicable: sections.has("business_rules"),
      reason: "基线包含业务规则，需要检查条件与动作组合",
    },
    {
      skill_id: "state-transition",
      applicable: sections.has("states") || sections.has("flows"),
      reason: "基线包含状态或业务流程，需要检查有效与无效迁移",
    },
  ];
}
