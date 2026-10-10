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
const TEST_DESIGN_MAX_OUTPUT_TOKENS = 60_000;

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
    maxTokens: Math.max(MAX_OUTPUT_TOKENS, TEST_DESIGN_MAX_OUTPUT_TOKENS),
    zdrEnabled: true,
  });
}

async function runTestDesignAgentImpl(input: {
  taskId?: string;
  baselineId: string;
  baseline: BaselineSnapshot;
  prdMarkdown: string;
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
      content: `请基于“获批原始 PRD 全文 + 不可覆盖需求基线”完成专业测试分析与用例设计。基线 ID：${input.baselineId}\n\n必须逐项覆盖的基线 ID（每项都必须同时出现在至少一个 TestPoint 和 TestCase 中，或进入 coverage_exclusions 并说明不可测试理由；每个未排除 ID 还必须至少成为一条原子 TestCase 的 primary_trace_ref）：\n${requiredCoverage.join("、")}\n\n先从 PRD 全文识别业务模块、端到端流程、角色、规则、状态、数据、外部依赖与交互，再以批准基线限定可采信结论。PRD 与基线冲突时只能使用基线中的人工决策，不得恢复被驳回内容。提交结构化结果前逐项核对覆盖项、技法覆盖项、测试数据、步骤与预期结果。\n\n获批原始 PRD（Docling Markdown）：\n${input.prdMarkdown}\n\n批准基线 JSON：\n${JSON.stringify(input.baseline)}`,
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
    "testmesh.prd.markdown_chars": input.prdMarkdown.length,
  }),
  processOutput: (output) => ({
    "testmesh.task.id": output.taskId,
    "testmesh.risk.count": output.result.risks.length,
    "testmesh.test_point.count": output.result.test_points.length,
    "testmesh.test_case.count": output.result.test_cases.length,
    "llm.token_count.total": output.usage.totalTokens,
  }),
});
