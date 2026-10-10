import type { BaselineSnapshot, TestDesign } from "./schema.js";
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

export function validateTestDesign(design: TestDesign, baseline: BaselineSnapshot): void {
  const traceIds = new Set(baseline.accepted.map((entry) => entry.item.id));
  const sourceIds = new Set(baseline.sourceRefs.map((source) => source.id));
  const riskIdList = design.risks.map((risk) => risk.id);
  const pointIdList = design.test_points.map((point) => point.id);
  const caseIdList = design.test_cases.map((testCase) => testCase.id);
  unique(riskIdList, "Risk");
  unique(pointIdList, "TestPoint");
  unique(caseIdList, "TestCase");
  const riskIds = new Set(riskIdList);
  const pointIds = new Set(pointIdList);
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
  for (const testCase of design.test_cases) {
    if (!testCase.primary_trace_ref) throw new Error(`${testCase.id} 缺少主要验证对象 primary_trace_ref`);
    if (!testCase.module || !testCase.scenario_type || !testCase.technique || !testCase.steps?.length || !testCase.test_data) {
      throw new Error(`${testCase.id} 缺少模块、场景类型、测试技法、测试数据或结构化步骤`);
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
    validateChineseGherkin(testCase.gherkin);
  }

  const toolRows = new Map(design.tool_applications.map((item) => [item.tool, item]));
  for (const tool of ["cucumber_gherkin", "fast_check", "nist_acts", "graphwalker"] as const) {
    if (!toolRows.has(tool)) throw new Error(`缺少 ${tool} 的适用性结论`);
  }
  if (toolRows.get("cucumber_gherkin")?.status !== "applied") {
    throw new Error("Cucumber/Gherkin 是 TD01 唯一 TestCase 表达，必须标记为 applied");
  }

  const exclusions = new Map(design.coverage_exclusions.map((item) => [item.trace_ref, item.reason]));
  assertRefs([...exclusions.keys()], traceIds, "coverage_exclusions");
  const coveredByPoint = new Set(design.test_points.flatMap((point) => point.trace_refs));
  const coveredByCase = new Set(design.test_cases.flatMap((testCase) => testCase.trace_refs));
  const required = baseline.accepted
    .filter((entry) => COVERAGE_SECTIONS.has(entry.section))
    .map((entry) => entry.item.id);
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
