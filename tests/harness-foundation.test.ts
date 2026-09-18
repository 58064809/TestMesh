import { describe, expect, it } from "vitest";
import { isInterrupted } from "@langchain/langgraph";
import { createFoundationGraph, resumeFoundationReview } from "../server/harness/foundation-graph.js";

const baseInput = {
  taskId: "task-1",
  stage: "foundation_probe" as const,
  candidate: {
    artifactId: "artifact-1",
    evidenceRefs: ["SRC-1"],
    reportedComplete: true,
  },
  reviewDecision: null,
  status: "created" as const,
  completion: null,
};

describe("H00 LangGraph foundation", () => {
  it("pauses for human review and resumes from the same checkpoint", async () => {
    const graph = createFoundationGraph();
    const config = { configurable: { thread_id: "foundation-approved" } };

    const paused = await graph.invoke(baseInput, config);
    expect(isInterrupted(paused)).toBe(true);
    if (!isInterrupted<{ type: string; taskId: string; artifactId: string }>(paused)) return;
    expect(paused.__interrupt__[0].value).toEqual({
      type: "artifact_review",
      taskId: "task-1",
      artifactId: "artifact-1",
    });

    const completed = await graph.invoke(
      resumeFoundationReview({ approved: true, reason: "证据已核对" }),
      config,
    );
    expect(completed.status).toBe("completed");
    expect(completed.completion).toEqual({
      accepted: true,
      reason: "人工评审和确定性证据检查均已通过",
    });
  });

  it("does not accept an agent's completion claim without deterministic evidence", async () => {
    const graph = createFoundationGraph();
    const config = { configurable: { thread_id: "foundation-no-evidence" } };
    await graph.invoke({
      ...baseInput,
      taskId: "task-2",
      candidate: { ...baseInput.candidate, artifactId: "artifact-2", evidenceRefs: [] },
    }, config);

    const result = await graph.invoke(
      resumeFoundationReview({ approved: true, reason: "人工同意" }),
      config,
    );
    expect(result.candidate.reportedComplete).toBe(true);
    expect(result.status).toBe("failed");
    expect(result.completion).toEqual({
      accepted: false,
      reason: "候选 Artifact 没有证据，不能完成",
    });
  });
});
