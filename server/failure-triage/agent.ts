import { randomUUID } from "node:crypto";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { HumanMessage, isAIMessage } from "@langchain/core/messages";
import { ChatOpenAI } from "@langchain/openai";
import { traceAgent } from "@arizeai/phoenix-otel";
import { createDeepAgent, registerHarnessProfile } from "deepagents";
import { createMiddleware, providerStrategy } from "langchain";
import { MODEL } from "../requirement-analysis/config.js";
import { currentPhoenixTraceReference, type PhoenixTraceReference } from "../observability/phoenix.js";
import { FAILURE_TRIAGE_INSTRUCTIONS } from "./prompt.js";
import { FailureTriageSchema, type FailureDiagnosisContext, type FailureEvidence, type FailureTriage } from "./schema.js";
import { validateFailureTriage } from "./validation.js";

registerHarnessProfile("openai", {
  generalPurposeSubagent: { enabled: false },
  excludedTools: ["ls", "glob", "grep", "write_file", "edit_file", "delete", "execute", "task", "write_todos", "eval"],
  excludedMiddleware: ["SummarizationMiddleware"],
});

export interface FailureTriageAgentResult {
  taskId: string;
  result: FailureTriage;
  usage: { inputTokens: number; outputTokens: number; totalTokens: number };
  observability?: PhoenixTraceReference;
}

export function createOpenAIFailureTriageModel(apiKey: string): ChatOpenAI {
  return new ChatOpenAI({
    apiKey,
    model: MODEL,
    useResponsesApi: true,
    maxRetries: 0,
    maxTokens: 24_000,
    zdrEnabled: true,
  });
}

async function runFailureTriageAgentImpl(input: {
  taskId?: string;
  context: FailureDiagnosisContext;
  evidence: FailureEvidence[];
  model: BaseChatModel;
  requestedBy?: string;
}): Promise<FailureTriageAgentResult> {
  const taskId = input.taskId ?? randomUUID();
  const observability = currentPhoenixTraceReference();
  const agent = createDeepAgent({
    name: "failure_triage",
    model: input.model,
    tools: [],
    systemPrompt: FAILURE_TRIAGE_INSTRUCTIONS,
    responseFormat: providerStrategy(FailureTriageSchema),
    middleware: [createMiddleware({
      name: "FailureTriageEvidenceValidation",
      afterAgent: (state) => validateFailureTriage(
        FailureTriageSchema.parse((state as typeof state & { structuredResponse?: unknown }).structuredResponse),
        input.evidence,
      ),
    })],
  });
  const response = await agent.invoke({ messages: [new HumanMessage({
    content: `请根据失败 TestRun 的自动化证据进行诊断。预期行为必须来自 Approved TestCase，实际行为必须来自失败断言、HTTP 响应或 UI Runner/Trace。当前尚未接入业务系统 APM、数据库、中间件和源码；没有对应证据就必须明确停止在候选层级。\n\n执行上下文：\n${JSON.stringify(input.context)}\n\n证据：\n${JSON.stringify(input.evidence)}`,
  })] }, { configurable: { thread_id: `${taskId}:failure-triage` }, metadata: { requested_by: input.requestedBy ?? "local-user" } });
  const result = FailureTriageSchema.parse((response as typeof response & { structuredResponse?: unknown }).structuredResponse);
  validateFailureTriage(result, input.evidence);
  const usage = response.messages.reduce((total, message) => {
    if (!isAIMessage(message) || !message.usage_metadata) return total;
    return {
      inputTokens: total.inputTokens + (message.usage_metadata.input_tokens ?? 0),
      outputTokens: total.outputTokens + (message.usage_metadata.output_tokens ?? 0),
      totalTokens: total.totalTokens + (message.usage_metadata.total_tokens ?? 0),
    };
  }, { inputTokens: 0, outputTokens: 0, totalTokens: 0 });
  return { taskId, result, usage, observability };
}

export const runFailureTriageAgent = traceAgent(runFailureTriageAgentImpl, {
  name: "testmesh.failure_triage",
  processInput: (input: Parameters<typeof runFailureTriageAgentImpl>[0]) => ({
    "testmesh.task.id": input.taskId ?? "generated",
    "testmesh.project.id": input.context.projectId,
    "testmesh.environment.id": input.context.environmentId,
    "testmesh.test_run.id": input.context.runId,
    "testmesh.test_run.kind": input.context.runKind,
    "testmesh.evidence.count": input.evidence.length,
  }),
  processOutput: (output) => ({
    "testmesh.task.id": output.taskId,
    "testmesh.failure_triage.status": output.result.status,
    "testmesh.failure_triage.layer": output.result.failure_layer,
    "llm.token_count.total": output.usage.totalTokens,
  }),
});
