import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { HumanMessage, isAIMessage } from "@langchain/core/messages";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { ChatOpenAI } from "@langchain/openai";
import { traceAgent } from "@arizeai/phoenix-otel";
import { CompositeBackend, createDeepAgent, FilesystemBackend, registerHarnessProfile, StateBackend } from "deepagents";
import { createMiddleware, MiddlewareError, providerStrategy } from "langchain";
import { MAX_OUTPUT_TOKENS, MODEL } from "../requirement-analysis/config.js";
import { currentPhoenixTraceReference, type PhoenixTraceReference } from "../observability/phoenix.js";
import { TEST_DESIGN_INSTRUCTIONS } from "./prompt.js";
import { createModelTestDesignSchema, type BaselineSnapshot, type TestDesign } from "./schema.js";
import { selectTestDesignSkills, type TestDesignSkillDecision } from "./skill-selection.js";
import { validateTestDesign } from "./validation.js";

const SKILL_ROOT = fileURLToPath(new URL("./skills/", import.meta.url));

registerHarnessProfile("openai", {
  generalPurposeSubagent: { enabled: false },
  excludedTools: ["ls", "glob", "grep", "write_file", "edit_file", "delete", "execute", "task", "write_todos", "eval"],
  excludedMiddleware: ["SummarizationMiddleware"],
});

export interface TestDesignAgentResult {
  taskId: string;
  result: TestDesign;
  usage: { inputTokens: number; outputTokens: number; totalTokens: number };
  skillActivations: TestDesignSkillDecision[];
  observability?: PhoenixTraceReference;
}

export function createOpenAITestDesignModel(apiKey: string): ChatOpenAI {
  return new ChatOpenAI({
    apiKey,
    model: MODEL,
    useResponsesApi: true,
    maxRetries: 0,
    maxTokens: MAX_OUTPUT_TOKENS,
    zdrEnabled: true,
  });
}

async function runTestDesignAgentImpl(input: {
  taskId?: string;
  baselineId: string;
  baseline: BaselineSnapshot;
  model: BaseChatModel;
  requestedBy?: string;
}): Promise<TestDesignAgentResult> {
  const taskId = input.taskId ?? randomUUID();
  const observability = currentPhoenixTraceReference();
  const requiredCoverage = input.baseline.accepted
    .filter((entry) => ["requirements", "business_rules", "flows", "states", "constraints", "exceptions", "open_questions"].includes(entry.section))
    .map((entry) => entry.item.id);
  const responseSchema = createModelTestDesignSchema(requiredCoverage);
  const skillActivations = selectTestDesignSkills(input.baseline);
  const skills = skillActivations.filter((item) => item.applicable).map((item) => `/skills/${item.skill_id}/`);
  const agent = createDeepAgent({
    name: "test_design",
    model: input.model,
    backend: new CompositeBackend(new StateBackend(), {
      "/skills/": new FilesystemBackend({ rootDir: SKILL_ROOT, virtualMode: true }),
    }),
    skills,
    permissions: [
      { operations: ["read"], paths: skills.map((skill) => `${skill}**`) },
      { operations: ["read", "write"], paths: ["/**"], mode: "deny" },
    ],
    tools: [],
    systemPrompt: TEST_DESIGN_INSTRUCTIONS,
    responseFormat: providerStrategy(responseSchema),
    middleware: [createMiddleware({
      name: "TestDesignTraceabilityValidation",
      afterAgent: (state) => {
        const candidate = responseSchema.parse(
          (state as typeof state & { structuredResponse?: unknown }).structuredResponse,
        );
        validateTestDesign(candidate, input.baseline);
      },
    })],
  });
  const response = await agent.invoke({
    messages: [new HumanMessage({
      content: `请基于以下不可覆盖的需求基线设计测试。基线 ID：${input.baselineId}\n\n必须逐项覆盖的基线 ID（每项都必须同时出现在至少一个 TestPoint 和 TestCase 中，或进入 coverage_exclusions 并说明不可测试理由）：\n${requiredCoverage.join("、")}\n\n提交结构化结果前，请逐项核对上述清单，不得遗漏。\n\n基线 JSON：\n${JSON.stringify(input.baseline)}`,
    })],
  }, { configurable: { thread_id: `${taskId}:test-design` }, metadata: { requested_by: input.requestedBy ?? "local-user" } }).catch((error: unknown) => {
    let cause = error;
    while (cause instanceof MiddlewareError && cause.cause) cause = cause.cause;
    throw cause;
  });
  const result = responseSchema.parse(
    (response as typeof response & { structuredResponse?: unknown }).structuredResponse,
  );
  validateTestDesign(result, input.baseline);
  const usage = response.messages.reduce((total, message) => {
    if (!isAIMessage(message) || !message.usage_metadata) return total;
    return {
      inputTokens: total.inputTokens + (message.usage_metadata.input_tokens ?? 0),
      outputTokens: total.outputTokens + (message.usage_metadata.output_tokens ?? 0),
      totalTokens: total.totalTokens + (message.usage_metadata.total_tokens ?? 0),
    };
  }, { inputTokens: 0, outputTokens: 0, totalTokens: 0 });
  return { taskId, result, usage, skillActivations, observability };
}

export const runTestDesignAgent = traceAgent(runTestDesignAgentImpl, {
  name: "testmesh.test_design",
  processInput: (input: Parameters<typeof runTestDesignAgentImpl>[0]) => ({
    "testmesh.task.id": input.taskId ?? "generated",
    "testmesh.baseline.id": input.baselineId,
    "testmesh.baseline.accepted_count": input.baseline.accepted.length,
  }),
  processOutput: (output) => ({
    "testmesh.task.id": output.taskId,
    "testmesh.risk.count": output.result.risks.length,
    "testmesh.test_point.count": output.result.test_points.length,
    "testmesh.test_case.count": output.result.test_cases.length,
    "llm.token_count.total": output.usage.totalTokens,
  }),
});
