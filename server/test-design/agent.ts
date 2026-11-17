import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { HumanMessage, isAIMessage } from "@langchain/core/messages";
import type { BaseMessage } from "@langchain/core/messages";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { ChatOpenAI } from "@langchain/openai";
import { traceAgent } from "@arizeai/phoenix-otel";
import { CompositeBackend, createDeepAgent, FilesystemBackend, registerHarnessProfile, StateBackend } from "deepagents";
import { MiddlewareError, providerStrategy } from "langchain";
import { MAX_OUTPUT_TOKENS, MODEL } from "../requirement-analysis/config.js";
import { currentPhoenixTraceReference, type PhoenixTraceReference } from "../observability/phoenix.js";
import { TEST_CASE_INSTRUCTIONS } from "./prompt.js";
import { PROMPT_VERSIONS } from "./asset-contracts.js";
import { normalizeChineseGherkin, validateChineseGherkin } from "./gherkin.js";
import {
  createTestCaseBatchSchema,
  TestDesignSchema,
  type BaselineSnapshot,
  type TestCase,
  type TestDesign,
  type TestModelDocument,
} from "./schema.js";
import { selectTestDesignSkills, type TestDesignSkillDecision } from "./skill-selection.js";
import { validateTestDesign, validateTestModel } from "./validation.js";
import type { KnowledgeSearchHit } from "../knowledge/qdrant.js";

const SKILL_ROOT = fileURLToPath(new URL("./skills/", import.meta.url));
const TEST_DESIGN_MAX_OUTPUT_TOKENS = 60_000;
const TEST_CASE_BATCH_MAX_ATTEMPTS = 3;

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
  const timeout = Number(process.env.OPENAI_REQUEST_TIMEOUT_MS ?? 900_000);
  if (!Number.isFinite(timeout) || timeout <= 0) throw new Error("OPENAI_REQUEST_TIMEOUT_MS 必须是正数");
  return new ChatOpenAI({
    apiKey,
    model: MODEL,
    useResponsesApi: true,
    maxRetries: 0,
    maxTokens: Math.max(MAX_OUTPUT_TOKENS, TEST_DESIGN_MAX_OUTPUT_TOKENS),
    timeout,
    zdrEnabled: true,
  });
}

async function runTestDesignAgentImpl(input: {
  taskId?: string;
  baselineId: string;
  baseline: BaselineSnapshot;
  prdMarkdown: string;
  model: BaseChatModel;
  approvedModel: TestModelDocument;
  requestedBy?: string;
}): Promise<TestDesignAgentResult> {
  const taskId = input.taskId ?? randomUUID();
  const observability = currentPhoenixTraceReference();
  const requiredCoverage = input.baseline.accepted
    .filter((entry) => ["requirements", "business_rules", "flows", "states", "constraints", "exceptions", "open_questions"].includes(entry.section))
    .map((entry) => entry.item.id);
  const skillActivations = selectTestDesignSkills(input.baseline);
  const skills = skillActivations.filter((item) => item.applicable).map((item) => `/skills/${item.skill_id}/`);
  validateTestModel(input.approvedModel, input.baseline);
  const plan = input.approvedModel.test_analysis;
  const retrievedKnowledge = new Map<string, KnowledgeSearchHit>(input.approvedModel.knowledge_evidence.map((item) => [item.chunk_id, {
    id: item.chunk_id,
    score: item.score,
    documentId: item.document_id,
    filename: item.filename,
    chunkId: item.chunk_id,
    text: item.text,
    headings: item.headings,
    pageNumbers: item.page_numbers,
    docItems: item.doc_items,
  }]));
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
    systemPrompt: TEST_CASE_INSTRUCTIONS,
  };
  const allowedKnowledgeRefs = new Set(retrievedKnowledge.keys());

  const obligations = plan.test_conditions.map((condition, index) => ({
    condition,
    conditionId: condition.id,
    caseId: `TC-${String(index + 1).padStart(3, "0")}`,
    traceRef: condition.primary_trace_ref,
    aiDimension: condition.ai_dimension,
  }));
  const testCases: TestCase[] = [];
  const responses: Array<{ messages: BaseMessage[]; structuredResponse?: unknown }> = [];
  for (let offset = 0; offset < obligations.length; offset += 12) {
    const batch = obligations.slice(offset, offset + 12);
    const batchSchema = createTestCaseBatchSchema(batch);
    const batchAgent = createDeepAgent({
      ...common,
      tools: [],
      name: `test_case_batch_${Math.floor(offset / 12) + 1}`,
      responseFormat: providerStrategy(batchSchema),
    });
    const sourceIds = new Set(batch.flatMap(({ condition }) => condition.source_refs));
    const evidence = input.baseline.sourceRefs.filter((source) => sourceIds.has(source.id));
    const traceIds = new Set(batch.map(({ condition }) => condition.primary_trace_ref));
    const accepted = input.baseline.accepted.filter((entry) => traceIds.has(entry.item.id));
    const batchPrompt = `第二阶段只为下面固定 TestCondition 逐一生成原子 TestCase。cases 对象的每个固定键都必须返回，键 ${batch.map(({ conditionId }) => conditionId).join("、")} 不得省略；TestCase ID 和 primary_test_condition_ref 已由 Schema 固定。每条只写一个可独立判定的中文 Gherkin 场景。knowledge_refs 只能从对应 TestCondition 的 knowledge_refs 中选择。AI 条件必须使用 ai_behavior / ai_evaluation，并填写可执行的 oracle、Evaluator、阈值、Dataset 样本要求和 Phoenix 执行证据；parameter_extraction 条件必须填写字段级协议，其他 AI 维度的 parameter_extraction 必须为 null；普通业务条件的 ai_evaluation 必须为 null。Gherkin 中每一行前置条件、动作或结果都必须以 Cucumber zh-CN 的合法步骤关键字开头，不能夹带自由文本行。\n\n固定任务：\n${JSON.stringify(batch.map(({ condition, caseId }) => ({ caseId, condition })))}\n\n参数提取覆盖计划：\n${JSON.stringify(plan.parameter_extraction_assessment ?? null)}\n\n相关 TestPoint：\n${JSON.stringify(plan.test_points.filter((point) => point.trace_refs.some((id) => traceIds.has(id))))}\n\n相关 Risk：\n${JSON.stringify(plan.risks.filter((risk) => risk.trace_refs.some((id) => traceIds.has(id))))}\n\n相关批准基线：\n${JSON.stringify(accepted)}\n\n相关原文证据：\n${JSON.stringify(evidence)}\n\n已检索且允许引用的知识片段：\n${JSON.stringify([...retrievedKnowledge.values()].filter((hit) => batch.some(({ condition }) => condition.knowledge_refs.includes(hit.chunkId))).map((hit) => ({ chunk_id: hit.chunkId, filename: hit.filename, headings: hit.headings, page_numbers: hit.pageNumbers, text: hit.text })))}`;
    let normalizedCases: TestCase[] | undefined;
    let correction = "";
    let lastValidationError: unknown;
    for (let attempt = 1; attempt <= TEST_CASE_BATCH_MAX_ATTEMPTS; attempt += 1) {
      const batchResponse = await invokeAgent(batchAgent, {
        messages: [new HumanMessage({ content: `${batchPrompt}${correction}` })],
      }, taskId, `cases-${Math.floor(offset / 12) + 1}-attempt-${attempt}`, input.requestedBy);
      responses.push(batchResponse);
      try {
        const parsedBatch = batchSchema.parse(batchResponse.structuredResponse);
        const candidateCases = batch.map(({ conditionId }) => ({
          ...parsedBatch.cases[conditionId],
          ai_evaluation: parsedBatch.cases[conditionId].ai_evaluation
            ? {
                ...parsedBatch.cases[conditionId].ai_evaluation,
                parameter_extraction: parsedBatch.cases[conditionId].ai_evaluation.parameter_extraction ?? undefined,
              }
            : undefined,
          gherkin: normalizeChineseGherkin(parsedBatch.cases[conditionId].gherkin),
        }));
        for (const testCase of candidateCases) validateChineseGherkin(testCase.gherkin);
        normalizedCases = candidateCases;
        break;
      } catch (error) {
        lastValidationError = error;
        const message = error instanceof Error ? error.message : "未知校验错误";
        correction = `\n\n上一版没有通过官方 Cucumber/结构化门禁：${message}\n上一版输出：${JSON.stringify(batchResponse.structuredResponse)}\n只修复门禁指出的问题，保持固定键、ID、追溯关系和业务语义不变，然后重新输出完整 cases。`;
      }
    }
    if (!normalizedCases) throw lastValidationError;
    testCases.push(...normalizedCases);
  }

  const exclusions = new Map(plan.coverage_exclusions.map((item) => [item.trace_ref, item.reason]));
  const result = TestDesignSchema.parse({
    ...plan,
    objective: `基于已批准且冻结的 Requirement Baseline ${input.baselineId}，完成风险、测试点、TestCondition 与原子 TestCase 设计；业务行为与 Testing for AI 共用可追溯、可人工修正的统一协议。`,
    test_cases: testCases,
    tool_applications: plan.tool_applications.map((item) => item.tool === "cucumber_gherkin" ? {
      ...item,
      status: "applied" as const,
      reason: "全部 TestCase 已使用 Cucumber 中文 Gherkin 表达，并通过官方解析器校验。",
    } : item),
    knowledge_evidence: input.approvedModel.knowledge_evidence,
    coverage: Object.fromEntries(requiredCoverage.map((id) => [id, {
      test_point_refs: plan.test_points.filter((point) => point.trace_refs.includes(id)).map((point) => point.id),
      test_case_refs: testCases.filter((testCase) => testCase.trace_refs.includes(id)).map((testCase) => testCase.id),
      exclusion_reason: exclusions.get(id) ?? "",
    }])),
  });
  validateTestDesign(result, input.baseline, allowedKnowledgeRefs);
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
    metadata: { requested_by: requestedBy ?? "local-user", "testmesh.stage": stage, "testmesh.prompt.version": PROMPT_VERSIONS.testCase },
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
    "testmesh.prompt.version": PROMPT_VERSIONS.testCase,
  }),
  processOutput: (output) => ({
    "testmesh.task.id": output.taskId,
    "testmesh.risk.count": output.result.risks.length,
    "testmesh.test_point.count": output.result.test_points.length,
    "testmesh.test_case.count": output.result.test_cases.length,
    "llm.token_count.total": output.usage.totalTokens,
  }),
});
