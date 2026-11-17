import { describe, expect, it } from "vitest";
import { normalizeChineseGherkin, validateChineseGherkin } from "../server/test-design/gherkin.js";
import { normalizeEvidenceSourceRefs } from "../server/test-design/test-model-agent.js";
import { BaselineSnapshotSchema, createModelTestDesignSchema, createTestCaseBatchSchema, ModelTestDesignPlanSchema, PARAMETER_EXTRACTION_ASPECTS, TestDesignSchema, TestModelDocumentSchema } from "../server/test-design/schema.js";
import { selectTestDesignSkills } from "../server/test-design/skill-selection.js";
import { buildSmartShoppingSimulationReference } from "../server/test-design/simulation-reference.js";
import { validateTestDesign, validateTestModel } from "../server/test-design/validation.js";

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

describe("test model evidence normalization", () => {
  it("maps baseline trace IDs to their original source evidence IDs", () => {
    expect(normalizeEvidenceSourceRefs(["REQ-001", "STATE-001", "SRC-001"], baseline)).toEqual(["SRC-001"]);
  });

  it("preserves unknown IDs so deterministic validation still rejects them", () => {
    expect(normalizeEvidenceSourceRefs(["REQ-404"], baseline)).toEqual(["REQ-404"]);
  });
});

describe("smart-shopping simulation reference gate", () => {
  it("rejects the obsolete frozen baseline instead of inventing the later V1.0 rules", () => {
    const obsoleteBaseline = BaselineSnapshotSchema.parse({
      accepted: [],
      reviews: [],
      sourceRefs: [{
        id: "SRC-1", source_file_id: "ATT-1", source_file_name: "smart-shopping-contract.md",
        locator_type: "paragraph", locator: "段落 1", excerpt: "状态：simulated。",
        description: "模拟资料",
      }, {
        id: "SRC-3", source_file_id: "ATT-1", source_file_name: "smart-shopping-contract.md",
        locator_type: "paragraph", locator: "段落 3",
        excerpt: "没有给出默认数量、价格上限、单位换算、品牌别名或冲突处理规则；测试中不得自行补定。",
        description: "尚未定义的规则",
      }],
    });

    expect(() => buildSmartShoppingSimulationReference("BASELINE-OLD", obsoleteBaseline))
      .toThrow("当前冻结基线仍是旧版模拟契约");
  });
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

  it("canonicalizes full-width colons on supported Chinese Gherkin headings only", () => {
    const source = "# language: zh-CN\n功能：登录\n  场景：登录成功\n    假如 用户已注册\n    当 用户提交正确密码\n    那么 登录成功";
    const normalized = normalizeChineseGherkin(source);
    expect(normalized).toContain("功能:登录");
    expect(normalized).toContain("场景:登录成功");
    expect(() => validateChineseGherkin(normalized)).not.toThrow();
  });

  it("canonicalizes common outline heading variants without rewriting steps or examples", () => {
    const source = "# language: zh-CN\n功能大纲：订单状态\n场景：状态为 <状态>\n假如 订单存在\n当 查询订单\n那么 展示 <状态>\n例子：\n| 状态 |\n| 已完成 |";
    const normalized = normalizeChineseGherkin(source);
    expect(normalized).toContain("功能:订单状态");
    expect(normalized).toContain("场景大纲:状态为 <状态>");
    expect(normalized).toContain("例子:");
    expect(() => validateChineseGherkin(normalized)).not.toThrow();
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

  it("rejects knowledge references that were not returned by the retrieval tool", () => {
    const input = candidate();
    input.test_conditions![0].knowledge_refs = ["knowledge-1:chunk:0"];
    input.test_cases[0].knowledge_refs = ["knowledge-1:chunk:0"];
    expect(() => validateTestDesign(input, baseline)).toThrow("knowledge-1:chunk:0");
    input.knowledge_evidence = [{
      chunk_id: "knowledge-1:chunk:0", document_id: "knowledge-1", filename: "architecture.md",
      score: 0.8, text: "退款依赖支付网关", headings: ["退款"], page_numbers: [], doc_items: ["#/texts/1"],
    }];
    expect(() => validateTestDesign(input, baseline, new Set(["knowledge-1:chunk:0"]))).not.toThrow();
  });

  it("requires every knowledge reference to have a frozen evidence snapshot", () => {
    const input = candidate();
    input.test_conditions![0].knowledge_refs = ["knowledge-1:chunk:0"];
    input.test_cases[0].knowledge_refs = ["knowledge-1:chunk:0"];
    expect(() => validateTestDesign(input, baseline, new Set(["knowledge-1:chunk:0"]))).toThrow("知识证据快照缺少引用");
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

  it("requires an explicit oracle and Phoenix evidence for Testing for AI cases", () => {
    const input = candidate();
    input.test_conditions![0] = {
      ...input.test_conditions![0],
      category: "intent_recognition",
      technique: "ai_evaluation",
      ai_dimension: "intent_recognition",
    };
    input.test_cases[0] = {
      ...input.test_cases[0],
      scenario_type: "ai_behavior",
      technique: "ai_evaluation",
    };
    expect(() => validateTestDesign(input, baseline)).toThrow("ai_evaluation");

    input.test_cases[0].ai_evaluation = {
      dimension: "intent_recognition",
      oracle_type: "reference_answer",
      expected_behavior: "识别订单超时关闭查询意图，不误判为取消订单",
      evaluator: "Phoenix 分类准确率 evaluator",
      threshold: ">= 0.95",
      dataset_requirements: ["包含标准表达、口语改写和相近干扰意图"],
      evidence_requirements: ["保存 Dataset 版本、Experiment、逐样本结果和 Trace"],
    };
    expect(() => validateTestDesign(input, baseline)).toThrow("Phoenix");
    input.tool_applications.push({ tool: "phoenix_evals", status: "applied", reason: "版本化数据集、实验与评测证据" });
    expect(() => validateTestDesign(input, baseline)).not.toThrow();
  });

  it("rejects an AI evaluator attached to an ordinary business case", () => {
    const input = candidate();
    input.test_cases[0].ai_evaluation = {
      dimension: "groundedness_hallucination",
      oracle_type: "llm_judge",
      expected_behavior: "回答必须有证据支撑",
      evaluator: "Phoenix groundedness evaluator",
      threshold: ">= 0.9",
      dataset_requirements: ["包含可回答与不可回答样本"],
      evidence_requirements: ["保存引用和评测解释"],
    };
    expect(() => validateTestDesign(input, baseline)).toThrow("普通业务测试不能附带 AI 评测配置");
  });

  it("requires complete evidence-backed Slot Filling coverage and a field-level oracle", () => {
    const input = candidate();
    input.test_conditions![0] = {
      ...input.test_conditions![0], category: "parameter_extraction", technique: "ai_evaluation", ai_dimension: "parameter_extraction",
    };
    input.test_cases[0] = {
      ...input.test_cases[0], scenario_type: "ai_behavior", technique: "ai_evaluation",
      ai_evaluation: {
        dimension: "parameter_extraction", oracle_type: "code_evaluator",
        expected_behavior: "人数参数被归一化为整数 4", evaluator: "Phoenix Slot Value evaluator", threshold: "必须通过",
        dataset_requirements: ["固定 Schema、参考时间和人工确认 Ground Truth"], evidence_requirements: ["Dataset Version、Experiment、字段级结果和 Trace"],
      },
    };
    input.tool_applications.push({ tool: "phoenix_evals", status: "applied", reason: "由 Phoenix 保存 Dataset、Experiment 和字段级评测" });
    input.parameter_extraction_assessment = {
      status: "applicable", implementation_pattern: "function_calling", reason: "基线要求自然语言人数映射到工具参数",
      source_refs: ["SRC-001"], schema_version: "slot-schema-v1",
      aspects: PARAMETER_EXTRACTION_ASPECTS.slice(0, -1).map((aspect, index) => ({
        aspect, status: index === 0 ? "planned" as const : "not_applicable" as const,
        condition_refs: index === 0 ? ["TCND-001"] : [], reason: index === 0 ? "验证人数槽位名称" : "当前基线没有该现象或契约",
      })),
    };
    expect(() => validateTestDesign(input, baseline)).toThrow("参数提取测试维度不完整");

    input.parameter_extraction_assessment.aspects.push({
      aspect: "prompt_injection_resistance", status: "not_applicable", condition_refs: [], reason: "当前基线没有不可信外部输入",
    });
    expect(() => validateTestDesign(input, baseline)).toThrow("字段级判定协议");
    input.test_cases[0].ai_evaluation!.parameter_extraction = {
      layer: "semantic_extraction", aspect: "parameter_identification", slot_name: "party_size",
      expected_presence: true, expected_value_json: "4", expected_type: "integer", match_type: "exact",
      normalization_rule: "中文数字转换为整数", tolerance: "0", expected_action: "extract", state_target: "slot_delta",
      reference_datetime: "2026-10-18T14:00:00+08:00", timezone: "Asia/Shanghai", locale: "zh-CN",
      schema_version: "slot-schema-v1", risk_level: "P1",
    };
    expect(() => validateTestDesign(input, baseline)).not.toThrow();
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
      { conditionId: "TCND-001", caseId: "TC-001", traceRef: "REQ-001" },
      { conditionId: "TCND-002", caseId: "TC-003", traceRef: "REQ-001" },
    ]);
    expect(batch.safeParse({ cases: { "TCND-001": input.test_cases[0] } }).success).toBe(false);
    expect(batch.safeParse({ cases: {
      "TCND-001": { ...input.test_cases[0], ai_evaluation: null },
      "TCND-002": { ...input.test_cases[2], ai_evaluation: null },
    } }).success).toBe(true);
  });

  it("requires explicit nulls for non-AI fields in OpenAI Structured Outputs", () => {
    const input = candidate();
    const plan = {
      objective: input.objective,
      risks: input.risks,
      test_points: input.test_points,
      test_conditions: input.test_conditions,
      tool_applications: input.tool_applications,
      coverage_exclusions: input.coverage_exclusions,
    };
    expect(ModelTestDesignPlanSchema.safeParse(plan).success).toBe(false);
    expect(ModelTestDesignPlanSchema.safeParse({
      ...plan,
      parameter_extraction_assessment: null,
      test_conditions: plan.test_conditions?.map((condition) => ({ ...condition, ai_dimension: null })),
    }).success).toBe(true);

    const batch = createTestCaseBatchSchema([{ conditionId: "TCND-001", caseId: "TC-001", traceRef: "REQ-001" }]);
    expect(batch.safeParse({ cases: { "TCND-001": input.test_cases[0] } }).success).toBe(false);
    expect(batch.safeParse({ cases: { "TCND-001": { ...input.test_cases[0], ai_evaluation: null } } }).success).toBe(true);
  });

  it("locks each AI evaluator dimension to its planned TestCondition", () => {
    const input = candidate();
    const batch = createTestCaseBatchSchema([{
      conditionId: "TCND-001",
      caseId: "TC-001",
      traceRef: "REQ-001",
      aiDimension: "intent_recognition",
    }]);
    const evaluation = {
      dimension: "intent_recognition" as const,
      evaluation_subjects: ["target_application" as const],
      evaluation_layers: ["agent_decision" as const, "final_response" as const],
      oracle_type: "reference_answer" as const,
      expected_behavior: "识别为订单查询意图",
      evaluator: "Phoenix 分类准确率 evaluator",
      threshold: ">= 0.95",
      dataset_requirements: ["标准表达、口语改写与干扰意图"],
      evidence_requirements: ["Dataset 版本、Experiment 和逐样本结果"],
      parameter_extraction: null,
    };
    expect(batch.safeParse({ cases: { "TCND-001": {
      ...input.test_cases[0],
      scenario_type: "ai_behavior",
      technique: "ai_evaluation",
      ai_evaluation: evaluation,
    } } }).success).toBe(true);
    expect(batch.safeParse({ cases: { "TCND-001": {
      ...input.test_cases[0],
      ai_evaluation: { ...evaluation, dimension: "response_correctness" },
    } } }).success).toBe(false);
    expect(batch.safeParse({ cases: { "TCND-001": {
      ...input.test_cases[0],
      scenario_type: "normal",
      technique: "scenario",
      ai_evaluation: evaluation,
    } } }).success).toBe(false);

    const businessBatch = createTestCaseBatchSchema([{
      conditionId: "TCND-001", caseId: "TC-001", traceRef: "REQ-001",
    }]);
    expect(businessBatch.safeParse({ cases: { "TCND-001": {
      ...input.test_cases[0],
      scenario_type: "ai_behavior",
      technique: "ai_evaluation",
      ai_evaluation: null,
    } } }).success).toBe(false);
  });

  it("requires an approved-ready Test Model before TestCase generation", () => {
    const design = candidate();
    const model = TestModelDocumentSchema.parse({
      objective: "先建立订单测试模型",
      quality_model: {
        objectives: [design.objective],
        risk_refs: design.risks.map((item) => item.id),
        coverage_targets: ["REQ-001", "STATE-001"],
      },
      business_model: {
        actors: [], business_rules: [], flows: [], constraints: [], exceptions: [],
        states: [{ id: "STATE-001", description: "订单从待支付进入已关闭", source_refs: ["SRC-001"] }],
      },
      ai_model: { applicable: false, evaluation_subjects: [], evaluation_layers: [], dimensions: [] },
      behavior_models: {
        semantic_parameter: {
          model_id: "M-01", name: "订单语义与参数模型",
          intents: [{ id: "order_query", description: "查询订单", in_scope: true, required_slots: [], source_refs: ["SRC-001"] }],
          slots: [], cross_parameter_constraints: [],
        },
        business_decision: {
          model_id: "M-02", name: "订单业务决策模型",
          rules: [{ id: "D-001", conditions: ["订单处于待支付"], actions: ["允许关闭"], priority: 1, source_refs: ["SRC-001"] }],
        },
        dialogue_state: {
          model_id: "M-03", name: "订单状态模型",
          states: [
            { id: "PENDING", description: "待支付", terminal: false, source_refs: ["SRC-001"] },
            { id: "CLOSED", description: "已关闭", terminal: true, source_refs: ["SRC-001"] },
          ],
          transitions: [{ id: "T-001", from: "PENDING", event: "关闭订单", guard: "订单未支付", actions: ["关闭订单"], to: "CLOSED", search_allowed: false, source_refs: ["SRC-001"] }],
          context_rules: [],
        },
        agent_interaction: {
          model_id: "M-04", name: "订单 Agent 交互模型", tools: [],
          interaction_rules: [{ id: "I-001", trigger: "用户查询订单", preconditions: [], tool: "", argument_mapping: [], success_outcome: "返回订单状态", empty_outcome: "返回订单不存在", failure_outcome: "返回受控错误", evidence_requirements: ["Agent 决策证据"], source_refs: ["SRC-001"] }],
        },
      },
      test_analysis: {
        objective: design.objective,
        risks: design.risks,
        test_points: design.test_points,
        test_conditions: design.test_conditions,
        tool_applications: design.tool_applications,
        coverage_exclusions: design.coverage_exclusions,
      },
      knowledge_evidence: [],
    });
    expect(() => validateTestModel(model, baseline)).not.toThrow();
    expect(() => validateTestModel({
      ...model,
      quality_model: { ...model.quality_model, coverage_targets: ["REQ-001"] },
    }, baseline)).toThrow("覆盖目标不完整");
  });
});
