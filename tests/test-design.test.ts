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
      id: "TC-001", module: "订单", title: "未支付订单超时关闭", objective: "确认订单进入已关闭状态", priority: "P1",
      primary_trace_ref: "REQ-001",
      scenario_type: "boundary", technique: "boundary_value",
      preconditions: ["订单处于待支付状态"],
      test_data: ["未支付时间超过30分钟"],
      steps: [{ order: 1, action: "推进未支付时间超过30分钟", expected: "订单状态变为已关闭" }],
      gherkin: "# language: zh-CN\n@TC-001 @REQ-001 @STATE-001\n功能: 订单超时关闭\n  规则: 未支付订单超过规定时间关闭\n    场景: 订单超过30分钟仍未支付\n      假如 订单处于待支付状态\n      当 未支付时间超过30分钟\n      那么 订单状态应变为已关闭",
      trace_refs: ["REQ-001", "STATE-001"], risk_refs: ["RISK-001"], test_point_refs: ["TP-001"], source_refs: ["SRC-001"],
    }, {
      id: "TC-002", module: "订单", title: "订单关闭状态迁移", objective: "确认状态迁移结果可观察", priority: "P1",
      primary_trace_ref: "STATE-001",
      scenario_type: "state_transition", technique: "state_transition",
      preconditions: ["订单处于待支付状态"],
      test_data: ["待支付订单"],
      steps: [{ order: 1, action: "触发超时关闭事件", expected: "订单从待支付迁移为已关闭" }],
      gherkin: "# language: zh-CN\n@TC-002 @STATE-001\n功能: 订单状态迁移\n  场景: 超时后进入已关闭\n    假如 订单处于待支付状态\n    当 订单超过关闭时限\n    那么 订单状态变为已关闭",
      trace_refs: ["STATE-001"], risk_refs: ["RISK-001"], test_point_refs: ["TP-001"], source_refs: ["SRC-001"],
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
      "STATE-001": { test_point_refs: ["TP-001"], test_case_refs: ["TC-001", "TC-002"], exclusion_reason: "" },
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

  it("accepts the official zh-CN examples keyword and rejects the common invalid synonym", () => {
    const outline = "# language: zh-CN\n功能: 登录\n  场景大纲: 密码校验\n    假如 用户名为 <用户名>\n    当 密码为 <密码>\n    那么 登录结果为 <结果>\n    例子:\n      | 用户名 | 密码 | 结果 |\n      | 张三 | 正确 | 成功 |";
    expect(() => validateChineseGherkin(outline)).not.toThrow();
    expect(() => validateChineseGherkin(outline.replace("例子:", "示例:"))).toThrow("Cucumber Gherkin 语法校验失败");
  });

  it("rejects free-form prose appended after a scenario", () => {
    const source = "# language: zh-CN\n功能: 登录\n  场景: 登录成功\n    假如 用户已注册\n    当 用户提交正确密码\n    那么 登录成功\n补充说明应写入结构化字段";
    expect(() => validateChineseGherkin(source)).toThrow("Cucumber Gherkin 语法校验失败");
  });

  it("rejects multiple scenarios bundled into one TestCase", () => {
    const source = "# language: zh-CN\n功能: 登录\n  场景: 登录成功\n    假如 密码正确\n    当 用户登录\n    那么 登录成功\n  场景: 登录失败\n    假如 密码错误\n    当 用户登录\n    那么 登录失败";
    expect(() => validateChineseGherkin(source)).toThrow("必须且只能包含一个场景");
  });

  it("rejects a fabricated source reference", () => {
    const input = candidate();
    input.test_cases[0].source_refs = ["SRC-404"];
    expect(() => validateTestDesign(input, baseline)).toThrow("SRC-404");
  });

  it("rejects silent baseline coverage gaps", () => {
    const input = candidate();
    input.test_cases[1].trace_refs = ["REQ-001"];
    expect(() => validateTestDesign(input, baseline)).toThrow("primary_trace_ref");
  });

  it("requires every covered baseline item to be the primary target of an atomic TestCase", () => {
    const input = candidate();
    input.test_cases[1].primary_trace_ref = "REQ-001";
    input.test_cases[1].trace_refs = ["REQ-001", "STATE-001"];
    expect(() => validateTestDesign(input, baseline)).toThrow("原子用例 Gate 未通过");
  });

  it("rejects coverage matrix references that do not trace the baseline item", () => {
    const input = candidate();
    input.test_points[0].trace_refs = ["REQ-001"];
    expect(() => validateTestDesign(input, baseline)).toThrow("STATE-001");
  });

  it("loads only applicable test design skills", () => {
    const decisions = selectTestDesignSkills(baseline);
    expect(decisions.find((item) => item.skill_id === "test-analysis-planning")?.applicable).toBe(true);
    expect(decisions.find((item) => item.skill_id === "scenario-design")?.applicable).toBe(true);
    expect(decisions.find((item) => item.skill_id === "state-transition")?.applicable).toBe(true);
    expect(decisions.find((item) => item.skill_id === "failure-cross-system")?.applicable).toBe(false);
  });

  it("makes every baseline ID a required Structured Output coverage key", () => {
    const input = candidate();
    delete input.coverage["STATE-001"];
    const modelSchema = createModelTestDesignSchema(["REQ-001", "STATE-001"]);
    expect(modelSchema.safeParse(input).success).toBe(false);
  });
});
