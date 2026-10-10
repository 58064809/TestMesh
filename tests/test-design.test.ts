import { describe, expect, it } from "vitest";
import { validateChineseGherkin } from "../server/test-design/gherkin.js";
import { BaselineSnapshotSchema, createModelTestDesignSchema, createTestCaseBatchSchema, TestDesignSchema } from "../server/test-design/schema.js";
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
    test_conditions: [{
      id: "TCND-001", title: "超时后关闭", objective: "验证超过时限的正常规则", primary_trace_ref: "REQ-001",
      category: "normal", technique: "boundary_value", rationale: "存在明确时限", source_refs: ["SRC-001"],
    }, {
      id: "TCND-002", title: "未到时限不关闭", objective: "验证边界内不触发关闭", primary_trace_ref: "REQ-001",
      category: "boundary", technique: "boundary_value", rationale: "需要验证边界相邻值", source_refs: ["SRC-001"],
    }, {
      id: "TCND-003", title: "有效关闭迁移", objective: "验证待支付到已关闭", primary_trace_ref: "STATE-001",
      category: "valid_transition", technique: "state_transition", rationale: "存在有效迁移", source_refs: ["SRC-001"],
    }, {
      id: "TCND-004", title: "无效关闭迁移", objective: "验证非待支付状态不能重复关闭", primary_trace_ref: "STATE-001",
      category: "invalid_transition", technique: "state_transition", rationale: "需要验证无效迁移", source_refs: ["SRC-001"],
    }],
    test_cases: [{
      id: "TC-001", module: "订单", title: "未支付订单超时关闭", objective: "确认订单进入已关闭状态", priority: "P1",
      primary_trace_ref: "REQ-001",
      primary_test_condition_ref: "TCND-001", test_condition_refs: ["TCND-001"],
      scenario_type: "boundary", technique: "boundary_value",
      preconditions: ["订单处于待支付状态"],
      test_data: ["未支付时间超过30分钟"],
      steps: [{ order: 1, action: "推进未支付时间超过30分钟", expected: "订单状态变为已关闭" }],
      gherkin: "# language: zh-CN\n@TC-001 @REQ-001 @STATE-001\n功能: 订单超时关闭\n  规则: 未支付订单超过规定时间关闭\n    场景: 订单超过30分钟仍未支付\n      假如 订单处于待支付状态\n      当 未支付时间超过30分钟\n      那么 订单状态应变为已关闭",
      trace_refs: ["REQ-001", "STATE-001"], risk_refs: ["RISK-001"], test_point_refs: ["TP-001"], source_refs: ["SRC-001"],
    }, {
      id: "TC-002", module: "订单", title: "订单关闭状态迁移", objective: "确认状态迁移结果可观察", priority: "P1",
      primary_trace_ref: "STATE-001",
      primary_test_condition_ref: "TCND-003", test_condition_refs: ["TCND-003"],
      scenario_type: "state_transition", technique: "state_transition",
      preconditions: ["订单处于待支付状态"],
      test_data: ["待支付订单"],
      steps: [{ order: 1, action: "触发超时关闭事件", expected: "订单从待支付迁移为已关闭" }],
      gherkin: "# language: zh-CN\n@TC-002 @STATE-001\n功能: 订单状态迁移\n  场景: 超时后进入已关闭\n    假如 订单处于待支付状态\n    当 订单超过关闭时限\n    那么 订单状态变为已关闭",
      trace_refs: ["STATE-001"], risk_refs: ["RISK-001"], test_point_refs: ["TP-001"], source_refs: ["SRC-001"],
    }, {
      id: "TC-003", module: "订单", title: "未到关闭时限", objective: "确认边界内保持待支付", priority: "P1",
      primary_trace_ref: "REQ-001", primary_test_condition_ref: "TCND-002", test_condition_refs: ["TCND-002"],
      scenario_type: "boundary", technique: "boundary_value", preconditions: ["订单处于待支付状态"], test_data: ["未支付时间不足30分钟"],
      steps: [{ order: 1, action: "推进未支付时间但不超过30分钟", expected: "订单保持待支付" }],
      gherkin: "# language: zh-CN\n@TC-003 @REQ-001\n功能: 订单关闭边界\n  场景: 未到时限保持待支付\n    假如 订单处于待支付状态\n    当 未支付时间不足30分钟\n    那么 订单状态保持待支付",
      trace_refs: ["REQ-001"], risk_refs: ["RISK-001"], test_point_refs: ["TP-001"], source_refs: ["SRC-001"],
    }, {
      id: "TC-004", module: "订单", title: "已关闭订单不能重复关闭", objective: "确认无效迁移被拒绝", priority: "P1",
      primary_trace_ref: "STATE-001", primary_test_condition_ref: "TCND-004", test_condition_refs: ["TCND-004"],
      scenario_type: "state_transition", technique: "state_transition", preconditions: ["订单已经关闭"], test_data: ["已关闭订单"],
      steps: [{ order: 1, action: "再次触发超时关闭事件", expected: "订单不产生重复关闭迁移" }],
      gherkin: "# language: zh-CN\n@TC-004 @STATE-001\n功能: 订单无效状态迁移\n  场景: 已关闭订单再次关闭\n    假如 订单状态为已关闭\n    当 再次触发超时关闭事件\n    那么 订单不产生重复关闭迁移",
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
      "REQ-001": { test_point_refs: ["TP-001"], test_case_refs: ["TC-001", "TC-003"], exclusion_reason: "" },
      "STATE-001": { test_point_refs: ["TP-001"], test_case_refs: ["TC-001", "TC-002", "TC-004"], exclusion_reason: "" },
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

  it("keeps each atomic TestCase aligned with its primary TestCondition and baseline item", () => {
    const input = candidate();
    input.test_cases[1].primary_trace_ref = "REQ-001";
    input.test_cases[1].trace_refs = ["REQ-001", "STATE-001"];
    expect(() => validateTestDesign(input, baseline)).toThrow("主要测试条件与主要基线项不一致");
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

  it("makes every planned TestCondition a required batch output key", () => {
    const input = candidate();
    const batch = createTestCaseBatchSchema([
      { conditionId: "TCND-001", caseId: "TC-001" },
      { conditionId: "TCND-002", caseId: "TC-003" },
    ]);
    expect(batch.safeParse({ cases: { "TCND-001": input.test_cases[0] } }).success).toBe(false);
    expect(batch.safeParse({ cases: {
      "TCND-001": input.test_cases[0],
      "TCND-002": input.test_cases[2],
    } }).success).toBe(true);
  });
});
