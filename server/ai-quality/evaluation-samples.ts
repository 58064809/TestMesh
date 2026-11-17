import { createHash, randomUUID } from "node:crypto";
import { createClient } from "@arizeai/phoenix-client";
import { createDataset, getDataset } from "@arizeai/phoenix-client/datasets";
import { z } from "zod";
import type { TestDesignPostgresStore } from "../test-design/postgres-store.js";
import type { TestCase } from "../test-design/schema.js";
import type {
  AiDatasetExportRecord,
  AiEvaluationSampleRecord,
  AiEvaluationSampleSetRecord,
  AiQualityPostgresStore,
} from "./postgres-store.js";

const JsonObjectSchema = z.record(z.string(), z.unknown());

const ConversationTurnSchema = z.object({
  role: z.enum(["system", "user", "assistant", "tool"]),
  content: z.string().min(1),
  name: z.string().min(1).optional(),
}).strict();

export const RobustnessPerturbationFamilySchema = z.enum([
  "paraphrase", "typo_noise", "format_structure", "irrelevant_context", "length_boundary",
  "tone_persona", "entity_value_shift", "language_locale", "order_reordering", "negation_conflict",
  "multi_turn_drift", "out_of_distribution", "prompt_injection", "tool_dependency_failure", "repeatability",
]);

export const EvaluationSamplePayloadSchema = z.object({
  approvedTestCaseId: z.string().regex(/^TC-\d{3}$/),
  input: z.object({
    message: z.string().trim().min(1).optional(),
    conversation: z.array(ConversationTurnSchema).optional(),
    context: JsonObjectSchema.optional(),
  }).strict().refine((value) => Boolean(value.message || value.conversation?.length), {
    message: "样本必须提供 message 或 conversation",
  }),
  expected: JsonObjectSchema.refine((value) => Object.keys(value).length > 0, {
    message: "expected 至少需要一个可判定字段",
  }),
  metadata: z.object({
    fixtureRefs: z.array(z.string().trim().min(1)).default([]),
    sourceRefs: z.array(z.string().trim().min(1)).default([]),
    expectedTools: z.array(z.string().trim().min(1)).default([]),
    forbiddenTools: z.array(z.string().trim().min(1)).default([]),
    tags: z.array(z.string().trim().min(1)).default([]),
    variantGroupId: z.string().trim().min(1).optional(),
    baselineSampleId: z.string().trim().min(1).optional(),
    perturbationFamily: RobustnessPerturbationFamilySchema.optional(),
    expectedRelation: z.enum(["invariant", "controlled_change", "fail_safe"]).optional(),
    evaluationSlice: z.string().trim().min(1).optional(),
    heldOut: z.boolean().default(false),
    sourceKind: z.enum(["human_curated", "production_replay", "synthetic_reviewed"]).default("human_curated"),
    evaluationSubject: z.enum(["testmesh", "target_application"]).optional(),
    evaluationLayer: z.enum(["agent_decision", "tool_execution", "business_outcome", "final_response"]).optional(),
  }).strict().default({
    fixtureRefs: [], sourceRefs: [], expectedTools: [], forbiddenTools: [], tags: [],
    heldOut: false, sourceKind: "human_curated",
  }),
  operator: z.string().trim().min(1).max(100),
}).strict();

export const EvaluationSampleSetInputSchema = z.object({
  approvedTestCaseVersionId: z.string().trim().min(1),
  name: z.string().trim().min(1).max(160),
  createdBy: z.string().trim().min(1).max(100),
}).strict();

export const EvaluationSampleReviewSchema = z.object({
  status: z.enum(["approved", "rejected"]),
  reviewedBy: z.string().trim().min(1).max(100),
  reviewNote: z.string().trim().max(1000).default(""),
}).strict().superRefine((value, context) => {
  if (value.status === "rejected" && !value.reviewNote) {
    context.addIssue({ code: "custom", path: ["reviewNote"], message: "拒绝样本时必须填写原因" });
  }
});

export const EvaluationSampleFreezeSchema = z.object({
  frozenBy: z.string().trim().min(1).max(100),
}).strict();

export const EvaluationDatasetExportSchema = z.object({
  exportedBy: z.string().trim().min(1).max(100),
}).strict();

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function hasPlaceholder(value: unknown): boolean {
  if (typeof value === "string") return /待配置|待补充|\b(?:todo|tbd)\b|placeholder/i.test(value);
  if (Array.isArray(value)) return value.some(hasPlaceholder);
  return Boolean(value && typeof value === "object" && Object.values(value).some(hasPlaceholder));
}

export function buildDatasetSpecification(approvedVersionId: string, testCases: TestCase[]) {
  return {
    approvedTestCaseVersionId: approvedVersionId,
    cases: testCases.filter((item) => item.ai_evaluation).map((item) => ({
      testCaseId: item.id,
      testConditionId: item.primary_test_condition_ref ?? "",
      title: item.title,
      priority: item.priority,
      dimension: item.ai_evaluation!.dimension,
      evaluationSubjects: item.ai_evaluation!.evaluation_subjects ?? [],
      evaluationLayers: item.ai_evaluation!.evaluation_layers ?? [],
      oracleType: item.ai_evaluation!.oracle_type,
      evaluator: item.ai_evaluation!.evaluator,
      threshold: item.ai_evaluation!.threshold,
      expectedBehavior: item.ai_evaluation!.expected_behavior,
      datasetRequirements: item.ai_evaluation!.dataset_requirements,
      evidenceRequirements: item.ai_evaluation!.evidence_requirements,
      sourceRefs: item.source_refs,
      riskRefs: item.risk_refs,
    })),
  };
}

export function buildFrozenExamples(sampleSet: AiEvaluationSampleSetRecord, approvedModelVersionId: string, testCases: TestCase[]) {
  return sampleSet.samples.filter((sample) => sample.status === "approved").map((sample) => {
    const testCase = testCases.find((item) => item.id === sample.approvedTestCaseId && item.ai_evaluation);
    if (!testCase?.primary_test_condition_ref) throw new Error(`样本 ${sample.id} 缺少已批准用例或 TestCondition 回链`);
    return ({
    id: sample.id,
    input: sample.input,
    output: sample.expected,
    metadata: {
      ...sample.metadata,
      dataClass: "evaluation-dataset",
      sampleSetId: sampleSet.id,
      approvedTestCaseVersionId: sampleSet.approvedTestCaseVersionId,
      approvedTestCaseId: sample.approvedTestCaseId,
      approvedTestModelVersionId: approvedModelVersionId,
      testConditionId: testCase.primary_test_condition_ref,
      modelElementId: testCase.primary_trace_ref,
      riskIds: testCase.risk_refs,
      aiDimension: sample.aiDimension,
      evaluatorName: testCase.ai_evaluation!.evaluator,
    },
    splits: ["approved", sample.aiDimension],
  });
  });
}

export interface EvaluationSampleSetReadiness {
  ready: boolean;
  totalAiTestCases: number;
  coveredAiTestCases: number;
  approvedSamples: number;
  draftSamples: number;
  rejectedSamples: number;
  missingTestCaseIds: string[];
  blockers: string[];
}

type DatasetSync = (input: {
  endpoint: string;
  name: string;
  description: string;
  examples: ReturnType<typeof buildFrozenExamples>;
}) => Promise<{ datasetId: string; datasetVersionId: string }>;

const syncPhoenixDataset: DatasetSync = async ({ endpoint, name, description, examples }) => {
  const client = createClient({ options: { baseUrl: endpoint } });
  const { datasetId } = await createDataset({ client, name, description, examples });
  const dataset = await getDataset({ client, dataset: { datasetId } });
  return { datasetId, datasetVersionId: dataset.versionId };
};

export class EvaluationSampleService {
  constructor(
    private readonly testDesignStore: TestDesignPostgresStore,
    private readonly aiQualityStore: AiQualityPostgresStore,
    private readonly endpoint = process.env.PHOENIX_ENDPOINT ?? "http://127.0.0.1:6006",
    private readonly syncDataset: DatasetSync = syncPhoenixDataset,
  ) {}

  list(approvedVersionId?: string): Promise<AiEvaluationSampleSetRecord[]> {
    return this.aiQualityStore.listEvaluationSampleSets(approvedVersionId);
  }

  async specification(approvedVersionId: string) {
    const approved = await this.testDesignStore.getApprovedVersionById(approvedVersionId);
    return buildDatasetSpecification(approvedVersionId, approved.snapshot.test_cases);
  }

  async create(input: z.infer<typeof EvaluationSampleSetInputSchema>): Promise<AiEvaluationSampleSetRecord> {
    const approved = await this.testDesignStore.getApprovedVersionById(input.approvedTestCaseVersionId);
    if (!approved.snapshot.test_cases.some((item) => item.ai_evaluation)) {
      throw new Error("所选 Approved TestCase 版本没有 Testing for AI 用例");
    }
    return this.aiQualityStore.createEvaluationSampleSet({ id: randomUUID(), ...input });
  }

  async saveSample(
    sampleSetId: string,
    input: z.infer<typeof EvaluationSamplePayloadSchema>,
    sampleId?: string,
  ): Promise<AiEvaluationSampleRecord> {
    const sampleSet = await this.editableSet(sampleSetId);
    const approved = await this.testDesignStore.getApprovedVersionById(sampleSet.approvedTestCaseVersionId);
    const testCase = approved.snapshot.test_cases.find((item) => item.id === input.approvedTestCaseId && item.ai_evaluation);
    if (!testCase?.ai_evaluation) throw new Error("样本只能关联当前 Approved 版本中的 AI TestCase");
    if (hasPlaceholder(input.input) || hasPlaceholder(input.expected)) {
      throw new Error("样本包含“待配置/TODO”等占位内容，不能保存为真实评测数据");
    }
    const dimension = testCase.ai_evaluation.dimension;
    if (input.metadata.sourceRefs.some((ref) => !testCase.source_refs.includes(ref))) {
      throw new Error("样本来源证据必须属于关联的 Approved TestCase");
    }
    if (input.metadata.evaluationSubject && testCase.ai_evaluation.evaluation_subjects?.length
      && !testCase.ai_evaluation.evaluation_subjects.includes(input.metadata.evaluationSubject)) {
      throw new Error("样本评测对象不属于关联用例的模型范围");
    }
    if (input.metadata.evaluationLayer && testCase.ai_evaluation.evaluation_layers?.length
      && !testCase.ai_evaluation.evaluation_layers.includes(input.metadata.evaluationLayer)) {
      throw new Error("样本证据层不属于关联用例的模型范围");
    }
    if (!input.metadata.evaluationSubject || !input.metadata.evaluationLayer) {
      throw new Error("AI 评测样本必须声明 evaluationSubject 和 evaluationLayer，不能只按最终回复评判");
    }
    if (dimension === "multi_turn_context" && (input.input.conversation?.length ?? 0) < 2) {
      throw new Error("多轮上下文样本至少需要两个 conversation turn");
    }
    if (["tool_selection", "tool_invocation"].includes(dimension)
      && input.metadata.expectedTools.length + input.metadata.forbiddenTools.length === 0) {
      throw new Error("工具类样本必须声明 expectedTools 或 forbiddenTools");
    }
    if (dimension === "robustness_consistency") {
      const metadata = input.metadata;
      if (!metadata.variantGroupId || !metadata.baselineSampleId || !metadata.perturbationFamily
        || !metadata.expectedRelation || !metadata.evaluationSlice) {
        throw new Error("泛化与鲁棒性样本必须声明 variantGroupId、baselineSampleId、perturbationFamily、expectedRelation 和 evaluationSlice");
      }
    }
    const existing = sampleId ? sampleSet.samples.find((item) => item.id === sampleId) : undefined;
    if (sampleId && !existing) throw new Error(`样本 ${sampleId} 不属于当前样本集`);
    return this.aiQualityStore.saveEvaluationSample({
      id: sampleId ?? randomUUID(), sampleSetId, approvedTestCaseId: testCase.id,
      aiDimension: dimension, input: input.input, expected: input.expected,
      metadata: input.metadata, status: "draft", reviewNote: "", reviewedBy: "",
      createdBy: existing?.createdBy ?? input.operator,
    });
  }

  async reviewSample(sampleSetId: string, sampleId: string, input: z.infer<typeof EvaluationSampleReviewSchema>) {
    const sampleSet = await this.editableSet(sampleSetId);
    const sample = sampleSet.samples.find((item) => item.id === sampleId);
    if (!sample) throw new Error(`样本 ${sampleId} 不属于当前样本集`);
    return this.aiQualityStore.saveEvaluationSample({
      id: sample.id, sampleSetId, approvedTestCaseId: sample.approvedTestCaseId,
      aiDimension: sample.aiDimension, input: sample.input, expected: sample.expected,
      metadata: sample.metadata, status: input.status, reviewNote: input.reviewNote,
      reviewedBy: input.reviewedBy, createdBy: sample.createdBy,
    });
  }

  async readiness(sampleSetId: string): Promise<EvaluationSampleSetReadiness> {
    const sampleSet = await this.aiQualityStore.getEvaluationSampleSet(sampleSetId);
    const approved = await this.testDesignStore.getApprovedVersionById(sampleSet.approvedTestCaseVersionId);
    const aiTestCaseIds = approved.snapshot.test_cases.filter((item) => item.ai_evaluation).map((item) => item.id);
    const approvedSamples = sampleSet.samples.filter((item) => item.status === "approved");
    const covered = new Set(approvedSamples.map((item) => item.approvedTestCaseId));
    const missingTestCaseIds = aiTestCaseIds.filter((id) => !covered.has(id));
    const draftSamples = sampleSet.samples.filter((item) => item.status === "draft").length;
    const rejectedSamples = sampleSet.samples.filter((item) => item.status === "rejected").length;
    const blockers: string[] = [];
    if (missingTestCaseIds.length) blockers.push(`${missingTestCaseIds.length} 条 AI TestCase 尚无已接受评测样本`);
    if (draftSamples) blockers.push(`${draftSamples} 条样本尚未完成人工评审`);
    if (!approvedSamples.length) blockers.push("样本集没有已接受的真实评测样本");
    const fingerprints = new Set<string>();
    for (const sample of approvedSamples) {
      const fingerprint = canonical({ testCaseId: sample.approvedTestCaseId, input: sample.input });
      if (fingerprints.has(fingerprint)) blockers.push(`用例 ${sample.approvedTestCaseId} 存在重复输入样本`);
      fingerprints.add(fingerprint);
    }
    return {
      ready: blockers.length === 0, totalAiTestCases: aiTestCaseIds.length,
      coveredAiTestCases: covered.size, approvedSamples: approvedSamples.length,
      draftSamples, rejectedSamples, missingTestCaseIds, blockers,
    };
  }

  async freeze(sampleSetId: string, frozenBy: string): Promise<AiEvaluationSampleSetRecord> {
    const sampleSet = await this.editableSet(sampleSetId);
    const readiness = await this.readiness(sampleSetId);
    if (!readiness.ready) throw new Error(readiness.blockers.join("；"));
    const { modelVersionId, testCases } = await this.approvedLineage(sampleSet);
    const contentSha256 = createHash("sha256").update(canonical(buildFrozenExamples(sampleSet, modelVersionId, testCases))).digest("hex");
    return this.aiQualityStore.freezeEvaluationSampleSet(sampleSetId, contentSha256, frozenBy);
  }

  async export(sampleSetId: string, exportedBy: string): Promise<AiDatasetExportRecord> {
    const sampleSet = await this.aiQualityStore.getEvaluationSampleSet(sampleSetId);
    if (sampleSet.status !== "frozen" || !sampleSet.contentSha256) throw new Error("只有已冻结样本集可以同步 Phoenix");
    const existing = await this.aiQualityStore.findDatasetExport(
      sampleSet.approvedTestCaseVersionId, sampleSet.contentSha256,
    );
    if (existing) return existing;
    const { modelVersionId, testCases } = await this.approvedLineage(sampleSet);
    const examples = buildFrozenExamples(sampleSet, modelVersionId, testCases);
    const datasetName = `testmesh-evaluation-${sampleSet.id}-v${sampleSet.version}`;
    const synced = await this.syncDataset({
      endpoint: this.endpoint, name: datasetName,
      description: `TestMesh 人工审核并冻结的可执行 AI 评测数据集；样本集 ${sampleSet.id}。`, examples,
    });
    return this.aiQualityStore.saveDatasetExport({
      id: randomUUID(), approvedTestCaseVersionId: sampleSet.approvedTestCaseVersionId,
      datasetName, datasetId: synced.datasetId, datasetVersionId: synced.datasetVersionId,
      contentSha256: sampleSet.contentSha256, exampleCount: examples.length,
      aiDimensions: [...new Set(sampleSet.samples.filter((item) => item.status === "approved").map((item) => item.aiDimension))].sort(),
      dataClass: "evaluation-dataset", exportedBy,
    });
  }

  private async editableSet(sampleSetId: string): Promise<AiEvaluationSampleSetRecord> {
    const sampleSet = await this.aiQualityStore.getEvaluationSampleSet(sampleSetId);
    if (sampleSet.status !== "draft") throw new Error("已冻结样本集不可修改；请创建新版本");
    return sampleSet;
  }

  private async approvedLineage(sampleSet: AiEvaluationSampleSetRecord) {
    const approved = await this.testDesignStore.getApprovedVersionById(sampleSet.approvedTestCaseVersionId);
    const design = await this.testDesignStore.getDesign(approved.record.designId);
    if (!design.approvedTestModelVersionId) throw new Error("Approved TestCase 未关联 Approved Test Model");
    return { modelVersionId: design.approvedTestModelVersionId, testCases: approved.snapshot.test_cases };
  }
}
