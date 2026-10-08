import { createHash, randomUUID } from "node:crypto";
import { Command, isInterrupted } from "@langchain/langgraph";
import type { AnalysisPostgresResources } from "./postgres.js";
import { createOpenAIRequirementAnalysisModel, runRequirementAnalysisAgent } from "./agent.js";
import { MODEL } from "./config.js";
import type { SourceFile } from "./sources.js";
import { createRequirementReview } from "./review.js";
import { resolvePhoenixTraceUrl } from "../observability/phoenix.js";

export class RequirementAnalysisService {
  constructor(private readonly resources: AnalysisPostgresResources) {}

  async start(input: {
    message: string;
    sources: SourceFile[];
    apiKey: string;
    requestedBy?: string;
  }) {
    const taskId = randomUUID();
    const candidate = await runRequirementAnalysisAgent({
      ...input,
      taskId,
      model: createOpenAIRequirementAnalysisModel(input.apiKey),
      checkpointer: this.resources.checkpointer,
    });
    const analysis = await this.resources.requirementAnalysisStore.saveAnalysis({
      taskId,
      artifactId: randomUUID(),
      document: candidate.result,
      model: MODEL,
      sources: input.sources,
      trace: candidate.observability,
    });
    const review = createRequirementReview(this.resources.checkpointer, this.resources.requirementAnalysisStore);
    const paused = await review.invoke(analysis.id, { configurable: { thread_id: taskId } });
    if (!isInterrupted(paused)) throw new Error("需求分析没有停在人工评审恢复点");
    return {
      ...candidate,
      analysisId: analysis.id,
      observability: candidate.observability ? {
        ...candidate.observability,
        traceUrl: await resolvePhoenixTraceUrl(candidate.observability),
      } : undefined,
    };
  }

  async createBaselineAndResume(analysisId: string, input: {
    prdRevision: string;
    approvedBy: string;
    previousBaselineId: string | null;
    prdFilename: string;
    prdFile: Buffer;
  }) {
    const store = this.resources.requirementAnalysisStore;
    const analysis = await store.getAnalysis(analysisId);
    const config = { configurable: { thread_id: analysis.record.taskId } };
    const review = createRequirementReview(this.resources.checkpointer, store);
    const state = await review.getState(config);
    if (!state.createdAt) {
      throw new Error("缺少官方评审检查点，请先执行 Harness 数据迁移；不会回退到旧 Harness");
    }
    // A persisted baseline is immutable. An identical HTTP retry may finish a
    // previously interrupted checkpoint update without inserting another version.
    const existing = (await store.listBaselines()).find((item) => item.analysisId === analysisId);
    if (existing && (
      existing.prdSha256 !== createHash("sha256").update(input.prdFile).digest("hex") ||
      existing.prdRevision !== input.prdRevision.trim() || existing.approvedBy !== input.approvedBy.trim() ||
      existing.previousBaselineId !== input.previousBaselineId || existing.prdFilename !== input.prdFilename
    )) throw new Error("已有不可覆盖的需求基线，本次提交与原批准内容不一致");
    if (state.next.length === 0) {
      if (!existing) throw new Error("评审检查点已结束，但没有对应的既有基线");
      return existing;
    }
    const baseline = existing ?? await store.createBaseline(analysisId, input);
    const completed = await review.invoke(new Command({ resume: baseline.id }), config);
    if (isInterrupted(completed) || completed.id !== baseline.id) {
      throw new Error("需求基线已保存，但官方评审检查点尚未完成，可重新提交相同批准内容恢复");
    }
    return baseline;
  }
}
