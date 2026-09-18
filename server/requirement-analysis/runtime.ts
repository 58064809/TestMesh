import { randomUUID } from "node:crypto";
import { isInterrupted } from "@langchain/langgraph";
import type { HarnessPostgresResources } from "../harness/postgres.js";
import { RequirementAnalysisStageProfile } from "../harness/profiles/requirement-analysis.js";
import {
  createOpenAIRequirementAnalysisModel,
  runRequirementAnalysisAgent,
} from "./agent.js";
import { evaluateRequirementAnalysisCompletion } from "./completion-gate.js";
import { MODEL } from "./config.js";
import type { SourceFile } from "./sources.js";
import {
  createRequirementAnalysisWorkflow,
  resumeRequirementAnalysisWithBaseline,
} from "./workflow.js";

export class RequirementAnalysisCompletionError extends Error {}

export class RequirementAnalysisRuntime {
  constructor(private readonly resources: HarnessPostgresResources) {}

  async start(input: {
    message: string;
    sources: SourceFile[];
    apiKey: string;
    requestedBy?: string;
  }) {
    const taskId = randomUUID();
    const runId = randomUUID();
    const threadId = randomUUID();
    let failureStage = "agent";
    await this.resources.runStore.create({
      run_id: runId,
      task_id: taskId,
      stage: "requirement_analysis",
      stage_profile_version: RequirementAnalysisStageProfile.version,
      output_schema_name: RequirementAnalysisStageProfile.output_schema.name,
      output_schema_version: RequirementAnalysisStageProfile.output_schema.version,
      checkpoint_thread_id: threadId,
    });
    await this.resources.runStore.update(runId, { status: "running" });

    try {
      const agentResult = await runRequirementAnalysisAgent({
        taskId,
        message: input.message,
        sources: input.sources,
        model: createOpenAIRequirementAnalysisModel(input.apiKey),
        requestedBy: input.requestedBy,
      });
      failureStage = "completion_gate";
      const task = {
        task_id: taskId,
        stage: "requirement_analysis" as const,
        stage_profile_version: RequirementAnalysisStageProfile.version,
        input_refs: input.sources.map((source) => ({
          slot: "current_sources",
          kind: "source" as const,
          id: source.id,
          required: true,
        })),
        requested_by: input.requestedBy?.trim() || "local-user",
        created_at: new Date().toISOString(),
      };
      const gate = evaluateRequirementAnalysisCompletion({
        task,
        candidate: agentResult.result,
        sources: input.sources,
      });
      if (!gate.report.accepted) {
        throw new RequirementAnalysisCompletionError(gate.report.failed_at);
      }

      failureStage = "business_persistence";
      const analysis = await this.resources.requirementAnalysisStore.saveAnalysis({
        taskId,
        artifactId: gate.artifact.artifact_id,
        document: agentResult.result,
        model: MODEL,
        sources: input.sources,
      });
      failureStage = "review_checkpoint";
      const graph = createRequirementAnalysisWorkflow(this.resources.checkpointer);
      const paused = await graph.invoke({
        taskId,
        analysisId: analysis.id,
        artifactId: gate.artifact.artifact_id,
        completionAccepted: true,
        status: "candidate" as const,
        baselineId: null,
        failureReason: null,
      }, { configurable: { thread_id: threadId } });
      if (!isInterrupted(paused)) {
        throw new Error("需求分析没有停在人工评审恢复点");
      }
      await this.resources.runStore.update(runId, {
        status: "waiting_human",
        artifact_id: gate.artifact.artifact_id,
      });
      return {
        analysisId: analysis.id,
        runId,
        taskId,
        result: agentResult.result,
        usage: agentResult.usage,
        skillActivations: agentResult.skillActivations,
        completion: gate.report,
      };
    } catch (error) {
      await this.resources.runStore.update(runId, {
        status: "failed",
        failure_stage: failureStage,
        failure_reason: error instanceof Error ? error.message : "需求分析运行失败",
      });
      throw error;
    }
  }

  async createBaselineAndResume(analysisId: string, input: {
    prdRevision: string;
    approvedBy: string;
    previousBaselineId: string | null;
    prdFilename: string;
    prdFile: Buffer;
  }) {
    const analysis = await this.resources.requirementAnalysisStore.getAnalysis(analysisId);
    const run = await this.resources.runStore.getByTaskId(analysis.record.taskId);
    if (!run) throw new Error("需求分析运行记录不存在，不能恢复基线工作流");
    const baseline = await this.resources.requirementAnalysisStore.createBaseline(analysisId, input);
    try {
      const graph = createRequirementAnalysisWorkflow(this.resources.checkpointer);
      const completed = await graph.invoke(
        resumeRequirementAnalysisWithBaseline(analysisId, baseline.id),
        { configurable: { thread_id: run.checkpoint_thread_id } },
      );
      if (completed.status !== "completed") {
        throw new Error(completed.failureReason || "需求分析工作流没有完成");
      }
      await this.resources.runStore.update(run.run_id, {
        status: "completed",
        artifact_id: analysis.record.artifactId,
      });
      return baseline;
    } catch (error) {
      await this.resources.runStore.update(run.run_id, {
        status: "failed",
        failure_stage: "baseline_resume",
        failure_reason: error instanceof Error ? error.message : "基线恢复失败",
      });
      throw error;
    }
  }
}
