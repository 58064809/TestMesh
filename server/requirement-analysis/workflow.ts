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

export interface RequirementBaselineResume {
  analysisId: string;
  baselineId: string;
}

type RequirementAnalysisWorkflowUpdate = {
  taskId?: string;
  analysisId?: string;
  artifactId?: string;
  completionAccepted?: boolean;
  status?: "candidate" | "waiting_human" | "completed" | "failed";
  baselineId?: string | null;
  failureReason?: string | null;
};

type RequirementAnalysisWorkflowNode =
  | "__start__"
  | "prepare"
  | "wait_for_review_and_baseline"
  | "complete";

const RequirementAnalysisWorkflowState = Annotation.Root({
  taskId: Annotation<string>(),
  analysisId: Annotation<string>(),
  artifactId: Annotation<string>(),
  completionAccepted: Annotation<boolean>(),
  status: Annotation<"candidate" | "waiting_human" | "completed" | "failed">(),
  baselineId: Annotation<string | null>(),
  failureReason: Annotation<string | null>(),
});

function prepare(
  state: typeof RequirementAnalysisWorkflowState.State,
): Partial<typeof RequirementAnalysisWorkflowState.State> {
  if (!state.taskId.trim() || !state.analysisId.trim() || !state.artifactId.trim()) {
    throw new Error("需求分析工作流缺少任务、分析或 Artifact 标识");
  }
  if (!state.completionAccepted) {
    return {
      status: "failed",
      failureReason: "候选需求分析没有通过确定性 Completion Gate",
    };
  }
  return { status: "waiting_human", failureReason: null };
}

function waitForBaseline(
  state: typeof RequirementAnalysisWorkflowState.State,
): Partial<typeof RequirementAnalysisWorkflowState.State> {
  if (state.status === "failed") return {};
  const result = interrupt<
    { type: "requirement_analysis_review"; taskId: string; analysisId: string; artifactId: string },
    RequirementBaselineResume
  >({
    type: "requirement_analysis_review",
    taskId: state.taskId,
    analysisId: state.analysisId,
    artifactId: state.artifactId,
  });
  if (result.analysisId !== state.analysisId || !result.baselineId.trim()) {
    throw new Error("恢复信息与当前需求分析不一致");
  }
  return { baselineId: result.baselineId };
}

function complete(
  state: typeof RequirementAnalysisWorkflowState.State,
): Partial<typeof RequirementAnalysisWorkflowState.State> {
  if (state.status === "failed") return {};
  if (!state.baselineId) {
    return { status: "failed", failureReason: "人工评审尚未形成需求基线" };
  }
  return { status: "completed", failureReason: null };
}

export function createRequirementAnalysisWorkflow(
  checkpointer: BaseCheckpointSaver = new MemorySaver(),
) {
  return new StateGraph(RequirementAnalysisWorkflowState)
    .addNode("prepare", prepare)
    .addNode("wait_for_review_and_baseline", waitForBaseline)
    .addNode("complete", complete)
    .addEdge(START, "prepare")
    .addEdge("prepare", "wait_for_review_and_baseline")
    .addEdge("wait_for_review_and_baseline", "complete")
    .addEdge("complete", END)
    .compile({ checkpointer });
}

export function resumeRequirementAnalysisWithBaseline(
  analysisId: string,
  baselineId: string,
): Command<RequirementBaselineResume, RequirementAnalysisWorkflowUpdate, RequirementAnalysisWorkflowNode> {
  return new Command<RequirementBaselineResume, RequirementAnalysisWorkflowUpdate, RequirementAnalysisWorkflowNode>({
    resume: { analysisId, baselineId },
  });
}
