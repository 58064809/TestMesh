import type { DomainStore } from "../store.js";
import type { AiQualityPostgresStore } from "../ai-quality/postgres-store.js";
import type { ProjectConfigPostgresStore } from "../project-config/postgres-store.js";
import type { RequirementAnalysisPostgresStore } from "../requirement-analysis/postgres-store.js";
import type { TestDesignPostgresStore } from "../test-design/postgres-store.js";
import type { TestModelPostgresStore } from "../test-design/test-model-store.js";
import type { FailureTriagePostgresStore } from "../failure-triage/postgres-store.js";
import type { QualityManagementPostgresStore, QualityPlanRecord } from "./postgres-store.js";
import { evaluateReleasePolicy, RELEASE_POLICY_VERSION, verifyOpa } from "./opa.js";

const AI_CHARACTERISTIC_DIMENSIONS: Partial<Record<QualityPlanRecord["qualityCharacteristics"][number], string[]>> = {
  ai_intent_recognition: ["intent_recognition"],
  ai_multi_turn_context: ["multi_turn_context"],
  ai_constraint_adherence: ["constraint_adherence"],
  ai_response_correctness: ["response_correctness"],
  ai_groundedness_hallucination: ["groundedness_hallucination"],
  ai_safety_refusal: ["safety_refusal"],
  ai_parameter_extraction: ["parameter_extraction"],
  ai_tool_use_correctness: ["tool_selection", "tool_invocation"],
  ai_robustness_consistency: ["robustness_consistency"],
};

export function assessAiEvaluationEvidence(
  approvedTestCaseVersionId: string,
  aiTestCaseIds: string[],
  aiProfile: Awaited<ReturnType<AiQualityPostgresStore["get"]>> | null,
) {
  const evidence = aiProfile?.phoenix.testCaseEvaluation;
  const evaluated = new Set(evidence?.evaluatedTestCaseIds ?? []);
  const missingTestCaseIds = aiTestCaseIds.filter((id) => !evaluated.has(id));
  const matchesVersion = evidence?.approvedTestCaseVersionId === approvedTestCaseVersionId;
  const linked = aiTestCaseIds.length > 0
    && aiProfile?.status === "approved"
    && Boolean(evidence)
    && matchesVersion
    && Boolean(evidence?.datasetVersionId)
    && Boolean(aiProfile.phoenix.datasetId)
    && Boolean(aiProfile.phoenix.experimentId)
    && (evidence?.evaluatorNames.length ?? 0) > 0
    && evidence?.status === "passed"
    && missingTestCaseIds.length === 0;
  return {
    linked,
    evaluatedTestCases: matchesVersion ? evaluated.size : 0,
    missingTestCaseIds: matchesVersion ? missingTestCaseIds : aiTestCaseIds,
  };
}

export class QualityManagementService {
  constructor(
    private readonly qualityStore: QualityManagementPostgresStore,
    private readonly projectStore: ProjectConfigPostgresStore,
    private readonly requirementStore: RequirementAnalysisPostgresStore,
    private readonly testDesignStore: TestDesignPostgresStore,
    private readonly testModelStore: TestModelPostgresStore,
    private readonly aiQualityStore: AiQualityPostgresStore,
    private readonly failureTriageStore: FailureTriagePostgresStore,
    private readonly runStore: DomainStore,
  ) {}

  async validatePlanAssets(plan: Pick<QualityPlanRecord, "projectId" | "baselineId" | "approvedTestModelVersionId" | "approvedTestCaseVersionId" | "aiQualityProfileId">): Promise<void> {
    await this.projectStore.getProject(plan.projectId);
    if (plan.baselineId) {
      const baselines = await this.requirementStore.listBaselines();
      if (!baselines.some((item) => item.id === plan.baselineId)) throw new Error("质量计划关联的需求基线不存在");
    }
    if (plan.approvedTestModelVersionId) {
      const model = await this.testModelStore.getApprovedVersion(plan.approvedTestModelVersionId);
      if (plan.baselineId && model.record.baselineId !== plan.baselineId) throw new Error("质量计划关联的测试模型与需求基线不一致");
    }
    if (plan.approvedTestCaseVersionId) {
      const approvedCases = await this.testDesignStore.getApprovedVersionById(plan.approvedTestCaseVersionId);
      const design = await this.testDesignStore.getDesign(approvedCases.record.designId);
      if (plan.approvedTestModelVersionId && design.approvedTestModelVersionId !== plan.approvedTestModelVersionId) {
        throw new Error("质量计划关联的 Approved TestCase 不是由所选 Approved Test Model 生成");
      }
    }
    if (plan.aiQualityProfileId) await this.aiQualityStore.get(plan.aiQualityProfileId);
  }

  async snapshot(plan: QualityPlanRecord) {
    const baselines = await this.requirementStore.listBaselines();
    const baseline = baselines.find((item) => item.id === plan.baselineId);
    const approvedModel = plan.approvedTestModelVersionId
      ? await this.testModelStore.getApprovedVersion(plan.approvedTestModelVersionId).catch(() => null)
      : null;
    const approved = plan.approvedTestCaseVersionId
      ? await this.testDesignStore.getApprovedVersionById(plan.approvedTestCaseVersionId).catch(() => null)
      : null;
    const aiProfile = plan.aiQualityProfileId ? await this.aiQualityStore.get(plan.aiQualityProfileId).catch(() => null) : null;
    const improvements = await this.qualityStore.listImprovements(plan.projectId);
    const latestGate = (await this.qualityStore.listGates(plan.projectId)).find((item) => item.planId === plan.id) ?? null;
    const yamlRuns = await this.qualityStore.listApiYamlRuns(plan.projectId, plan.approvedTestCaseVersionId);
    const [requirementReviews, requirementAmendments, testCaseReviews, testCaseAmendments, triages] = await Promise.all([
      baseline ? this.requirementStore.listReviews(baseline.analysisId) : Promise.resolve([]),
      baseline ? this.requirementStore.listAmendments(baseline.analysisId) : Promise.resolve([]),
      approved ? this.testDesignStore.listReviews(approved.record.designId) : Promise.resolve([]),
      approved ? this.testDesignStore.listAmendments(approved.record.designId) : Promise.resolve([]),
      this.failureTriageStore.list(),
    ]);

    const apiSpecs = this.runStore.listOpenApiSpecs().filter((item) => item.projectId === plan.projectId && (!plan.approvedTestCaseVersionId || item.approvedVersionId === plan.approvedTestCaseVersionId));
    const apiSpecIds = new Set(apiSpecs.map((item) => item.id));
    const schemaRuns = this.runStore.listTestRuns().filter((item) => apiSpecIds.has(item.specId));
    const scenarioSuites = new Map(this.runStore.listApiScenarioSuites().map((item) => [item.id, item]));
    const scenarioRuns = this.runStore.listApiScenarioRuns().filter((item) => {
      const suite = scenarioSuites.get(item.suiteId);
      return item.projectId === plan.projectId && (!plan.approvedTestCaseVersionId || suite?.approvedVersionId === plan.approvedTestCaseVersionId);
    });
    const uiRuns = this.runStore.listUiTestRuns().filter((item) => item.projectId === plan.projectId && (!plan.approvedTestCaseVersionId || item.approvedVersionId === plan.approvedTestCaseVersionId));
    const runs = [...schemaRuns, ...scenarioRuns, ...uiRuns, ...yamlRuns];
    const passedTests = runs.reduce((sum, item) => sum + item.passed, 0);
    const failedTests = runs.reduce((sum, item) => sum + item.failed, 0);
    const executedTests = passedTests + failedTests;

    const coverageEntries = approved ? Object.values(approved.snapshot.coverage) : [];
    const covered = coverageEntries.filter((item) => item.test_case_refs.length > 0 || Boolean(item.exclusion_reason)).length;
    const requirementCoveragePct = coverageEntries.length ? Number(((covered / coverageEntries.length) * 100).toFixed(2)) : 0;
    const executionPassRatePct = executedTests ? Number(((passedTests / executedTests) * 100).toFixed(2)) : 0;
    const aiTestCaseIds = approved?.snapshot.test_cases.filter((item) => Boolean(item.ai_evaluation)).map((item) => item.id) ?? [];
    const aiTestCases = aiTestCaseIds.length;
    const coveredAiDimensionValues = new Set<string>(approved?.snapshot.test_cases.flatMap((item) => item.ai_evaluation ? [item.ai_evaluation.dimension] : []) ?? []);
    const requiredAiDimensionValues = [...new Set(plan.qualityCharacteristics.flatMap((item) => AI_CHARACTERISTIC_DIMENSIONS[item] ?? []))];
    const missingAiDimensions = requiredAiDimensionValues.filter((item) => !coveredAiDimensionValues.has(item));
    const aiDimensions = coveredAiDimensionValues.size;
    const aiDimensionCoveragePct = requiredAiDimensionValues.length
      ? Number((((requiredAiDimensionValues.length - missingAiDimensions.length) / requiredAiDimensionValues.length) * 100).toFixed(2))
      : 100;
    const aiEvaluationEvidence = assessAiEvaluationEvidence(plan.approvedTestCaseVersionId, aiTestCaseIds, aiProfile);
    const approvedCases = approved?.snapshot.test_cases ?? [];
    const percentage = (numerator: number, denominator: number) => denominator
      ? Number(((numerator / denominator) * 100).toFixed(2))
      : 0;
    const executedTestCaseIds = new Set<string>();
    for (const run of schemaRuns) {
      const spec = apiSpecs.find((item) => item.id === run.specId);
      for (const item of run.items) {
        const mapping = spec?.testCases.find((testCase) => testCase.id === item.testCaseId);
        for (const id of mapping?.approvedTestCaseIds ?? []) executedTestCaseIds.add(id);
      }
    }
    for (const run of scenarioRuns) {
      for (const id of scenarioSuites.get(run.suiteId)?.approvedTestCaseIds ?? []) executedTestCaseIds.add(id);
    }
    for (const run of uiRuns) for (const id of run.approvedTestCaseIds) executedTestCaseIds.add(id);
    for (const run of yamlRuns) for (const id of run.approvedTestCaseIds) executedTestCaseIds.add(id);
    const dataSpecifiedCases = approvedCases.filter((item) => (item.test_data?.length ?? 0) > 0).length;
    const assertionSpecifiedCases = approvedCases.filter((item) =>
      (item.steps?.length ?? 0) > 0
      && item.steps!.every((step) => Boolean(step.expected.trim()))
      && (!item.ai_evaluation || Boolean(item.ai_evaluation.oracle_type)),
    ).length;
    const traceableCases = approvedCases.filter((item) =>
      item.trace_refs.length > 0 && item.source_refs.length > 0 && item.test_point_refs.length > 0,
    ).length;
    const failedRunIds = new Set(runs.filter((item) => item.status === "failed" || item.status === "error").map((item) => item.id));
    const linkedTriages = triages.filter((item) => item.input.projectId === plan.projectId && failedRunIds.has(item.input.runId));
    const locatedTriages = linkedTriages.filter((item) => item.result.status === "located").length;
    const triageEvidenceCategories = [...new Set(linkedTriages.flatMap((item) => item.evidence.map((evidence) => evidence.category)))];
    const requirementDecisions = requirementReviews.filter((item) => item.status !== "clarify").length;
    const acceptedTestCaseReviews = testCaseReviews.filter((item) => item.status === "accepted").length;
    const executionCompletenessPct = percentage(executedTestCaseIds.size, approvedCases.length);
    const aiEvaluationCoveragePct = percentage(aiEvaluationEvidence.evaluatedTestCases, aiTestCases);
    const metricCatalog = [
      coverageEntries.length > 0
        ? measured("requirement_coverage", "需求覆盖率", "覆盖", requirementCoveragePct, "%", covered, coverageEntries.length, "已覆盖或有批准排除理由的需求 / 基线需求总数", "Requirement Baseline + Approved TestCase")
        : unavailable("requirement_coverage", "需求覆盖率", "覆盖", "尚无 Approved TestCase 覆盖矩阵"),
      approvedCases.length > 0
        ? measured("execution_completeness", "执行完整率", "执行", executionCompletenessPct, "%", executedTestCaseIds.size, approvedCases.length, "至少被一个 TestRun 覆盖的 Approved TestCase / Approved TestCase 总数", "TestRun 关联")
        : unavailable("execution_completeness", "执行完整率", "执行", "尚无 Approved TestCase"),
      executedTests > 0
        ? measured("execution_pass_rate", "执行通过率", "执行", executionPassRatePct, "%", passedTests, executedTests, "通过测试项 / 已执行测试项", "TestRun")
        : unavailable("execution_pass_rate", "执行通过率", "执行", "尚无可计算的执行断言"),
      measured("traceability_completeness", "追溯完整度", "证据", percentage(traceableCases, approvedCases.length), "%", traceableCases, approvedCases.length, "具备 Requirement/Source/TestPoint 引用的用例 / Approved TestCase 总数", "Approved TestCase"),
      measured("test_data_design_coverage", "测试数据设计覆盖率", "设计", percentage(dataSpecifiedCases, approvedCases.length), "%", dataSpecifiedCases, approvedCases.length, "已定义 test_data 的用例 / Approved TestCase 总数", "Approved TestCase"),
      measured("assertion_design_coverage", "断言设计覆盖率", "设计", percentage(assertionSpecifiedCases, approvedCases.length), "%", assertionSpecifiedCases, approvedCases.length, "具备明确预期/Oracle 的用例 / Approved TestCase 总数", "Approved TestCase"),
      aiTestCases > 0
        ? measured("ai_evaluation_coverage", "AI 用例评测完整率", "AI质量", aiEvaluationCoveragePct, "%", aiEvaluationEvidence.evaluatedTestCases, aiTestCases, "Phoenix 已评测 AI 用例 / AI 用例总数", "Phoenix Experiment 引用")
        : unavailable("ai_evaluation_coverage", "AI 用例评测完整率", "AI质量", "当前 Approved TestCase 没有 AI 用例"),
      failedRunIds.size > 0
        ? measured("failure_triage_coverage", "失败定位覆盖率", "缺陷", percentage(new Set(linkedTriages.map((item) => item.input.runId)).size, failedRunIds.size), "%", new Set(linkedTriages.map((item) => item.input.runId)).size, failedRunIds.size, "已产生定位记录的失败 TestRun / 失败 TestRun 总数", "FailureTriage")
        : unavailable("failure_triage_coverage", "失败定位覆盖率", "缺陷", "当前没有失败 TestRun"),
      unavailable("defect_escape_rate", "缺陷逃逸率", "缺陷", "尚未接入生产缺陷/发布后缺陷数据；需要发布版本、发现阶段和缺陷状态"),
      unavailable("defect_reopen_rate", "缺陷重开率", "缺陷", "尚未接入 Jira/MeterSphere 等缺陷生命周期数据"),
      unavailable("critical_defect_closure_rate", "严重缺陷关闭率", "缺陷", "尚未接入按严重级别统计的缺陷数据"),
      unavailable("mean_time_to_diagnose", "平均缺陷定位时长", "效率", "FailureTriage 尚未记录人工确认完成时间"),
      unavailable("flaky_test_rate", "不稳定用例率", "执行", "尚未建立同版本重复执行与 flaky 判定记录"),
      unavailable("production_incident_rate", "生产事故率", "发布", "尚未接入发布记录和生产事故数据"),
    ];

    const facts = {
      plan_status: plan.status,
      assets: {
        baselineApproved: Boolean(baseline),
        testModelApproved: Boolean(approvedModel),
        testCasesApproved: Boolean(approved),
        aiQualityProfileApproved: aiProfile?.status === "approved",
        aiEvaluationEvidenceLinked: aiEvaluationEvidence.linked,
      },
      metrics: {
        requirementCoveragePct,
        approvedTestCases: approved?.snapshot.test_cases.length ?? 0,
        executionCount: runs.length,
        executionPassRatePct,
        passedTests,
        failedTests,
        apiExecutionCount: schemaRuns.length + scenarioRuns.length + yamlRuns.length,
        uiExecutionCount: uiRuns.length,
        aiTestCases,
        aiDimensions,
        requiredAiDimensions: requiredAiDimensionValues.length,
        aiDimensionCoveragePct,
        missingAiDimensions,
        aiEvaluatedTestCases: aiEvaluationEvidence.evaluatedTestCases,
        missingAiEvaluationTestCaseIds: aiEvaluationEvidence.missingTestCaseIds,
        requirementReviewCount: requirementReviews.length,
        requirementDecisionRatePct: percentage(requirementDecisions, requirementReviews.length),
        requirementAmendmentCount: requirementAmendments.length,
        testCaseReviewCount: testCaseReviews.length,
        testCaseAcceptanceRatePct: percentage(acceptedTestCaseReviews, testCaseReviews.length),
        testCaseAmendmentCount: testCaseAmendments.length,
        testDataSpecificationCoveragePct: percentage(dataSpecifiedCases, approvedCases.length),
        assertionDesignCoveragePct: percentage(assertionSpecifiedCases, approvedCases.length),
        traceabilityCompletenessPct: percentage(traceableCases, approvedCases.length),
        executionCompletenessPct,
        aiEvaluationCoveragePct,
        failedRunsRequiringTriage: failedRunIds.size,
        failureTriageCoveragePct: percentage(new Set(linkedTriages.map((item) => item.input.runId)).size, failedRunIds.size),
        locatedFailureRatePct: percentage(locatedTriages, linkedTriages.length),
        triageEvidenceCategories,
        openImprovementActions: improvements.filter((item) => item.status !== "closed").length,
      },
      rules: plan.gateRules,
    };

    const nodes = [
      { id: plan.id, type: "quality_plan", label: `${plan.name} v${plan.version}`, status: plan.status },
      ...(baseline ? [{ id: baseline.id, type: "requirement_baseline", label: `Requirement Baseline v${baseline.version}`, status: "approved" }] : []),
      ...(approvedModel ? [{ id: approvedModel.record.id, type: "approved_test_model", label: `Approved Test Model v${approvedModel.record.version}`, status: "approved" }] : []),
      ...(approved ? [{ id: approved.record.id, type: "approved_testcases", label: `Approved TestCase v${approved.record.version} · ${approved.snapshot.test_cases.length} 条`, status: "approved" }] : []),
      ...(aiProfile ? [{ id: aiProfile.id, type: "ai_quality_profile", label: `${aiProfile.name} · ${aiProfile.version}`, status: aiProfile.status }] : []),
      ...(latestGate ? [{ id: latestGate.id, type: "release_gate", label: `OPA ${latestGate.policyVersion}`, status: latestGate.status }] : []),
      ...runs.map((run) => ({ id: run.id, type: "test_run", label: `${"specId" in run ? "Schemathesis" : "engine" in run ? "FastAPI YAML" : "suiteId" in run ? "Legacy YAML API" : "Playwright"} · ${run.id.slice(0, 8)}`, status: run.status })),
      ...improvements.map((item) => ({ id: item.id, type: "improvement", label: item.title, status: item.status })),
    ];
    const links = [
      ...(baseline ? [{ from: plan.id, to: baseline.id, relation: "governs" }] : []),
      ...(approvedModel && baseline ? [{ from: baseline.id, to: approvedModel.record.id, relation: "modeled_as" }] : []),
      ...(approved && approvedModel ? [{ from: approvedModel.record.id, to: approved.record.id, relation: "verified_by" }] : []),
      ...(aiProfile ? [{ from: plan.id, to: aiProfile.id, relation: "governs_ai_quality_with" }] : []),
      ...(latestGate ? [{ from: plan.id, to: latestGate.id, relation: "evaluated_by" }] : []),
      ...runs.map((run) => ({ from: approved?.record.id ?? plan.id, to: run.id, relation: "executed_as" })),
      ...improvements.map((item) => ({ from: item.sourceId || plan.id, to: item.id, relation: "improves" })),
    ];
    const layers = {
      governance: {
        planApproved: plan.status === "approved",
        baselineApproved: Boolean(baseline),
        testModelApproved: Boolean(approvedModel),
        approvedTestCases: Boolean(approved),
      },
      coverage: { requirementCoveragePct, approvedTestCases: approved?.snapshot.test_cases.length ?? 0 },
      humanReview: { requirementReviewCount: requirementReviews.length, requirementDecisionRatePct: percentage(requirementDecisions, requirementReviews.length), requirementAmendmentCount: requirementAmendments.length, testCaseReviewCount: testCaseReviews.length, testCaseAcceptanceRatePct: percentage(acceptedTestCaseReviews, testCaseReviews.length), testCaseAmendmentCount: testCaseAmendments.length },
      testDesign: { testDataSpecificationCoveragePct: percentage(dataSpecifiedCases, approvedCases.length), assertionDesignCoveragePct: percentage(assertionSpecifiedCases, approvedCases.length), traceabilityCompletenessPct: percentage(traceableCases, approvedCases.length) },
      execution: { executionCount: runs.length, executionPassRatePct, passedTests, failedTests, failedRunsRequiringTriage: failedRunIds.size },
      diagnosis: { failureTriageCoveragePct: percentage(new Set(linkedTriages.map((item) => item.input.runId)).size, failedRunIds.size), locatedFailureRatePct: percentage(locatedTriages, linkedTriages.length), evidenceCategories: triageEvidenceCategories },
      aiQuality: { profileApproved: aiProfile?.status === "approved", evaluationEvidenceLinked: aiEvaluationEvidence.linked, aiTestCases, aiEvaluatedTestCases: aiEvaluationEvidence.evaluatedTestCases, aiDimensions, requiredAiDimensions: requiredAiDimensionValues.length, aiDimensionCoveragePct, missingAiDimensions, missingAiEvaluationTestCaseIds: aiEvaluationEvidence.missingTestCaseIds },
      improvement: { openActions: improvements.filter((item) => item.status !== "closed").length },
    };
    const gateFresh = Boolean(latestGate && canonicalJson(latestGate.facts) === canonicalJson(facts));
    return { plan, facts, metrics: facts.metrics, metricCatalog, latestGate, gateFresh, layers, assets: { nodes, links }, improvements };
  }

  async evaluate(planId: string) {
    const plan = await this.qualityStore.getPlan(planId);
    await this.validatePlanAssets(plan);
    const snapshot = await this.snapshot(plan);
    const opaVersion = await verifyOpa();
    const result = await evaluateReleasePolicy(snapshot.facts);
    return this.qualityStore.saveGate({ planId: plan.id, projectId: plan.projectId,
      policyVersion: RELEASE_POLICY_VERSION, opaVersion, status: result.status, facts: snapshot.facts, result });
  }
}

function measured(id: string, name: string, category: string, value: number, unit: string,
                  numerator: number, denominator: number, formula: string, evidence: string) {
  return { id, name, category, status: "available" as const, value, unit, numerator, denominator, formula, evidence, note: "" };
}

function unavailable(id: string, name: string, category: string, note: string) {
  return { id, name, category, status: "unavailable" as const, value: null, unit: "%", numerator: null, denominator: null, formula: "", evidence: "", note };
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}
