import {
  PARAMETER_EXTRACTION_ASPECTS,
  TestModelDocumentSchema,
  type AiTestDimensionSchema,
  type BaselineSnapshot,
  type TestModelDocument,
} from "./schema.js";
import { validateTestModel } from "./validation.js";
import type { z } from "zod";

const COVERAGE_SECTIONS = new Set([
  "requirements", "business_rules", "flows", "states", "constraints", "exceptions", "open_questions",
]);

type AiDimension = z.infer<typeof AiTestDimensionSchema>;

export interface SimulationReferenceReadiness {
  ready: boolean;
  blockers: string[];
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function dimensionFor(traceId: string): AiDimension | undefined {
  if (traceId === "REQ-1") return "intent_recognition";
  if (["REQ-3", "BR-3", "FLOW-2"].includes(traceId)) return "multi_turn_context";
  if (["REQ-6", "BR-5", "CON-4", "EXC-4"].includes(traceId)) return "groundedness_hallucination";
  if (["REQ-7", "BR-6"].includes(traceId)) return "response_correctness";
  if (["REQ-8", "BR-7"].includes(traceId)) return "tool_selection";
  if (["REQ-10", "CON-3"].includes(traceId)) return "tool_invocation";
  if (["REQ-5", "FLOW-3", "EXC-1", "EXC-2", "EXC-3", "EXC-5"].includes(traceId)) return "robustness_consistency";
  if (["BR-4", "CON-1", "CON-2", "REQ-9", "STATE-1"].includes(traceId)) return "constraint_adherence";
  return undefined;
}

function conditionCategoryFor(dimension: AiDimension | undefined) {
  if (dimension === "tool_selection" || dimension === "tool_invocation") return "tool_use" as const;
  return dimension;
}

function techniqueFor(section: BaselineSnapshot["accepted"][number]["section"]) {
  if (section === "states") return "state_transition" as const;
  if (section === "business_rules") return "decision_table" as const;
  if (section === "constraints") return "equivalence_partition" as const;
  return "scenario" as const;
}

export function inspectSmartShoppingSimulationReference(baseline: BaselineSnapshot): SimulationReferenceReadiness {
  const frozenEvidence = baseline.sourceRefs.map((source) => source.excerpt).join("\n");
  const blockers: string[] = [];
  if (!baseline.sourceRefs.some((source) => /simulated|模拟/i.test(source.excerpt))) {
    blockers.push("当前需求基线不是受控智能导购模拟资产");
  }
  const unresolvedRuleEvidence = /没有给出默认数量|不得自行补定|尚未定义.*(?:默认|单位换算|品牌别名|冲突)/.test(frozenEvidence);
  const requiredV1Evidence = [
    /默认推荐\s*3\s*款|默认数量[^。\n]*3/,
    /1\s*[～~-]\s*5\s*款|最多推荐\s*5\s*款/,
    /10[,.]?000\s*元|10000\s*元/,
    /1\s*kg\s*=\s*1000\s*g/i,
    /YONEX/,
    /NEED_CLARIFICATION/,
  ];
  if (unresolvedRuleEvidence || requiredV1Evidence.some((pattern) => !pattern.test(frozenEvidence))) {
    blockers.push("当前冻结基线仍是旧版模拟契约，未包含智能导购 V1.0 的默认数量、边界、单位换算、品牌词典和澄清状态。请用最新 PRD 重新分析、评审并冻结新基线");
  }
  return { ready: blockers.length === 0, blockers };
}

export function buildSmartShoppingSimulationReference(
  baselineId: string,
  baseline: BaselineSnapshot,
): TestModelDocument {
  const readiness = inspectSmartShoppingSimulationReference(baseline);
  if (!readiness.ready) throw new Error(`${readiness.blockers.join("；")}，完成后再加载参考模型。`);

  const coverageEntries = baseline.accepted.filter((entry) => COVERAGE_SECTIONS.has(entry.section));
  const bySection = new Map<string, typeof coverageEntries>();
  for (const entry of coverageEntries) bySection.set(entry.section, [...(bySection.get(entry.section) ?? []), entry]);

  const risks = [...bySection.entries()].map(([section, entries], index) => ({
    id: `RISK-${String(index + 1).padStart(3, "0")}`,
    title: `${section} 规则被错误解释`,
    description: `模拟链路若错误解释 ${section}，可能导致错误参数、状态、工具调用或最终回复。`,
    likelihood: "medium" as const,
    impact: ["business_rules", "constraints", "exceptions"].includes(section) ? "high" as const : "medium" as const,
    rationale: "用于模拟测试工程链路的风险分组，不代表真实项目风险评级。",
    trace_refs: entries.map((entry) => entry.item.id),
    source_refs: unique(entries.flatMap((entry) => entry.item.source_refs)),
    knowledge_refs: [],
  }));
  const riskBySection = new Map([...bySection.keys()].map((section, index) => [section, risks[index].id]));

  const testPoints = coverageEntries.map((entry, index) => ({
    id: `TP-${String(index + 1).padStart(3, "0")}`,
    title: `${entry.item.id} 可验证行为`,
    objective: `验证冻结模拟基线中的“${entry.item.description}”能够转化为可观察、可判定的系统行为。`,
    technique: techniqueFor(entry.section),
    technique_rationale: `按 ${entry.section} 的业务语义选择测试技法；真实项目可在模型评审时修正。`,
    trace_refs: [entry.item.id],
    risk_refs: [riskBySection.get(entry.section)!],
    source_refs: entry.item.source_refs,
    knowledge_refs: [],
  }));

  let conditionSequence = 0;
  const nextConditionId = () => `TCND-${String(++conditionSequence).padStart(3, "0")}`;
  const conditions = coverageEntries.flatMap((entry) => {
    const aiDimension = dimensionFor(entry.item.id);
    const technique = aiDimension ? "ai_evaluation" as const : techniqueFor(entry.section);
    return [
      {
        id: nextConditionId(), title: `${entry.item.id} 有效路径`,
        objective: `验证满足前置条件时正确实现：${entry.item.description}`,
        primary_trace_ref: entry.item.id, category: conditionCategoryFor(aiDimension) ?? "normal" as const, technique,
        rationale: "覆盖允许、正常或有效行为。", source_refs: entry.item.source_refs, knowledge_refs: [],
        ...(aiDimension ? { ai_dimension: aiDimension } : {}),
      },
      {
        id: nextConditionId(), title: `${entry.item.id} 反向路径`,
        objective: `验证不满足前置条件、输入无效或依赖异常时，不得违反：${entry.item.description}`,
        primary_trace_ref: entry.item.id, category: conditionCategoryFor(aiDimension) ?? "negative" as const, technique,
        rationale: "覆盖拒绝、异常、边界外或恢复行为。", source_refs: entry.item.source_refs, knowledge_refs: [],
        ...(aiDimension ? { ai_dimension: aiDimension } : {}),
      },
    ];
  });

  const parameterAspectRows = PARAMETER_EXTRACTION_ASPECTS.map((aspect) => {
    const id = nextConditionId();
    conditions.push({
      id,
      title: `参数提取专项：${aspect}`,
      objective: `验证智能导购参数提取的 ${aspect} 行为符合冻结模拟基线和工具映射契约。`,
      primary_trace_ref: "OQ-2",
      category: "parameter_extraction",
      technique: "ai_evaluation",
      rationale: "按参数提取专项维度建立独立、字段级可判定条件。",
      source_refs: ["SRC-3", "SRC-4", "SRC-5"],
      knowledge_refs: [],
      ai_dimension: "parameter_extraction",
    });
    return { aspect, status: "planned" as const, condition_refs: [id], reason: "模拟 V1.0 已提供参数、规范化、上下文和工具映射规则。" };
  });

  const dimensions = unique(conditions.flatMap((condition) => condition.ai_dimension ? [condition.ai_dimension] : [])) as AiDimension[];
  const elements = (section: BaselineSnapshot["accepted"][number]["section"]) => baseline.accepted
    .filter((entry) => entry.section === section)
    .map((entry) => ({ id: entry.item.id, description: entry.item.description, source_refs: entry.item.source_refs }));

  const document = TestModelDocumentSchema.parse({
    objective: `使用受控智能导购模拟基线 ${baselineId} 验证 TestMesh 从模型到评测的工程链路；不得解释为真实业务质量结论。`,
    quality_model: {
      objectives: ["验证业务规则、会话状态、工具调用和回复事实一致性的可追溯测试设计链路"],
      risk_refs: risks.map((risk) => risk.id),
      coverage_targets: coverageEntries.map((entry) => entry.item.id),
    },
    business_model: {
      actors: elements("actors"), business_rules: elements("business_rules"), flows: elements("flows"),
      states: elements("states"), constraints: elements("constraints"), exceptions: elements("exceptions"),
    },
    ai_model: {
      applicable: true,
      evaluation_subjects: ["testmesh", "target_application"],
      evaluation_layers: ["agent_decision", "tool_execution", "business_outcome", "final_response"],
      dimensions,
    },
    behavior_models: {
      semantic_parameter: {
        model_id: "M-01", name: "智能导购语义与参数模型",
        intents: [{ id: "product_recommendation", description: "根据用户约束推荐羽毛球拍", in_scope: true, required_slots: ["category"], source_refs: ["SRC-2", "SRC-3"] }],
        slots: [
          { name: "category", value_type: "string", required: true, default_value_json: "", allowed_range: "badminton_racket", canonical_unit: "", enum_values: ["badminton_racket"], normalization_rules: ["羽毛球拍标准化为 badminton_racket"], validation_rules: ["缺失时进入 NEED_CLARIFICATION"], source_refs: ["SRC-3"] },
          { name: "quantity", value_type: "integer", required: false, default_value_json: "3", allowed_range: "1..5", canonical_unit: "款", enum_values: [], normalization_rules: ["未指定时取 3"], validation_rules: ["小于1或大于5时澄清，不自动截断"], source_refs: ["SRC-3"] },
          { name: "min_price", value_type: "number", required: false, default_value_json: "", allowed_range: "0..10000", canonical_unit: "CNY", enum_values: [], normalization_rules: ["保留两位小数"], validation_rules: ["不得大于 max_price"], source_refs: ["SRC-3"] },
          { name: "max_price", value_type: "number", required: false, default_value_json: "", allowed_range: "0..10000", canonical_unit: "CNY", enum_values: [], normalization_rules: ["以内包含边界；保留两位小数"], validation_rules: ["未指定预算时不得补默认上限"], source_refs: ["SRC-3", "SRC-4"] },
          { name: "brand", value_type: "enum", required: false, default_value_json: "", allowed_range: "受控品牌词典", canonical_unit: "", enum_values: ["YONEX", "VICTOR", "LI_NING", "KAWASAKI"], normalization_rules: ["中英文及登记别名映射为标准编码"], validation_rules: ["未知或多品牌先澄清"], source_refs: ["SRC-3"] },
          { name: "weight_min", value_type: "number", required: false, default_value_json: "", allowed_range: ">0", canonical_unit: "g", enum_values: [], normalization_rules: ["kg、斤、两、oz 换算为 g，四舍五入两位"], validation_rules: ["不得大于 weight_max"], source_refs: ["SRC-3", "SRC-4"] },
          { name: "weight_max", value_type: "number", required: false, default_value_json: "", allowed_range: ">0", canonical_unit: "g", enum_values: [], normalization_rules: ["轻一点映射为不超过85g并按重量升序"], validation_rules: ["再轻一点且已有上限时要求确认"], source_refs: ["SRC-3", "SRC-4"] },
          { name: "color", value_type: "string", required: false, default_value_json: "", allowed_range: "受控商品颜色", canonical_unit: "", enum_values: [], normalization_rules: [], validation_rules: ["未知值先澄清"], source_refs: ["SRC-3"] },
          { name: "sort_by", value_type: "enum", required: false, default_value_json: "recommendation", allowed_range: "recommendation|price|weight", canonical_unit: "", enum_values: ["recommendation", "price", "weight"], normalization_rules: ["映射到工具 sort.field"], validation_rules: ["不支持的排序字段先澄清"], source_refs: ["SRC-3", "SRC-5"] },
          { name: "sort_order", value_type: "enum", required: false, default_value_json: "desc", allowed_range: "asc|desc", canonical_unit: "", enum_values: ["asc", "desc"], normalization_rules: ["映射到工具 sort.order"], validation_rules: [], source_refs: ["SRC-3", "SRC-5"] },
        ],
        cross_parameter_constraints: [
          { id: "M01-C01", expression: "min_price <= max_price", invalid_action: "进入 NEED_CLARIFICATION 且禁止调用工具", source_refs: ["SRC-3"] },
          { id: "M01-C02", expression: "weight_min <= weight_max", invalid_action: "进入 NEED_CLARIFICATION 且禁止调用工具", source_refs: ["SRC-3", "SRC-4"] },
          { id: "M01-C03", expression: "所有硬约束取交集", invalid_action: "不得为凑数量自动放宽条件", source_refs: ["SRC-2", "SRC-7"] },
        ],
      },
      business_decision: {
        model_id: "M-02", name: "智能导购业务决策模型",
        rules: [
          { id: "M02-D01", conditions: ["数量未指定"], actions: ["quantity=3"], priority: 10, source_refs: ["SRC-3"] },
          { id: "M02-D02", conditions: ["数量不在1..5"], actions: ["澄清", "禁止调用 search_products"], priority: 100, source_refs: ["SRC-3"] },
          { id: "M02-D03", conditions: ["参数合法且无冲突"], actions: ["调用 search_products", "按硬约束过滤和排序"], priority: 50, source_refs: ["SRC-2", "SRC-5"] },
          { id: "M02-D04", conditions: ["至少1件合法商品但少于请求数量"], actions: ["返回实际商品", "说明数量不足", "不得虚构或放宽条件"], priority: 80, source_refs: ["SRC-6", "SRC-7"] },
          { id: "M02-D05", conditions: ["可信查询结果为0"], actions: ["进入 NO_RESULT", "保留条件等待调整"], priority: 80, source_refs: ["SRC-2", "SRC-7"] },
        ],
      },
      dialogue_state: {
        model_id: "M-03", name: "智能导购会话状态模型",
        states: [
          ["COLLECTING", "收集推荐参数", false], ["VALIDATING", "校验参数和约束", false],
          ["NEED_CLARIFICATION", "等待澄清", false], ["SEARCHING", "调用商品搜索", false],
          ["COMPLETED", "完成本轮推荐", true], ["NO_RESULT", "查询成功但无匹配商品", false],
          ["FAILED", "工具异常且无法恢复", true], ["CANCELLED", "用户明确终止推荐", true],
        ].map(([id, description, terminal]) => ({ id, description, terminal, source_refs: ["SRC-2", "SRC-4"] })),
        transitions: [
          { id: "M03-T01", from: "COLLECTING", event: "参数齐备", guard: "category存在", actions: ["合并上下文"], to: "VALIDATING", search_allowed: false, source_refs: ["SRC-2", "SRC-4"] },
          { id: "M03-T02", from: "VALIDATING", event: "校验通过", guard: "无冲突", actions: ["构造工具参数"], to: "SEARCHING", search_allowed: true, source_refs: ["SRC-2", "SRC-5"] },
          { id: "M03-T03", from: "VALIDATING", event: "缺失、非法或冲突", guard: "校验失败", actions: ["保留上一份有效上下文", "询问用户"], to: "NEED_CLARIFICATION", search_allowed: false, source_refs: ["SRC-2", "SRC-3"] },
          { id: "M03-T04", from: "SEARCHING", event: "返回合法商品", guard: "valid_count>0", actions: ["生成有依据回复"], to: "COMPLETED", search_allowed: false, source_refs: ["SRC-6", "SRC-7"] },
          { id: "M03-T05", from: "SEARCHING", event: "可信零结果", guard: "valid_count=0", actions: ["保留条件"], to: "NO_RESULT", search_allowed: false, source_refs: ["SRC-2"] },
          { id: "M03-T06", from: "SEARCHING", event: "工具失败且无法恢复", guard: "执行异常", actions: ["不得虚构结果"], to: "FAILED", search_allowed: false, source_refs: ["SRC-2", "SRC-8"] },
        ],
        context_rules: [
          { id: "M03-C01", trigger: "未提及已有参数", operation: "retain", targets: ["effective_slots"], outcome: "保留有效上下文", source_refs: ["SRC-4"] },
          { id: "M03-C02", trigger: "明确修改同一参数", operation: "replace", targets: ["target_slot"], outcome: "新值覆盖旧值", source_refs: ["SRC-4"] },
          { id: "M03-C03", trigger: "新增参数", operation: "merge", targets: ["effective_slots"], outcome: "与现有约束合并", source_refs: ["SRC-4"] },
          { id: "M03-C04", trigger: "重新开始", operation: "clear", targets: ["recommendation_context"], outcome: "清空推荐上下文", source_refs: ["SRC-4"] },
          { id: "M03-C05", trigger: "算了且作用范围不明确", operation: "clarify", targets: [], outcome: "询问取消条件还是结束推荐", source_refs: ["SRC-2"] },
        ],
      },
      agent_interaction: {
        model_id: "M-04", name: "智能导购 Agent 交互模型",
        tools: [{
          name: "search_products", description: "按类别、过滤条件和排序规则查询商品",
          request_contract: "{category,limit,filters:{min_price,max_price,weight_min,weight_max,brand,color,status,in_stock},sort:{field,order}}",
          response_contract: "{code,data:{total,products:[{product_id,name,price,weight,stock,status}]}}",
          source_refs: ["SRC-5", "SRC-6"],
        }],
        interaction_rules: [
          { id: "M04-I01", trigger: "参数校验通过", preconditions: ["状态=VALIDATING", "无约束冲突"], tool: "search_products", argument_mapping: ["quantity→limit", "价格/重量/品牌/颜色→filters", "sort_by/sort_order→sort"], success_outcome: "验证并返回合法商品", empty_outcome: "进入 NO_RESULT", failure_outcome: "受控错误或批准的重试后进入 FAILED", evidence_requirements: ["intent", "slot_delta", "merged_slots", "完整 tool_calls", "推荐商品ID", "最终回复"], source_refs: ["SRC-5", "SRC-7", "SRC-8"] },
          { id: "M04-I02", trigger: "参数缺失、非法或冲突", preconditions: ["状态=NEED_CLARIFICATION"], tool: "", argument_mapping: [], success_outcome: "向用户澄清", empty_outcome: "继续等待用户", failure_outcome: "不得调用工具或虚构商品", evidence_requirements: ["业务状态", "禁止工具调用证据"], source_refs: ["SRC-2", "SRC-3"] },
        ],
      },
    },
    test_analysis: {
      objective: "用模拟规则建立风险、测试点和候选条件，验证后续独立 TestCondition 生成与审批链。",
      risks, test_points: testPoints, test_conditions: conditions,
      tool_applications: [
        { tool: "cucumber_gherkin", status: "applied", reason: "后续 TestCase 使用中文 Gherkin。" },
        { tool: "fast_check", status: "not_applicable", reason: "当前模拟阶段优先验证显式样本和边界，尚未定义属性生成计划。" },
        { tool: "nist_acts", status: "not_applicable", reason: "组合域和约束尚未形成可直接导入 ACTS 的正式模型。" },
        { tool: "graphwalker", status: "not_applicable", reason: "状态模型用于条件推导，当前不生成 GraphWalker 资产。" },
        { tool: "phoenix_evals", status: "applied", reason: "AI 样本、Evaluator 和 Experiment 由 Phoenix 承载。" },
      ],
      coverage_exclusions: [],
      parameter_extraction_assessment: {
        status: "applicable", implementation_pattern: "agent_workflow",
        reason: "模拟 V1.0 已定义 Slot、规范化、上下文更新和 search_products 参数映射。",
        source_refs: ["SRC-3", "SRC-4", "SRC-5"], schema_version: "smart-shopping-slots/v1",
        aspects: parameterAspectRows,
      },
    },
    knowledge_evidence: [],
  });
  validateTestModel(document, baseline);
  return document;
}
