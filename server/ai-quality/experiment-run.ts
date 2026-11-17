import { randomUUID } from "node:crypto";
import { createClient } from "@arizeai/phoenix-client";
import { asEvaluator, runExperiment } from "@arizeai/phoenix-client/experiments";
import { z } from "zod";
import type { AiQualityPostgresStore, AiExperimentRunRecord } from "./postgres-store.js";
import type { AiExperimentReadinessService } from "./experiment-readiness.js";

export const AiExperimentRunInputSchema = z.object({
  datasetExportId: z.string().trim().min(1),
  requestedBy: z.string().trim().min(1).max(100),
  concurrency: z.number().int().min(1).max(5).default(1),
}).strict();

interface FastApiRun {
  id?: string;
  status?: string;
  items_json?: Array<{ name?: string; status?: string }>;
  items?: Array<{ name?: string; status?: string }>;
  [key: string]: unknown;
}

interface PhoenixRunSummary {
  experimentId: string;
  projectName: string;
  totalRuns: number;
  successfulRuns: number;
  failedRuns: number;
  evaluatorNames: string[];
}

type PhoenixExperimentRunner = (input: {
  endpoint: string;
  datasetId: string;
  datasetVersionId: string;
  experimentName: string;
  concurrency: number;
  metadata: Record<string, unknown>;
  execute: (testCaseId: string, sampleId: string, sampleInput: Record<string, unknown>) => Promise<FastApiRun>;
}) => Promise<PhoenixRunSummary>;

function executionItems(output: FastApiRun | null | undefined) {
  return output?.items_json ?? output?.items ?? [];
}

export function deterministicExecutionEvaluations(output: FastApiRun | null | undefined) {
  const executionPassed = output?.status === "passed";
  const evidence = executionItems(output).find((item) => item.name === "AI 应用证据契约");
  const evidencePassed = evidence?.status === "passed";
  return { executionPassed, evidencePassed };
}

const runWithPhoenix: PhoenixExperimentRunner = async (input) => {
  const client = createClient({ options: { baseUrl: input.endpoint } });
  const experiment = await runExperiment({
    client,
    dataset: { datasetId: input.datasetId, versionId: input.datasetVersionId },
    experimentName: input.experimentName,
    experimentDescription: "TestMesh AIAT03：复用人工批准的 FastAPI YAML 执行目标 AI 应用。语义质量结论由后续 Phoenix Evaluator 阶段形成。",
    experimentMetadata: input.metadata,
    concurrency: input.concurrency,
    useBatchSpanProcessor: false,
    task: async (example): Promise<FastApiRun> => {
      const testCaseId = String(example.metadata?.approvedTestCaseId ?? example.input.testCaseId ?? "");
      if (!testCaseId) throw new Error("Phoenix Example 缺少 approvedTestCaseId");
      if (!example.id || !example.input || typeof example.input !== "object" || Array.isArray(example.input)) {
        throw new Error("Phoenix Example 缺少可执行样本 ID 或输入");
      }
      return input.execute(testCaseId, String(example.id), example.input as Record<string, unknown>);
    },
    evaluators: [
      asEvaluator({
        name: "testmesh-api-yaml-execution",
        kind: "CODE",
        evaluate: ({ output }) => {
          const result = deterministicExecutionEvaluations(output as FastApiRun | undefined);
          return { score: result.executionPassed ? 1 : 0, label: result.executionPassed ? "pass" : "fail", explanation: "FastAPI YAML TestRun 的确定性执行状态。" };
        },
      }),
      asEvaluator({
        name: "testmesh-openinference-evidence-contract",
        kind: "CODE",
        evaluate: ({ output }) => {
          const result = deterministicExecutionEvaluations(output as FastApiRun | undefined);
          return { score: result.evidencePassed ? 1 : 0, label: result.evidencePassed ? "pass" : "fail", explanation: "目标应用会话与 OpenInference Trace 契约检查。" };
        },
      }),
    ],
  });
  return {
    experimentId: experiment.id,
    projectName: experiment.projectName ?? "",
    totalRuns: Object.keys(experiment.runs).length,
    successfulRuns: experiment.successfulRunCount,
    failedRuns: experiment.failedRunCount,
    evaluatorNames: ["testmesh-api-yaml-execution", "testmesh-openinference-evidence-contract"],
  };
};

export class AiExperimentRunService {
  constructor(
    private readonly readinessService: AiExperimentReadinessService,
    private readonly store: AiQualityPostgresStore,
    private readonly phoenixEndpoint = process.env.PHOENIX_ENDPOINT ?? "http://127.0.0.1:6006",
    private readonly fastApiEndpoint = process.env.TESTMESH_FASTAPI_ENDPOINT ?? "http://127.0.0.1:8000",
    private readonly phoenixRunner: PhoenixExperimentRunner = runWithPhoenix,
    private readonly scenarioRunner: (scenarioId: string, sampleId: string, sampleInput: Record<string, unknown>) => Promise<FastApiRun> = async (scenarioId, sampleId, sampleInput) => {
      const response = await fetch(`${this.fastApiEndpoint}/api/api-automation/scenarios/assets/${encodeURIComponent(scenarioId)}/runs`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sample_id: sampleId, input: sampleInput }),
      });
      const body = await response.json() as FastApiRun & { detail?: string };
      if (!response.ok) throw new Error(body.detail ?? `FastAPI YAML 执行失败（HTTP ${response.status}）`);
      return body;
    },
  ) {}

  list(): Promise<AiExperimentRunRecord[]> {
    return this.store.listExperimentRuns();
  }

  async run(input: z.infer<typeof AiExperimentRunInputSchema>): Promise<AiExperimentRunRecord> {
    const readiness = await this.readinessService.inspect(input.datasetExportId);
    if (!readiness.ready) throw new Error(`尚不能启动 Phoenix Experiment：${readiness.blockers.join("；")}`);
    const scenarioByTestCase = new Map<string, string>();
    for (const asset of readiness.assets.filter((item) => item.valid)) {
      for (const testCaseId of asset.approvedTestCaseIds) scenarioByTestCase.set(testCaseId, asset.id);
    }
    const targetVersions = [...new Set(readiness.assets.filter((item) => item.valid).map((item) => `${item.targetId}@${item.targetVersion}`))].sort();
    const summary = await this.phoenixRunner({
      endpoint: this.phoenixEndpoint,
      datasetId: readiness.datasetId,
      datasetVersionId: readiness.datasetVersionId,
      experimentName: `testmesh-ai-${readiness.approvedTestCaseVersionId}-${Date.now()}`,
      concurrency: input.concurrency,
      metadata: {
        approvedTestCaseVersionId: readiness.approvedTestCaseVersionId,
        datasetExportId: readiness.datasetExportId,
        dataClass: "production-candidate",
        targetVersions,
      },
      execute: async (testCaseId, sampleId, sampleInput) => {
        const scenarioId = scenarioByTestCase.get(testCaseId);
        if (!scenarioId) throw new Error(`AI TestCase ${testCaseId} 没有唯一执行场景`);
        return this.scenarioRunner(scenarioId, sampleId, sampleInput);
      },
    });
    return this.store.saveExperimentRun({
      id: randomUUID(),
      datasetExportId: readiness.datasetExportId,
      approvedTestCaseVersionId: readiness.approvedTestCaseVersionId,
      datasetId: readiness.datasetId,
      datasetVersionId: readiness.datasetVersionId,
      experimentId: summary.experimentId,
      projectName: summary.projectName,
      dataClass: "production-candidate",
      status: "execution-only",
      totalRuns: summary.totalRuns,
      successfulRuns: summary.successfulRuns,
      failedRuns: summary.failedRuns,
      evaluatorNames: summary.evaluatorNames,
      targetVersions,
      gateEligible: false,
      requestedBy: input.requestedBy,
    });
  }
}
