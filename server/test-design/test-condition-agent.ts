import { randomUUID } from "node:crypto";
import { HumanMessage, isAIMessage } from "@langchain/core/messages";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { traceAgent } from "@arizeai/phoenix-otel";
import { createDeepAgent, registerHarnessProfile, StateBackend } from "deepagents";
import { providerStrategy } from "langchain";
import { z } from "zod";
import { PROMPT_VERSIONS } from "./asset-contracts.js";
import { TEST_CONDITION_INSTRUCTIONS } from "./prompt.js";
import { ModelTestConditionSchema, TestConditionSchema, type BaselineSnapshot, type TestModelDocument } from "./schema.js";
import { validateTestDesignPlan } from "./validation.js";

const ModelTestConditionSetSchema = z.object({ conditions: z.array(ModelTestConditionSchema).min(1) }).strict();

registerHarnessProfile("openai", {
  generalPurposeSubagent: { enabled: false },
  excludedTools: ["ls", "glob", "grep", "write_file", "edit_file", "delete", "execute", "task", "write_todos", "eval"],
  excludedMiddleware: ["SummarizationMiddleware"],
});

async function runTestConditionAgentImpl(input: {
  taskId?: string;
  baselineId: string;
  baseline: BaselineSnapshot;
  approvedModel: TestModelDocument;
  model: BaseChatModel;
  requestedBy?: string;
}) {
  const taskId = input.taskId ?? randomUUID();
  const agent = createDeepAgent({
    model: input.model,
    backend: new StateBackend(),
    tools: [],
    name: "test_condition_builder",
    systemPrompt: TEST_CONDITION_INSTRUCTIONS,
    responseFormat: providerStrategy(ModelTestConditionSetSchema),
  });
  const response = await agent.invoke({
    messages: [new HumanMessage({ content: `根据下面已批准的测试模型，生成独立 TestConditionSet。测试模型中的 test_analysis.test_conditions 只是上一阶段候选，可用于理解但不是批准结果；必须以 behavior_models 中 M-01～M-04、quality_model、ai_model、Risk、TestPoint、覆盖目标和来源证据为正式输入重新核对。M-01 的参数规则、M-02 的决策分支、M-03 的状态迁移和 M-04 的工具成功/无结果/失败路径都必须转化为可独立判定的条件，但不得在本阶段生成 TestCase、Gherkin、Dataset 或执行步骤。所有条件必须使用 TCND-001 起连续编号；每条只允许一个 primary_trace_ref，并保留真实 source_refs。\n\nBaseline ID：${input.baselineId}\n\nApproved TestModel：\n${JSON.stringify(input.approvedModel)}\n\nRequirement Baseline：\n${JSON.stringify(input.baseline)}` })],
  }, {
    configurable: { thread_id: `${taskId}:test-conditions` },
    metadata: { requested_by: input.requestedBy ?? "local-user", "testmesh.stage": "test-condition", "testmesh.prompt.version": PROMPT_VERSIONS.testCondition },
  });
  const parsed = ModelTestConditionSetSchema.parse((response as typeof response & { structuredResponse?: unknown }).structuredResponse);
  const conditions = parsed.conditions.map((item) => TestConditionSchema.parse({ ...item, ai_dimension: item.ai_dimension ?? undefined }));
  validateTestDesignPlan({ ...input.approvedModel.test_analysis, test_conditions: conditions }, input.baseline, new Set(input.approvedModel.knowledge_evidence.map((item) => item.chunk_id)));
  const usage = response.messages.reduce((total, message) => {
    if (!isAIMessage(message) || !message.usage_metadata) return total;
    return {
      inputTokens: total.inputTokens + (message.usage_metadata.input_tokens ?? 0),
      outputTokens: total.outputTokens + (message.usage_metadata.output_tokens ?? 0),
      totalTokens: total.totalTokens + (message.usage_metadata.total_tokens ?? 0),
    };
  }, { inputTokens: 0, outputTokens: 0, totalTokens: 0 });
  return { taskId, conditions, usage };
}

export const runTestConditionAgent = traceAgent(runTestConditionAgentImpl, {
  name: "testmesh.test_condition",
  processInput: (input: Parameters<typeof runTestConditionAgentImpl>[0]) => ({
    "testmesh.task.id": input.taskId ?? "generated",
    "testmesh.baseline.id": input.baselineId,
    "testmesh.prompt.version": PROMPT_VERSIONS.testCondition,
  }),
  processOutput: (output) => ({
    "testmesh.task.id": output.taskId,
    "testmesh.test_condition.count": output.conditions.length,
    "llm.token_count.total": output.usage.totalTokens,
  }),
});

