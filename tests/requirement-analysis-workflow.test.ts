import { isInterrupted } from "@langchain/langgraph";
import { describe, expect, it } from "vitest";
import {
  createRequirementAnalysisWorkflow,
  resumeRequirementAnalysisWithBaseline,
} from "../server/requirement-analysis/workflow.js";

const input = {
  taskId: "task-ra-1",
  analysisId: "analysis-ra-1",
  artifactId: "artifact-ra-1",
  completionAccepted: true,
  status: "candidate" as const,
  baselineId: null,
  failureReason: null,
};

describe("RA01 review and baseline workflow", () => {
  it("pauses with identifiers only and completes after a persisted baseline resumes it", async () => {
    const graph = createRequirementAnalysisWorkflow();
    const config = { configurable: { thread_id: "ra-review-resume" } };

    const paused = await graph.invoke(input, config);
    expect(isInterrupted(paused)).toBe(true);
    if (!isInterrupted<{ type: string; taskId: string; analysisId: string; artifactId: string }>(paused)) return;
    expect(paused.__interrupt__[0].value).toEqual({
      type: "requirement_analysis_review",
      taskId: "task-ra-1",
      analysisId: "analysis-ra-1",
      artifactId: "artifact-ra-1",
    });
    expect(JSON.stringify(paused)).not.toContain("file_bytes");

    const completed = await graph.invoke(
      resumeRequirementAnalysisWithBaseline("analysis-ra-1", "baseline-ra-1"),
      config,
    );
    expect(completed.status).toBe("completed");
    expect(completed.baselineId).toBe("baseline-ra-1");
  });

  it("does not pause or complete when the deterministic candidate gate failed", async () => {
    const graph = createRequirementAnalysisWorkflow();
    const result = await graph.invoke({
      ...input,
      taskId: "task-ra-failed",
      analysisId: "analysis-ra-failed",
      artifactId: "artifact-ra-failed",
      completionAccepted: false,
    }, { configurable: { thread_id: "ra-gate-failed" } });

    expect(isInterrupted(result)).toBe(false);
    expect(result.status).toBe("failed");
    expect(result.failureReason).toContain("Completion Gate");
  });
});
