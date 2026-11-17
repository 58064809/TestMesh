import { PARAMETER_EXTRACTION_ASPECTS, type BaselineSnapshot, type TestDesign, type TestDesignPlan, type TestModelDocument } from "./schema.js";
import { validateChineseGherkin } from "./gherkin.js";

const COVERAGE_SECTIONS = new Set([
  "requirements", "business_rules", "flows", "states", "constraints", "exceptions", "open_questions",
]);

function unique(values: string[], label: string): void {
  if (new Set(values).size !== values.length) throw new Error(`${label} 存在重复 ID`);
}

function assertRefs(values: string[], allowed: Set<string>, label: string): void {
  const invalid = values.filter((value) => !allowed.has(value));
  if (invalid.length) throw new Error(`${label} 引用了不存在的 ID：${[...new Set(invalid)].join("、")}`);
}

function validateParameterExtractionAssessment(plan: TestDesignPlan, sourceIds: Set<string>): void {
  const assessment = plan.parameter_extraction_assessment;
  const parameterConditions = (plan.test_conditions ?? []).filter((item) => item.ai_dimension === "parameter_extraction");
  if (!assessment) {
    if (parameterConditions.length) throw new Error("存在参数提取测试条件，但缺少参数提取能力适用性评估");
    return;
  }
  assertRefs(assessment.source_refs, sourceIds, "parameter_extraction_assessment.source_refs");
  if (assessment.status !== "applicable") {
    if (parameterConditions.length) throw new Error(`参数提取能力状态为 ${assessment.status}，不能生成参数提取测试条件`);
    if (assessment.aspects.length) throw new Error(`参数提取能力状态为 ${assessment.status} 时 aspects 必须为空`);
    return;
  }
  if (!assessment.source_refs.length) throw new Error("参数提取能力适用时必须引用真实来源证据");
  const aspectNames = assessment.aspects.map((item) => item.aspect);
  unique(aspectNames, "参数提取测试维度");
  const missing = PARAMETER_EXTRACTION_ASPECTS.filter((item) => !aspectNames.includes(item));
  if (missing.length) throw new Error(`参数提取测试维度不完整，缺少：${missing.join("、")}`);
  if (!assessment.aspects.some((item) => item.status === "planned")) {
    throw new Error("参数提取能力已判定适用，但 18 个测试维度均未规划");
  }
  const parameterConditionIds = new Set(parameterConditions.map((item) => item.id));
  const plannedConditionIds: string[] = [];
  for (const row of assessment.aspects) {
    if (row.status === "planned" && !row.condition_refs.length) throw new Error(`参数提取维度 ${row.aspect} 已规划但没有 TestCondition`);
    if (row.status === "not_applicable" && row.condition_refs.length) throw new Error(`参数提取维度 ${row.aspect} 不适用时不能关联 TestCondition`);
    assertRefs(row.condition_refs, parameterConditionIds, `参数提取维度 ${row.aspect}.condition_refs`);
    plannedConditionIds.push(...row.condition_refs);
  }
  unique(plannedConditionIds, "参数提取 TestCondition 覆盖");
  const unclassified = [...parameterConditionIds].filter((id) => !plannedConditionIds.includes(id));
  if (unclassified.length) throw new Error(`参数提取 TestCondition 未归入专项维度：${unclassified.join("、")}`);
}

export function validateTestDesignPlan(plan: TestDesignPlan, baseline: BaselineSnapshot, allowedKnowledgeRefs = new Set<string>()): void {
  const traceIds = new Set(baseline.accepted.map((entry) => entry.item.id));
  const sourceIds = new Set(baseline.sourceRefs.map((source) => source.id));
  unique(plan.risks.map((risk) => risk.id), "Risk");
  unique(plan.test_points.map((point) => point.id), "TestPoint");
  const conditions = plan.test_conditions ?? [];
  unique(conditions.map((condition) => condition.id), "TestCondition");
  const riskIds = new Set(plan.risks.map((risk) => risk.id));
  for (const risk of plan.risks) {
    assertRefs(risk.trace_refs, traceIds, `${risk.id}.trace_refs`);
    assertRefs(risk.source_refs, sourceIds, `${risk.id}.source_refs`);
    assertRefs(risk.knowledge_refs, allowedKnowledgeRefs, `${risk.id}.knowledge_refs`);
  }
  for (const point of plan.test_points) {
    assertRefs(point.trace_refs, traceIds, `${point.id}.trace_refs`);
    assertRefs(point.risk_refs, riskIds, `${point.id}.risk_refs`);
    assertRefs(point.source_refs, sourceIds, `${point.id}.source_refs`);
    assertRefs(point.knowledge_refs, allowedKnowledgeRefs, `${point.id}.knowledge_refs`);
  }
  for (const condition of conditions) {
    assertRefs([condition.primary_trace_ref], traceIds, `${condition.id}.primary_trace_ref`);
    assertRefs(condition.source_refs, sourceIds, `${condition.id}.source_refs`);
    assertRefs(condition.knowledge_refs, allowedKnowledgeRefs, `${condition.id}.knowledge_refs`);
  }
  validateParameterExtractionAssessment(plan, sourceIds);
  const required = baseline.accepted
    .filter((entry) => COVERAGE_SECTIONS.has(entry.section))
    .map((entry) => entry.item.id);
  const exclusions = new Map(plan.coverage_exclusions.map((item) => [item.trace_ref, item.reason]));
  assertRefs([...exclusions.keys()], traceIds, "coverage_exclusions");
  for (const id of required.filter((traceRef) => !exclusions.has(traceRef))) {
    const planned = conditions.filter((condition) => condition.primary_trace_ref === id);
    if (planned.length < 2) {
      throw new Error(`测试条件规划 Gate 未通过：${id} 只有 ${planned.length} 个测试条件，至少需要正常/有效路径与反向/异常路径各一个`);
    }
  }
}

export function validateTestModel(model: TestModelDocument, baseline: BaselineSnapshot): void {
  const traceIds = new Set(baseline.accepted.map((entry) => entry.item.id));
  const sourceIds = new Set(baseline.sourceRefs.map((source) => source.id));
  const knowledgeIds = new Set(model.knowledge_evidence.map((item) => item.chunk_id));
  validateTestDesignPlan(model.test_analysis, baseline, knowledgeIds);
  unique(model.knowledge_evidence.map((item) => item.chunk_id), "KnowledgeEvidence");

  const groups = Object.entries(model.business_model) as Array<[string, Array<{ id: string; source_refs: string[] }>] >;
  for (const [group, items] of groups) {
    unique(items.map((item) => item.id), `business_model.${group}`);
    for (const item of items) {
      assertRefs([item.id], traceIds, `business_model.${group}.${item.id}`);
      assertRefs(item.source_refs, sourceIds, `business_model.${group}.${item.id}.source_refs`);
    }
  }

  if (!model.behavior_models) throw new Error("测试模型缺少 M-01～M-04 四个行为模型视图，请建立新版模型");
  {
    const views = model.behavior_models;
    unique(views.semantic_parameter.intents.map((item) => item.id), "M-01.intent");
    unique(views.semantic_parameter.slots.map((item) => item.name), "M-01.slot");
    unique(views.semantic_parameter.cross_parameter_constraints.map((item) => item.id), "M-01.constraint");
    unique(views.business_decision.rules.map((item) => item.id), "M-02.rule");
    unique(views.dialogue_state.states.map((item) => item.id), "M-03.state");
    unique(views.dialogue_state.transitions.map((item) => item.id), "M-03.transition");
    unique(views.dialogue_state.context_rules.map((item) => item.id), "M-03.context_rule");
    unique(views.agent_interaction.tools.map((item) => item.name), "M-04.tool");
    unique(views.agent_interaction.interaction_rules.map((item) => item.id), "M-04.interaction_rule");

    const sourceBearing = [
      ...views.semantic_parameter.intents,
      ...views.semantic_parameter.slots,
      ...views.semantic_parameter.cross_parameter_constraints,
      ...views.business_decision.rules,
      ...views.dialogue_state.states,
      ...views.dialogue_state.transitions,
      ...views.dialogue_state.context_rules,
      ...views.agent_interaction.tools,
      ...views.agent_interaction.interaction_rules,
    ];
    for (const item of sourceBearing) assertRefs(item.source_refs, sourceIds, `${"id" in item ? item.id : item.name}.source_refs`);

    const stateIds = new Set(views.dialogue_state.states.map((item) => item.id));
    for (const transition of views.dialogue_state.transitions) {
      assertRefs([transition.from, transition.to], stateIds, `${transition.id}.state_refs`);
    }
    const toolNames = new Set(views.agent_interaction.tools.map((item) => item.name));
    for (const rule of views.agent_interaction.interaction_rules) {
      if (rule.tool) assertRefs([rule.tool], toolNames, `${rule.id}.tool`);
    }
  }

  const requiredTargets = baseline.accepted
    .filter((entry) => COVERAGE_SECTIONS.has(entry.section))
    .map((entry) => entry.item.id);
  assertRefs(model.quality_model.coverage_targets, new Set(requiredTargets), "quality_model.coverage_targets");
  const exclusions = new Set(model.test_analysis.coverage_exclusions.map((item) => item.trace_ref));
  const missingTargets = requiredTargets.filter((id) => !model.quality_model.coverage_targets.includes(id) && !exclusions.has(id));
  if (missingTargets.length) throw new Error(`测试模型覆盖目标不完整，缺少：${missingTargets.join("、")}`);

  const riskIds = new Set(model.test_analysis.risks.map((item) => item.id));
  assertRefs(model.quality_model.risk_refs, riskIds, "quality_model.risk_refs");
  const dimensions = [...new Set(model.test_analysis.test_conditions.flatMap((item) => item.ai_dimension ? [item.ai_dimension] : []))];
  if (model.ai_model.applicable !== (dimensions.length > 0)) throw new Error("ai_model.applicable 与测试条件中的 AI 维度不一致");
  const missingDimensions = dimensions.filter((item) => !model.ai_model.dimensions.includes(item));
  const extraDimensions = model.ai_model.dimensions.filter((item) => !dimensions.includes(item));
  if (missingDimensions.length || extraDimensions.length) {
    throw new Error(`AI 模型维度与测试条件不一致：缺少 [${missingDimensions.join("、") || "无"}]；多余 [${extraDimensions.join("、") || "无"}]`);
  }
  if (model.ai_model.applicable) {
    const requiredSubjects = ["testmesh", "target_application"];
    const requiredLayers = ["agent_decision", "tool_execution", "business_outcome", "final_response"];
    const missingSubjects = requiredSubjects.filter((item) => !model.ai_model.evaluation_subjects.includes(item as never));
    const missingLayers = requiredLayers.filter((item) => !model.ai_model.evaluation_layers.includes(item as never));
    if (missingSubjects.length || missingLayers.length) {
      throw new Error(`AI 测试模型必须同时覆盖 TestMesh、被测 AI 应用及四层证据；缺少对象 [${missingSubjects.join("、") || "无"}]，缺少层级 [${missingLayers.join("、") || "无"}]`);
    }
  }
}

export function validateTestDesign(design: TestDesign, baseline: BaselineSnapshot, allowedKnowledgeRefs = new Set<string>()): void {
  const frozenKnowledgeRefs = new Set(design.knowledge_evidence.map((item) => item.chunk_id));
  unique([...frozenKnowledgeRefs], "KnowledgeEvidence");
  for (const ref of frozenKnowledgeRefs) {
    if (allowedKnowledgeRefs.size && !allowedKnowledgeRefs.has(ref)) throw new Error(`knowledge_evidence 引用了本次检索未返回的 ID：${ref}`);
  }
  const effectiveKnowledgeRefs = allowedKnowledgeRefs.size ? allowedKnowledgeRefs : frozenKnowledgeRefs;
  validateTestDesignPlan(design as TestDesignPlan, baseline, effectiveKnowledgeRefs);
  const traceIds = new Set(baseline.accepted.map((entry) => entry.item.id));
  const sourceIds = new Set(baseline.sourceRefs.map((source) => source.id));
  const riskIdList = design.risks.map((risk) => risk.id);
  const pointIdList = design.test_points.map((point) => point.id);
  const conditions = design.test_conditions ?? [];
  if (!conditions.length) throw new Error("测试设计缺少测试条件规划 test_conditions");
  const conditionIdList = conditions.map((condition) => condition.id);
  const caseIdList = design.test_cases.map((testCase) => testCase.id);
  unique(riskIdList, "Risk");
  unique(pointIdList, "TestPoint");
  unique(conditionIdList, "TestCondition");
  unique(caseIdList, "TestCase");
  const riskIds = new Set(riskIdList);
  const pointIds = new Set(pointIdList);
  const conditionIds = new Set(conditionIdList);
  const caseIds = new Set(caseIdList);

  for (const risk of design.risks) {
    assertRefs(risk.trace_refs, traceIds, `${risk.id}.trace_refs`);
    assertRefs(risk.source_refs, sourceIds, `${risk.id}.source_refs`);
  }
  for (const point of design.test_points) {
    assertRefs(point.trace_refs, traceIds, `${point.id}.trace_refs`);
    assertRefs(point.risk_refs, riskIds, `${point.id}.risk_refs`);
    assertRefs(point.source_refs, sourceIds, `${point.id}.source_refs`);
  }
  for (const condition of conditions) {
    assertRefs([condition.primary_trace_ref], traceIds, `${condition.id}.primary_trace_ref`);
    assertRefs(condition.source_refs, sourceIds, `${condition.id}.source_refs`);
  }
  for (const testCase of design.test_cases) {
    if (!testCase.primary_trace_ref) throw new Error(`${testCase.id} 缺少主要验证对象 primary_trace_ref`);
    if (!testCase.module || !testCase.scenario_type || !testCase.technique || !testCase.steps?.length || !testCase.test_data
      || !testCase.primary_test_condition_ref || !testCase.test_condition_refs?.length) {
      throw new Error(`${testCase.id} 缺少模块、场景类型、测试技法、测试数据或结构化步骤`);
    }
    assertRefs(testCase.test_condition_refs, conditionIds, `${testCase.id}.test_condition_refs`);
    if (!testCase.test_condition_refs.includes(testCase.primary_test_condition_ref)) {
      throw new Error(`${testCase.id}.primary_test_condition_ref 必须存在于 test_condition_refs`);
    }
    const primaryCondition = conditions.find((condition) => condition.id === testCase.primary_test_condition_ref);
    if (primaryCondition?.primary_trace_ref !== testCase.primary_trace_ref) {
      throw new Error(`${testCase.id} 的主要测试条件与主要基线项不一致`);
    }
    if (primaryCondition?.ai_dimension) {
      if (!testCase.ai_evaluation) throw new Error(`${testCase.id} 是 AI 行为测试，但缺少 ai_evaluation`);
      if (testCase.ai_evaluation.dimension !== primaryCondition.ai_dimension) {
        throw new Error(`${testCase.id}.ai_evaluation.dimension 与主要测试条件不一致`);
      }
      if (testCase.scenario_type !== "ai_behavior" || testCase.technique !== "ai_evaluation") {
        throw new Error(`${testCase.id} 的 AI 行为测试必须使用 ai_behavior / ai_evaluation`);
      }
      if (primaryCondition.ai_dimension === "parameter_extraction") {
        const parameter = testCase.ai_evaluation.parameter_extraction;
        if (!parameter) throw new Error(`${testCase.id} 是参数提取测试，但缺少字段级判定协议`);
        const assessmentRow = design.parameter_extraction_assessment?.aspects.find((item) => item.condition_refs.includes(primaryCondition.id));
        if (!assessmentRow || assessmentRow.aspect !== parameter.aspect) {
          throw new Error(`${testCase.id}.parameter_extraction.aspect 与参数提取覆盖计划不一致`);
        }
      } else if (testCase.ai_evaluation.parameter_extraction) {
        throw new Error(`${testCase.id} 不是参数提取测试，不能附带字段级参数判定协议`);
      }
    } else if (testCase.ai_evaluation) {
      throw new Error(`${testCase.id} 的普通业务测试不能附带 AI 评测配置`);
    }
    const stepOrders = testCase.steps.map((step) => step.order);
    if (new Set(stepOrders).size !== stepOrders.length || stepOrders.some((order, index) => order !== index + 1)) {
      throw new Error(`${testCase.id}.steps 必须从 1 开始连续编号`);
    }
    if (!testCase.trace_refs.includes(testCase.primary_trace_ref)) {
      throw new Error(`${testCase.id}.primary_trace_ref 必须同时存在于该用例的 trace_refs`);
    }
    assertRefs(testCase.trace_refs, traceIds, `${testCase.id}.trace_refs`);
    assertRefs(testCase.risk_refs, riskIds, `${testCase.id}.risk_refs`);
    assertRefs(testCase.test_point_refs, pointIds, `${testCase.id}.test_point_refs`);
    assertRefs(testCase.source_refs, sourceIds, `${testCase.id}.source_refs`);
    assertRefs(testCase.knowledge_refs, effectiveKnowledgeRefs, `${testCase.id}.knowledge_refs`);
    const allowedForCondition = new Set(primaryCondition?.knowledge_refs ?? []);
    assertRefs(testCase.knowledge_refs, allowedForCondition, `${testCase.id}.knowledge_refs`);
    validateChineseGherkin(testCase.gherkin);
  }
  const usedKnowledgeRefs = new Set([
    ...design.risks.flatMap((item) => item.knowledge_refs),
    ...design.test_points.flatMap((item) => item.knowledge_refs),
    ...conditions.flatMap((item) => item.knowledge_refs),
    ...design.test_cases.flatMap((item) => item.knowledge_refs),
  ]);
  const missingFrozenEvidence = [...usedKnowledgeRefs].filter((ref) => !frozenKnowledgeRefs.has(ref));
  if (missingFrozenEvidence.length) throw new Error(`知识证据快照缺少引用：${missingFrozenEvidence.join("、")}`);

  const toolRows = new Map(design.tool_applications.map((item) => [item.tool, item]));
  for (const tool of ["cucumber_gherkin", "fast_check", "nist_acts", "graphwalker"] as const) {
    if (!toolRows.has(tool)) throw new Error(`缺少 ${tool} 的适用性结论`);
  }
  if (toolRows.get("cucumber_gherkin")?.status !== "applied") {
    throw new Error("Cucumber/Gherkin 是 TD01 唯一 TestCase 表达，必须标记为 applied");
  }
  if (conditions.some((item) => item.ai_dimension) && toolRows.get("phoenix_evals")?.status !== "applied") {
    throw new Error("存在 Testing for AI 条件时，Phoenix Dataset/Experiment/Evaluator 必须标记为 applied");
  }

  const exclusions = new Map(design.coverage_exclusions.map((item) => [item.trace_ref, item.reason]));
  assertRefs([...exclusions.keys()], traceIds, "coverage_exclusions");
  const coveredByPoint = new Set(design.test_points.flatMap((point) => point.trace_refs));
  const coveredByCase = new Set(design.test_cases.flatMap((testCase) => testCase.trace_refs));
  const required = baseline.accepted
    .filter((entry) => COVERAGE_SECTIONS.has(entry.section))
    .map((entry) => entry.item.id);
  for (const id of required.filter((traceRef) => !exclusions.has(traceRef))) {
    const planned = conditions.filter((condition) => condition.primary_trace_ref === id);
    if (planned.length < 2) {
      throw new Error(`测试条件规划 Gate 未通过：${id} 只有 ${planned.length} 个测试条件，至少需要正常/有效路径与反向/异常路径各一个`);
    }
  }
  const primaryConditionCoverage = new Set(design.test_cases.map((testCase) => testCase.primary_test_condition_ref).filter(Boolean));
  const uncoveredConditions = conditionIdList.filter((id) => !primaryConditionCoverage.has(id));
  if (uncoveredConditions.length) {
    throw new Error(`测试条件 Gate 未通过：以下测试条件没有独立 TestCase：[${uncoveredConditions.join("、")}]`);
  }
  const coverageKeys = Object.keys(design.coverage);
  const missingCoverageRows = required.filter((id) => !coverageKeys.includes(id));
  const extraCoverageRows = coverageKeys.filter((id) => !required.includes(id));
  if (missingCoverageRows.length || extraCoverageRows.length) {
    throw new Error(`覆盖矩阵键不完整：缺少 [${missingCoverageRows.join("、") || "无"}]；多余 [${extraCoverageRows.join("、") || "无"}]`);
  }
  for (const id of required) {
    const row = design.coverage[id];
    assertRefs(row.test_point_refs, pointIds, `coverage.${id}.test_point_refs`);
    assertRefs(row.test_case_refs, caseIds, `coverage.${id}.test_case_refs`);
    if (row.exclusion_reason) {
      if (row.test_point_refs.length || row.test_case_refs.length) throw new Error(`${id} 不能同时声明覆盖和不适用`);
      if (exclusions.get(id) !== row.exclusion_reason) throw new Error(`${id} 的覆盖矩阵与 coverage_exclusions 不一致`);
    } else {
      if (!row.test_point_refs.length || !row.test_case_refs.length) throw new Error(`${id} 的覆盖矩阵缺少 TestPoint 或 TestCase`);
      if (row.test_point_refs.some((ref) => !design.test_points.find((point) => point.id === ref)?.trace_refs.includes(id))) {
        throw new Error(`${id} 的覆盖矩阵引用了未实际追溯该基线项的 TestPoint`);
      }
      if (row.test_case_refs.some((ref) => !design.test_cases.find((testCase) => testCase.id === ref)?.trace_refs.includes(id))) {
        throw new Error(`${id} 的覆盖矩阵引用了未实际追溯该基线项的 TestCase`);
      }
    }
  }
  const missingPoints = required.filter((id) => !coveredByPoint.has(id) && !exclusions.has(id));
  const missingCases = required.filter((id) => !coveredByCase.has(id) && !exclusions.has(id));
  const uncovered = [...new Set([...missingPoints, ...missingCases])];
  if (uncovered.length) {
    throw new Error(`覆盖 Gate 未通过：缺少测试点 [${missingPoints.join("、") || "无"}]；缺少 TestCase [${missingCases.join("、") || "无"}]。这些条目也没有不适用理由。`);
  }
  const primaryCoverage = new Set(design.test_cases.map((testCase) => testCase.primary_trace_ref).filter(Boolean));
  const missingPrimaryCases = required.filter((id) => !primaryCoverage.has(id) && !exclusions.has(id));
  if (missingPrimaryCases.length) {
    throw new Error(`原子用例 Gate 未通过：以下基线项没有作为任何 TestCase 的主要验证对象：[${missingPrimaryCases.join("、")}]`);
  }
}
