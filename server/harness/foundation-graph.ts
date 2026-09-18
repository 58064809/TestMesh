import {
  Annotation,
  Command,
  END,
  MemorySaver,
  START,
  StateGraph,
  interrupt,
  type BaseCheckpointSaver,
} from "@langchain/langgraph";

export interface FoundationCandidate {
  artifactId: string;
  evidenceRefs: string[];
  reportedComplete: boolean;
}

export interface FoundationReviewDecision {
  approved: boolean;
  reason: string;
}

export interface FoundationCompletion {
  accepted: boolean;
  reason: string;
}

const FoundationState = Annotation.Root({
  taskId: Annotation<string>(),
  stage: Annotation<"foundation_probe">(),
  candidate: Annotation<FoundationCandidate>(),
  reviewDecision: Annotation<FoundationReviewDecision | null>(),
  status: Annotation<"created" | "waiting_human" | "completed" | "failed">(),
  completion: Annotation<FoundationCompletion | null>(),
});

function prepare(state: typeof FoundationState.State): Partial<typeof FoundationState.State> {
  if (!state.taskId.trim()) throw new Error("Harness taskId 不能为空");
  if (state.stage !== "foundation_probe") throw new Error(`未注册的 Harness 阶段：${state.stage}`);
  if (!state.candidate.artifactId.trim()) throw new Error("候选 Artifact ID 不能为空");
  return { status: "waiting_human" };
}

function waitForHumanReview(state: typeof FoundationState.State): Partial<typeof FoundationState.State> {
  const decision = interrupt<
    { type: "artifact_review"; taskId: string; artifactId: string },
    FoundationReviewDecision
  >({
    type: "artifact_review",
    taskId: state.taskId,
    artifactId: state.candidate.artifactId,
  });
  return { reviewDecision: decision };
}

function verifyCompletion(state: typeof FoundationState.State): Partial<typeof FoundationState.State> {
  if (!state.reviewDecision?.approved) {
    return {
      status: "failed",
      completion: { accepted: false, reason: state.reviewDecision?.reason || "人工评审未批准" },
    };
  }
  if (state.candidate.evidenceRefs.length === 0) {
    return {
      status: "failed",
      completion: { accepted: false, reason: "候选 Artifact 没有证据，不能完成" },
    };
  }
  return {
    status: "completed",
    completion: { accepted: true, reason: "人工评审和确定性证据检查均已通过" },
  };
}

export function createFoundationGraph(checkpointer: BaseCheckpointSaver = new MemorySaver()) {
  return new StateGraph(FoundationState)
    .addNode("prepare", prepare)
    .addNode("wait_for_human_review", waitForHumanReview)
    .addNode("verify_completion", verifyCompletion)
    .addEdge(START, "prepare")
    .addEdge("prepare", "wait_for_human_review")
    .addEdge("wait_for_human_review", "verify_completion")
    .addEdge("verify_completion", END)
    .compile({ checkpointer });
}

export function resumeFoundationReview(decision: FoundationReviewDecision): Command {
  return new Command({ resume: decision });
}
