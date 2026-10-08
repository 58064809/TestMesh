import { Command, MemorySaver, isInterrupted } from "@langchain/langgraph";
import { describe, expect, it, vi } from "vitest";
import { createRequirementReview } from "../server/requirement-analysis/review.js";
import type { RequirementAnalysisPostgresStore, RequirementBaselineRecord } from "../server/requirement-analysis/postgres-store.js";

function reviewStore() {
  return {
    getAnalysis: vi.fn<RequirementAnalysisPostgresStore["getAnalysis"]>().mockResolvedValue({} as Awaited<ReturnType<RequirementAnalysisPostgresStore["getAnalysis"]>>),
    getBaseline: vi.fn<RequirementAnalysisPostgresStore["getBaseline"]>().mockImplementation(async (id) => ({
      record: { id, analysisId: id === "wrong" ? "another-analysis" : "analysis-1" } as RequirementBaselineRecord,
      file: Buffer.from("approved PRD"), snapshot: {},
    })),
  };
}

describe("official LangGraph human review", () => {
  it("resumes with a new entrypoint instance and checks the stored baseline", async () => {
    const saver = new MemorySaver();
    const store = reviewStore();
    const config = { configurable: { thread_id: "review-1" } };
    const review = createRequirementReview(saver, store);
    const paused = await review.invoke("analysis-1", config);
    expect(isInterrupted(paused)).toBe(true);
    expect(store.getBaseline).not.toHaveBeenCalled();
    const resumed = createRequirementReview(saver, store);
    const result = await resumed.invoke(new Command({ resume: "baseline-1" }), config);
    expect(result).toMatchObject({ id: "baseline-1", analysisId: "analysis-1" });
    expect((await resumed.getState(config)).next).toEqual([]);
  });

  it("cannot finish with a baseline belonging to another analysis", async () => {
    const review = createRequirementReview(new MemorySaver(), reviewStore());
    const config = { configurable: { thread_id: "review-wrong" } };
    await review.invoke("analysis-1", config);
    await expect(review.invoke(new Command({ resume: "wrong" }), config)).rejects.toThrow("不属于当前分析");
    const state = await review.getState(config);
    expect(state.tasks.some((task) => task.error)).toBe(true);
  });

  it("requires the resumed baseline to actually exist in business storage", async () => {
    const store = reviewStore();
    store.getBaseline.mockRejectedValue(new Error("基线不存在"));
    const review = createRequirementReview(new MemorySaver(), store);
    const config = { configurable: { thread_id: "review-missing" } };
    await review.invoke("analysis-1", config);
    await expect(review.invoke(new Command({ resume: "invented" }), config)).rejects.toThrow("基线不存在");
  });
});
