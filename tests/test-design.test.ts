import { describe, expect, it } from "vitest";
import { validateChineseGherkin } from "../server/test-design/gherkin.js";
import { BaselineSnapshotSchema, createModelTestDesignSchema, TestDesignSchema } from "../server/test-design/schema.js";
import { selectTestDesignSkills } from "../server/test-design/skill-selection.js";
import { validateTestDesign } from "../server/test-design/validation.js";

const baseline = BaselineSnapshotSchema.parse({
  accepted: [{
    section: "requirements",
    item: { id: "REQ-001", description: "订单超过 30 分钟未支付应关闭", source_refs: ["SRC-001"] },
    mergedFrom: [],
    review: { status: "accepted", decision: "", decisionBy: "", prdRevision: "" },
  }, {
    section: "states",
    item: { id: "STATE-001", description: "订单从待支付进入已关闭", source_refs: ["SRC-001"] },
    mergedFrom: [],
    review: { status: "accepted", decision: "", decisionBy: "", prdRevision: "" },
  }],
  reviews: [],
  sourceRefs: [{
    id: "SRC-001", source_file_id: "ATT-1", source_file_name: "prd.md",
    locator_type: "paragraph", locator: "段落 1", excerpt: "订单超过 30 分钟未支付应关闭",
    description: "订单超时规则",
  }],
});

function candidate() {
  return TestDesignSchema.parse({
    objective: "验证订单超时关闭规则",
    risks: [{
      id: "RISK-001", title: "超时订单未关闭", description: "产生库存占用", likelihood: "medium",
      impact: "high", rationale: "核心订单状态错误", trace_refs: ["REQ-001"], source_refs: ["SRC-001"],
    }],
    test_points: [{
      id: "TP-001", title: "超时关闭", objective: "验证边界和状态迁移", technique: "state_transition",
      technique_rationale: "存在明确前后状态", trace_refs: ["REQ-001", "STATE-001"], risk_refs: ["RISK-001"], source_refs: ["SRC-001"],
    }],
    test_cases: [{
      id: "TC-001", title: "未支付订单超时关闭", objective: "确认订单进入已关闭状态", priority: "P1",
      preconditions: ["订单处于待支付状态"],
      gherkin: "# language: zh-CN\n@TC-001 @REQ-001 @STATE-001\n功能: 订单超时关闭\n  规则: 未支付订单超过规定时间关闭\n    场景: 订单超过30分钟仍未支付\n      假如 订单处于待支付状态\n      当 未支付时间超过30分钟\n      那么 订单状态应变为已关闭",
      trace_refs: ["REQ-001", "STATE-001"], risk_refs: ["RISK-001"], test_point_refs: ["TP-001"], source_refs: ["SRC-001"],
    }],
    tool_applications: [
      { tool: "cucumber_gherkin", status: "applied", reason: "使用中文 Gherkin" },
      { tool: "fast_check", status: "not_applicable", reason: "当前只设计状态场景" },
      { tool: "nist_acts", status: "not_applicable", reason: "没有多个有限参数域" },
      { tool: "graphwalker", status: "not_applicable", reason: "缺少完整状态边" },
    ],
    coverage_exclusions: [],
    coverage: {
      "REQ-001": { test_point_refs: ["TP-001"], test_case_refs: ["TC-001"], exclusion_reason: "" },
      "STATE-001": { test_point_refs: ["TP-001"], test_case_refs: ["TC-001"], exclusion_reason: "" },
    },
  });
}

describe("TD01 mature-tool test design gate", () => {
  it("accepts traceable Chinese Gherkin covering the baseline", () => {
    expect(() => validateTestDesign(candidate(), baseline)).not.toThrow();
  });

  it("uses the official Cucumber parser to reject invalid Gherkin", () => {
    expect(() => validateChineseGherkin("功能: 缺少语言声明")).toThrow("# language: zh-CN");
  });

  it("rejects a fabricated source reference", () => {
    const input = candidate();
    input.test_cases[0].source_refs = ["SRC-404"];
    expect(() => validateTestDesign(input, baseline)).toThrow("SRC-404");
  });

  it("rejects silent baseline coverage gaps", () => {
    const input = candidate();
    input.test_cases[0].trace_refs = ["REQ-001"];
    expect(() => validateTestDesign(input, baseline)).toThrow("STATE-001");
  });

  it("loads only applicable test design skills", () => {
    const decisions = selectTestDesignSkills(baseline);
    expect(decisions.find((item) => item.skill_id === "scenario-design")?.applicable).toBe(true);
    expect(decisions.find((item) => item.skill_id === "state-transition")?.applicable).toBe(true);
  });

  it("makes every baseline ID a required Structured Output coverage key", () => {
    const input = candidate();
    delete input.coverage["STATE-001"];
    const modelSchema = createModelTestDesignSchema(["REQ-001", "STATE-001"]);
    expect(modelSchema.safeParse(input).success).toBe(false);
  });
});
