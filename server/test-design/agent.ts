import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { HumanMessage, isAIMessage } from "@langchain/core/messages";
import type { BaseMessage } from "@langchain/core/messages";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { ChatOpenAI } from "@langchain/openai";
import { traceAgent } from "@arizeai/phoenix-otel";
import { CompositeBackend, createDeepAgent, FilesystemBackend, registerHarnessProfile, StateBackend } from "deepagents";
import { createMiddleware, MiddlewareError, providerStrategy } from "langchain";
import { MAX_OUTPUT_TOKENS, MODEL } from "../requirement-analysis/config.js";
import { currentPhoenixTraceReference, type PhoenixTraceReference } from "../observability/phoenix.js";
import { TEST_DESIGN_INSTRUCTIONS } from "./prompt.js";
import {
  createTestCaseBatchSchema,
  TestDesignPlanSchema,
  TestDesignSchema,
  type BaselineSnapshot,
  type TestCase,
  type TestDesign,
} from "./schema.js";
import { selectTestDesignSkills, type TestDesignSkillDecision } from "./skill-selection.js";
import { validateTestDesign, validateTestDesignPlan } from "./validation.js";

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
  const skillActivations = selectTestDesignSkills(input.baseline);
  const skills = skillActivations.filter((item) => item.applicable).map((item) => `/skills/${item.skill_id}/`);
  const common = {
    model: input.model,
    backend: new CompositeBackend(new StateBackend(), {
      "/skills/": new FilesystemBackend({ rootDir: SKILL_ROOT, virtualMode: true }),
    }),
    skills,
    permissions: [
      { operations: ["read" as const], paths: skills.map((skill) => `${skill}**`) },
      { operations: ["read" as const, "write" as const], paths: ["/**"], mode: "deny" as const },
    ],
    tools: [],
    systemPrompt: TEST_DESIGN_INSTRUCTIONS,
  };
  const planAgent = createDeepAgent({
    ...common,
    name: "test_design_planner",
    responseFormat: providerStrategy(TestDesignPlanSchema),
    middleware: [createMiddleware({
      name: "TestConditionPlanValidation",
      afterAgent: (state) => validateTestDesignPlan(TestDesignPlanSchema.parse(
        (state as typeof state & { structuredResponse?: unknown }).structuredResponse,
      ), input.baseline),
    })],
  });
  const planResponse = await invokeAgent(planAgent, {
    messages: [new HumanMessage({
      content: `第一阶段只完成专业测试分析与 TestCondition 规划，不生成 TestCase。基线 ID：${input.baselineId}\n\n必须规划的基线 ID：\n${requiredCoverage.join("、")}\n\n每个未排除 ID 至少拆成正常/有效与反向/异常两个不同条件，存在更多业务分支时继续增加。先完整阅读 PRD，识别模块、流程、角色、规则、状态、数据、外部依赖和失败后果，再以批准基线限定结论。\n\n获批原始 PRD（Docling Markdown）：\n${input.prdMarkdown}\n\n批准基线 JSON：\n${JSON.stringify(input.baseline)}`,
    })],
  }, taskId, "plan", input.requestedBy);
  const plan = TestDesignPlanSchema.parse(planResponse.structuredResponse);
  validateTestDesignPlan(plan, input.baseline);

  const obligations = plan.test_conditions.map((condition, index) => ({
    condition,
    conditionId: condition.id,
    caseId: `TC-${String(index + 1).padStart(3, "0")}`,
    traceRef: condition.primary_trace_ref,
  }));
  const testCases: TestCase[] = [];
  const responses = [planResponse];
  for (let offset = 0; offset < obligations.length; offset += 12) {
    const batch = obligations.slice(offset, offset + 12);
    const batchSchema = createTestCaseBatchSchema(batch);
    const batchAgent = createDeepAgent({
      ...common,
      name: `test_case_batch_${Math.floor(offset / 12) + 1}`,
      responseFormat: providerStrategy(batchSchema),
    });
    const sourceIds = new Set(batch.flatMap(({ condition }) => condition.source_refs));
    const evidence = input.baseline.sourceRefs.filter((source) => sourceIds.has(source.id));
    const traceIds = new Set(batch.map(({ condition }) => condition.primary_trace_ref));
    const accepted = input.baseline.accepted.filter((entry) => traceIds.has(entry.item.id));
    const batchResponse = await invokeAgent(batchAgent, {
      messages: [new HumanMessage({
        content: `第二阶段只为下面固定 TestCondition 逐一生成原子 TestCase。cases 对象的每个固定键都必须返回，键 ${batch.map(({ conditionId }) => conditionId).join("、")} 不得省略；TestCase ID 和 primary_test_condition_ref 已由 Schema 固定。每条只写一个可独立判定的中文 Gherkin 场景。\n\n固定任务：\n${JSON.stringify(batch.map(({ condition, caseId }) => ({ caseId, condition })))}\n\n相关 TestPoint：\n${JSON.stringify(plan.test_points.filter((point) => point.trace_refs.some((id) => traceIds.has(id))))}\n\n相关 Risk：\n${JSON.stringify(plan.risks.filter((risk) => risk.trace_refs.some((id) => traceIds.has(id))))}\n\n相关批准基线：\n${JSON.stringify(accepted)}\n\n相关原文证据：\n${JSON.stringify(evidence)}`,
      })],
    }, taskId, `cases-${Math.floor(offset / 12) + 1}`, input.requestedBy);
    responses.push(batchResponse);
    const parsedBatch = batchSchema.parse(batchResponse.structuredResponse);
    testCases.push(...batch.map(({ conditionId }) => parsedBatch.cases[conditionId]));
  }

  const exclusions = new Map(plan.coverage_exclusions.map((item) => [item.trace_ref, item.reason]));
  const result = TestDesignSchema.parse({
    ...plan,
    test_cases: testCases,
    coverage: Object.fromEntries(requiredCoverage.map((id) => [id, {
      test_point_refs: plan.test_points.filter((point) => point.trace_refs.includes(id)).map((point) => point.id),
      test_case_refs: testCases.filter((testCase) => testCase.trace_refs.includes(id)).map((testCase) => testCase.id),
      exclusion_reason: exclusions.get(id) ?? "",
    }])),
  });
  validateTestDesign(result, input.baseline);
  const usage = responses.flatMap((response) => response.messages).reduce((total, message) => {
    if (!isAIMessage(message) || !message.usage_metadata) return total;
    return {
      inputTokens: total.inputTokens + (message.usage_metadata.input_tokens ?? 0),
      outputTokens: total.outputTokens + (message.usage_metadata.output_tokens ?? 0),
      totalTokens: total.totalTokens + (message.usage_metadata.total_tokens ?? 0),
    };
  }, { inputTokens: 0, outputTokens: 0, totalTokens: 0 });
  return { taskId, result, usage, skillActivations, observability };
}

async function invokeAgent(
  agent: ReturnType<typeof createDeepAgent>,
  input: { messages: HumanMessage[] },
  taskId: string,
  stage: string,
  requestedBy?: string,
) {
  return agent.invoke(input, {
    configurable: { thread_id: `${taskId}:test-design:${stage}` },
    metadata: { requested_by: requestedBy ?? "local-user", "testmesh.stage": stage },
  }).then((response: { messages: BaseMessage[]; structuredResponse?: unknown }) => ({
    messages: response.messages,
    structuredResponse: (response as typeof response & { structuredResponse?: unknown }).structuredResponse,
  })).catch((error: unknown) => {
    let cause = error;
    while (cause instanceof MiddlewareError && cause.cause) cause = cause.cause;
    throw cause;
  });
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
