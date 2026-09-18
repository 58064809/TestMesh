import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { AIMessage } from "@langchain/core/messages";
import { tool } from "@langchain/core/tools";
import { Annotation, END, isInterrupted, MessagesAnnotation, START, StateGraph } from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { z } from "zod";
import { createFoundationGraph, resumeFoundationReview } from "../server/harness/foundation-graph.js";
import { recordLangGraphTrace } from "../server/harness/observability.js";
import { createHarnessPostgresResources } from "../server/harness/postgres.js";

const suffix = randomUUID();
const runId = `h00-pg-${suffix}`;
const taskId = `h00-task-${suffix}`;
const artifactId = `h00-artifact-${suffix}`;
const threadId = `h00-thread-${suffix}`;
const toolRunId = `h00-tool-${suffix}`;
const failureRunId = `h00-failure-${suffix}`;

let resources = await createHarnessPostgresResources();

try {
  await resources.runStore.create({
    run_id: runId,
    task_id: taskId,
    stage: "requirement_analysis",
    stage_profile_version: "1.0.0",
    output_schema_name: "FoundationProbe",
    output_schema_version: "1.0.0",
    checkpoint_thread_id: threadId,
  });

  const graph = createFoundationGraph(resources.checkpointer);
  const config = { configurable: { thread_id: threadId } };
  const paused = await graph.invoke({
    taskId,
    stage: "foundation_probe",
    candidate: {
      artifactId,
      evidenceRefs: ["SRC-H00"],
      reportedComplete: true,
    },
    reviewDecision: null,
    status: "created",
    completion: null,
  }, config);
  assert.equal(isInterrupted(paused), true);
  await resources.runStore.update(runId, { status: "waiting_human" });
} finally {
  await resources.close();
}

resources = await createHarnessPostgresResources();

try {
  const graph = createFoundationGraph(resources.checkpointer);
  const config = { configurable: { thread_id: threadId } };
  const completed = await graph.invoke(
    resumeFoundationReview({ approved: true, reason: "PostgreSQL 恢复验收" }),
    config,
  );
  assert.equal(completed.status, "completed");
  assert.deepEqual(completed.completion, {
    accepted: true,
    reason: "人工评审和确定性证据检查均已通过",
  });

  await resources.runStore.update(runId, {
    status: "completed",
    artifact_id: artifactId,
  });
  const run = await resources.runStore.get(runId);
  assert.equal(run?.status, "completed");
  assert.equal(run?.artifact_id, artifactId);
  assert.equal(run?.checkpoint_thread_id, threadId);

  await resources.runStore.create({
    run_id: toolRunId,
    task_id: `h00-tool-task-${suffix}`,
    stage: "api_automation",
    stage_profile_version: "1.0.0",
    output_schema_name: "FoundationProbe",
    output_schema_version: "1.0.0",
    checkpoint_thread_id: `h00-tool-thread-${suffix}`,
  });
  const echoTool = tool(async ({ value }) => `echo:${value}`, {
    name: "foundation_echo",
    description: "H00 无模型工具追踪验收",
    schema: z.object({ value: z.string() }),
  });
  const toolGraph = new StateGraph(MessagesAnnotation)
    .addNode("tools", new ToolNode([echoTool]))
    .addEdge(START, "tools")
    .addEdge("tools", END)
    .compile();
  const toolStream = await toolGraph.stream({
    messages: [new AIMessage({
      content: "",
      tool_calls: [{
        name: "foundation_echo",
        args: { value: "ok" },
        id: "foundation-tool-call",
        type: "tool_call",
      }],
    })],
  }, { streamMode: ["tasks", "tools"] });
  await recordLangGraphTrace({ runId: toolRunId, stream: toolStream, runStore: resources.runStore });
  await resources.runStore.update(toolRunId, { status: "completed" });
  const toolEvents = await resources.runStore.listTraceEvents(toolRunId);
  assert.deepEqual(toolEvents.map((event) => `${event.kind}:${event.name}`), [
    "node_started:tools",
    "tool_started:foundation_echo",
    "tool_completed:foundation_echo",
    "node_completed:tools",
  ]);

  await resources.runStore.create({
    run_id: failureRunId,
    task_id: `h00-failure-task-${suffix}`,
    stage: "requirement_analysis",
    stage_profile_version: "1.0.0",
    output_schema_name: "FoundationProbe",
    output_schema_version: "1.0.0",
    checkpoint_thread_id: `h00-failure-thread-${suffix}`,
  });
  const FailureState = Annotation.Root({ value: Annotation<string>() });
  const failureGraph = new StateGraph(FailureState)
    .addNode("planned_failure", () => {
      throw new Error("H00 计划内失败");
    })
    .addEdge(START, "planned_failure")
    .addEdge("planned_failure", END)
    .compile();
  const failureStream = await failureGraph.stream(
    { value: "failure-probe" },
    { streamMode: ["tasks", "tools"] },
  );
  await assert.rejects(
    recordLangGraphTrace({ runId: failureRunId, stream: failureStream, runStore: resources.runStore }),
    /H00 计划内失败/,
  );
  const failureRun = await resources.runStore.get(failureRunId);
  assert.equal(failureRun?.status, "failed");
  assert.equal(failureRun?.failure_stage, "planned_failure");
  const failureEvents = await resources.runStore.listTraceEvents(failureRunId);
  assert.equal(failureEvents.at(-1)?.kind, "run_failed");
  assert.equal(failureEvents.at(-1)?.name, "planned_failure");

  process.stdout.write(`${JSON.stringify({
    ok: true,
    run_id: runId,
    task_id: taskId,
    checkpoint_thread_id: threadId,
    status: run?.status,
    traced_nodes: toolEvents.filter((event) => event.kind.startsWith("node_")).length,
    traced_tools: toolEvents.filter((event) => event.kind.startsWith("tool_")).length,
    failure_stage: failureRun?.failure_stage,
  })}\n`);
} finally {
  await resources.close();
}
