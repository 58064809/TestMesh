import { createHash, randomUUID } from "node:crypto";
import { createClient } from "@arizeai/phoenix-client";
import { createDataset, getDataset } from "@arizeai/phoenix-client/datasets";
import { z } from "zod";
import type { AiQualityPostgresStore, AiDatasetExportRecord } from "./postgres-store.js";
import type { TestDesignPostgresStore } from "../test-design/postgres-store.js";
import type { TestCaseSchema } from "../test-design/schema.js";

type TestCase = z.infer<typeof TestCaseSchema>;

export const AiDatasetExportInputSchema = z.object({
  approvedTestCaseVersionId: z.string().trim().min(1),
  exportedBy: z.string().trim().min(1).max(100),
}).strict();

export interface AiDatasetPreview {
  approvedTestCaseVersionId: string;
  approvedVersion: number;
  datasetName: string;
  contentSha256: string;
  exampleCount: number;
  aiDimensions: string[];
  evaluatorNames: string[];
  dataClass: "test-plan-manifest";
  examples: Array<{
    id: string;
    title: string;
    dimension: string;
    oracleType: string;
    evaluator: string;
    threshold: string;
  }>;
}

type PhoenixExample = ReturnType<typeof phoenixExample>;
type DatasetSync = (input: {
  endpoint: string;
  name: string;
  description: string;
  examples: PhoenixExample[];
}) => Promise<{ datasetId: string; datasetVersionId: string }>;

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function phoenixExample(item: TestCase, approvedVersionId: string) {
  const evaluation = item.ai_evaluation!;
  return {
    id: `${approvedVersionId}:${item.id}`,
    input: {
      testCaseId: item.id,
      title: item.title,
      objective: item.objective,
      preconditions: item.preconditions,
      testData: item.test_data ?? [],
      steps: item.steps ?? [],
      gherkin: item.gherkin,
    },
    output: {
      expectedBehavior: evaluation.expected_behavior,
      oracleType: evaluation.oracle_type,
      threshold: evaluation.threshold,
      parameterExtraction: evaluation.parameter_extraction ?? null,
    },
    metadata: {
      approvedTestCaseVersionId: approvedVersionId,
      approvedTestCaseId: item.id,
      aiDimension: evaluation.dimension,
      evaluator: evaluation.evaluator,
      dataClass: "test-plan-manifest",
      priority: item.priority,
      traceRefs: item.trace_refs,
      sourceRefs: item.source_refs,
      datasetRequirements: evaluation.dataset_requirements,
      evidenceRequirements: evaluation.evidence_requirements,
    },
    splits: ["approved", evaluation.dimension, item.priority],
  };
}

export function buildAiDatasetPreview(input: {
  approvedVersionId: string;
  approvedVersion: number;
  testCases: TestCase[];
}): { preview: AiDatasetPreview; examples: PhoenixExample[] } {
  const aiCases = input.testCases.filter((item) => item.ai_evaluation);
  if (!aiCases.length) throw new Error("所选 Approved TestCase 版本没有 Testing for AI 用例");
  const examples = aiCases.map((item) => phoenixExample(item, input.approvedVersionId));
  const contentSha256 = createHash("sha256").update(canonical(examples)).digest("hex");
  return {
    preview: {
      approvedTestCaseVersionId: input.approvedVersionId,
      approvedVersion: input.approvedVersion,
      datasetName: `testmesh-approved-ai-${input.approvedVersionId}`,
      contentSha256,
      exampleCount: examples.length,
      aiDimensions: [...new Set(aiCases.map((item) => item.ai_evaluation!.dimension))].sort(),
      evaluatorNames: [...new Set(aiCases.map((item) => item.ai_evaluation!.evaluator))].sort(),
      dataClass: "test-plan-manifest",
      examples: aiCases.map((item) => ({
        id: item.id,
        title: item.title,
        dimension: item.ai_evaluation!.dimension,
        oracleType: item.ai_evaluation!.oracle_type,
        evaluator: item.ai_evaluation!.evaluator,
        threshold: item.ai_evaluation!.threshold,
      })),
    },
    examples,
  };
}

const syncPhoenixDataset: DatasetSync = async ({ endpoint, name, description, examples }) => {
  const client = createClient({ options: { baseUrl: endpoint } });
  const { datasetId } = await createDataset({ client, name, description, examples });
  const dataset = await getDataset({ client, dataset: { datasetId } });
  return { datasetId, datasetVersionId: dataset.versionId };
};

export class AiDatasetExportService {
  constructor(
    private readonly testDesignStore: TestDesignPostgresStore,
    private readonly aiQualityStore: AiQualityPostgresStore,
    private readonly endpoint = process.env.PHOENIX_ENDPOINT ?? "http://127.0.0.1:6006",
    private readonly syncDataset: DatasetSync = syncPhoenixDataset,
  ) {}

  async preview(approvedVersionId: string): Promise<AiDatasetPreview> {
    const approved = await this.testDesignStore.getApprovedVersionById(approvedVersionId);
    return buildAiDatasetPreview({
      approvedVersionId,
      approvedVersion: approved.record.version,
      testCases: approved.snapshot.test_cases,
    }).preview;
  }

  async export(approvedVersionId: string, exportedBy: string): Promise<AiDatasetExportRecord> {
    const approved = await this.testDesignStore.getApprovedVersionById(approvedVersionId);
    const { preview, examples } = buildAiDatasetPreview({
      approvedVersionId,
      approvedVersion: approved.record.version,
      testCases: approved.snapshot.test_cases,
    });
    const existing = await this.aiQualityStore.findDatasetExport(approvedVersionId, preview.contentSha256);
    if (existing) return existing;
    const { datasetId, datasetVersionId } = await this.syncDataset({
      endpoint: this.endpoint,
      name: preview.datasetName,
      description: `TestMesh Approved TestCase v${preview.approvedVersion} 的 Testing for AI 冻结快照。TestMesh 仅保存业务回链，Phoenix 为 Dataset 唯一事实来源。`,
      examples,
    });
    return this.aiQualityStore.saveDatasetExport({
      id: randomUUID(),
      approvedTestCaseVersionId: approvedVersionId,
      datasetName: preview.datasetName,
      datasetId,
      datasetVersionId,
      contentSha256: preview.contentSha256,
      exampleCount: preview.exampleCount,
      aiDimensions: preview.aiDimensions,
      dataClass: "test-plan-manifest",
      exportedBy,
    });
  }

  list(): Promise<AiDatasetExportRecord[]> {
    return this.aiQualityStore.listDatasetExports();
  }
}
