import { entrypoint, interrupt, type BaseCheckpointSaver } from "@langchain/langgraph";
import type { RequirementAnalysisPostgresStore } from "./postgres-store.js";

// Business review only. Persistence, suspension, replay and errors belong to LangGraph.
export function createRequirementReview(
  checkpointer: BaseCheckpointSaver,
  store: Pick<RequirementAnalysisPostgresStore, "getAnalysis" | "getBaseline">,
) {
  return entrypoint({ name: "requirement_review", checkpointer }, async (analysisId: string) => {
    await store.getAnalysis(analysisId);
    const baselineId = interrupt<string, string>(analysisId);
    const baseline = await store.getBaseline(baselineId);
    if (baseline.record.analysisId !== analysisId) {
      throw new Error("需求基线不属于当前分析，不能完成评审");
    }
    return baseline.record;
  });
}
