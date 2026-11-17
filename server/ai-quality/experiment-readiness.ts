import { parse } from "yaml";
import { z } from "zod";
import type { AiQualityPostgresStore, ApprovedApiScenarioRecord, AiDatasetExportRecord } from "./postgres-store.js";
import type { TestDesignPostgresStore } from "../test-design/postgres-store.js";

const AiExecutionContractSchema = z.object({
  target_id: z.string().trim().min(1),
  target_version: z.string().trim().min(1),
  interaction: z.enum(["single_turn", "multi_turn", "agent"]),
  session_id_variable: z.string().trim().min(1).optional(),
  trace_id_variable: z.string().trim().min(1).default("trace_id"),
  require_trace: z.literal(true),
  observability_standard: z.literal("openinference"),
  evaluation_provider: z.literal("phoenix"),
  evaluator_names: z.array(z.string().trim().min(1)).min(1),
}).strict().superRefine((contract, context) => {
  if (contract.interaction !== "single_turn" && !contract.session_id_variable) {
    context.addIssue({ code: "custom", path: ["session_id_variable"], message: "多轮或 Agent 场景必须声明 session_id_variable" });
  }
});

const ScenarioEnvelopeSchema = z.object({
  format: z.literal("testmesh-api/v1"),
  ai_application: AiExecutionContractSchema,
}).passthrough();

export interface AiExecutionAssetView {
  id: string;
  name: string;
  contentSha256: string;
  approvedTestCaseIds: string[];
  valid: boolean;
  problem: string;
  targetId: string;
  targetVersion: string;
  interaction: "single_turn" | "multi_turn" | "agent" | "";
  evaluatorNames: string[];
}

export interface AiExperimentReadiness {
  datasetExportId: string;
  datasetId: string;
  datasetVersionId: string;
  approvedTestCaseVersionId: string;
  totalAiTestCases: number;
  mappedAiTestCases: number;
  validExecutionAssets: number;
  missingTestCaseIds: string[];
  aiTestCases: Array<{
    id: string;
    title: string;
    objective: string;
    dimension: string;
    priority: string;
    evaluator: string;
    executionStatus: "missing" | "mapped" | "duplicate";
  }>;
  duplicateTestCaseIds: string[];
  invalidAssets: AiExecutionAssetView[];
  uncalibratedEvaluatorNames: string[];
  assets: AiExecutionAssetView[];
  ready: boolean;
  gateEligible: false;
  blockers: string[];
}

function readContract(asset: ApprovedApiScenarioRecord): AiExecutionAssetView {
  const base = {
    id: asset.id,
    name: asset.name,
    contentSha256: asset.contentSha256,
    approvedTestCaseIds: asset.approvedTestCaseIds,
    valid: false,
    problem: "",
    targetId: "",
    targetVersion: "",
    interaction: "" as const,
    evaluatorNames: [] as string[],
  };
  try {
    const result = ScenarioEnvelopeSchema.safeParse(parse(asset.yamlContent));
    if (!result.success) {
      return { ...base, problem: result.error.issues.map((issue) => `${issue.path.join(".")}：${issue.message}`).join("；") };
    }
    return {
      ...base,
      valid: true,
      targetId: result.data.ai_application.target_id,
      targetVersion: result.data.ai_application.target_version,
      interaction: result.data.ai_application.interaction,
      evaluatorNames: result.data.ai_application.evaluator_names,
    };
  } catch (error) {
    return { ...base, problem: error instanceof Error ? error.message : "YAML 无法解析" };
  }
}

export function buildAiExperimentReadiness(input: {
  datasetExport: AiDatasetExportRecord;
  aiTestCaseIds: string[];
  aiTestCases?: Array<{
    id: string; title: string; objective: string; dimension: string; priority: string; evaluator: string;
  }>;
  calibratedEvaluatorNames?: string[];
  approvedAssets: ApprovedApiScenarioRecord[];
}): AiExperimentReadiness {
  const aiIds = new Set(input.aiTestCaseIds);
  const assets = input.approvedAssets.map(readContract);
  const mappings = new Map<string, AiExecutionAssetView[]>();
  for (const asset of assets.filter((item) => item.valid)) {
    for (const testCaseId of asset.approvedTestCaseIds.filter((id) => aiIds.has(id))) {
      mappings.set(testCaseId, [...(mappings.get(testCaseId) ?? []), asset]);
    }
  }
  const missingTestCaseIds = input.aiTestCaseIds.filter((id) => !mappings.has(id));
  const duplicateTestCaseIds = input.aiTestCaseIds.filter((id) => (mappings.get(id)?.length ?? 0) > 1);
  const invalidAssets = assets.filter((item) => !item.valid);
  const unboundSampleAssets = input.approvedAssets.filter((item) => {
    const parsed = assets.find((asset) => asset.id === item.id);
    return parsed?.valid && !JSON.stringify(parse(item.yamlContent)?.steps ?? []).includes("${dataset_input");
  });
  const requiredEvaluatorNames = [...new Set(assets.filter((item) => item.valid).flatMap((item) => item.evaluatorNames))].sort();
  const calibrated = new Set(input.calibratedEvaluatorNames ?? requiredEvaluatorNames);
  const uncalibratedEvaluatorNames = requiredEvaluatorNames.filter((name) => !calibrated.has(name));
  const summaries = input.aiTestCases ?? input.aiTestCaseIds.map((id) => ({
    id, title: id, objective: "", dimension: "", priority: "", evaluator: "",
  }));
  const blockers = [
    ...(input.datasetExport.dataClass === "evaluation-dataset" ? [] : ["当前 Phoenix Dataset 是冻结 TestCase 评测计划清单，不是包含真实输入、期望和标签的评测样本集，禁止直接运行目标 Experiment"]),
    ...(missingTestCaseIds.length ? [`${missingTestCaseIds.length} 条 AI TestCase 尚未关联含 ai_application 契约的已批准 YAML 场景`] : []),
    ...(duplicateTestCaseIds.length ? [`${duplicateTestCaseIds.length} 条 AI TestCase 关联了多个执行场景，无法确定唯一执行证据`] : []),
    ...(invalidAssets.length ? [`${invalidAssets.length} 个已批准 YAML 场景缺少或违反 AI 应用执行契约`] : []),
    ...(unboundSampleAssets.length ? [`${unboundSampleAssets.length} 个 AI YAML 场景未引用 Dataset 样本输入 ${"${dataset_input}"}`] : []),
    ...(uncalibratedEvaluatorNames.length ? [`${uncalibratedEvaluatorNames.length} 个 Phoenix Evaluator 尚未通过金标准校准：${uncalibratedEvaluatorNames.join("、")}`] : []),
  ];
  return {
    datasetExportId: input.datasetExport.id,
    datasetId: input.datasetExport.datasetId,
    datasetVersionId: input.datasetExport.datasetVersionId,
    approvedTestCaseVersionId: input.datasetExport.approvedTestCaseVersionId,
    totalAiTestCases: input.aiTestCaseIds.length,
    mappedAiTestCases: input.aiTestCaseIds.length - missingTestCaseIds.length,
    validExecutionAssets: assets.filter((item) => item.valid).length,
    missingTestCaseIds,
    aiTestCases: summaries.map((item) => ({
      ...item,
      executionStatus: duplicateTestCaseIds.includes(item.id)
        ? "duplicate" as const
        : missingTestCaseIds.includes(item.id) ? "missing" as const : "mapped" as const,
    })),
    duplicateTestCaseIds,
    invalidAssets,
    uncalibratedEvaluatorNames,
    assets,
    ready: blockers.length === 0,
    gateEligible: false,
    blockers: blockers.length ? blockers : ["执行映射已就绪；只有 Phoenix Experiment 和全部必需 Evaluator 完成后才可形成准入证据"],
  };
}

export class AiExperimentReadinessService {
  constructor(
    private readonly testDesignStore: TestDesignPostgresStore,
    private readonly aiQualityStore: AiQualityPostgresStore,
  ) {}

  async inspect(datasetExportId: string): Promise<AiExperimentReadiness> {
    const datasetExport = await this.aiQualityStore.getDatasetExport(datasetExportId);
    const [approved, assets, calibrations] = await Promise.all([
      this.testDesignStore.getApprovedVersionById(datasetExport.approvedTestCaseVersionId),
      this.aiQualityStore.listApprovedApiScenarios(datasetExport.approvedTestCaseVersionId),
      this.aiQualityStore.listEvaluatorCalibrations(),
    ]);
    const aiTestCases = approved.snapshot.test_cases
      .filter((item) => Boolean(item.ai_evaluation))
      .map((item) => ({
        id: item.id,
        title: item.title,
        objective: item.objective,
        dimension: item.ai_evaluation!.dimension,
        priority: item.priority,
        evaluator: item.ai_evaluation!.evaluator,
      }));
    return buildAiExperimentReadiness({
      datasetExport, aiTestCaseIds: aiTestCases.map((item) => item.id), aiTestCases, approvedAssets: assets,
      calibratedEvaluatorNames: calibrations.filter((item) => item.passed).map((item) => item.evaluatorName),
    });
  }
}
