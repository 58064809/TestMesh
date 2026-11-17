import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { HumanMessage, isAIMessage } from "@langchain/core/messages";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { traceAgent } from "@arizeai/phoenix-otel";
import { CompositeBackend, createDeepAgent, FilesystemBackend, registerHarnessProfile, StateBackend } from "deepagents";
import { createMiddleware, MiddlewareError, providerStrategy, tool } from "langchain";
import { z } from "zod";
import { currentPhoenixTraceReference, type PhoenixTraceReference } from "../observability/phoenix.js";
import type { KnowledgeSearchHit } from "../knowledge/qdrant.js";
import { TEST_MODEL_INSTRUCTIONS } from "./prompt.js";
import { PROMPT_VERSIONS } from "./asset-contracts.js";
import {
  ModelTestModelPlanSchema,
  TestDesignPlanSchema,
  TestModelDocumentSchema,
  type BaselineSnapshot,
  type TestModelDocument,
} from "./schema.js";
import { selectTestDesignSkills, type TestDesignSkillDecision } from "./skill-selection.js";
import { validateTestDesignPlan, validateTestModel } from "./validation.js";

const SKILL_ROOT = fileURLToPath(new URL("./skills/", import.meta.url));

registerHarnessProfile("openai", {
  generalPurposeSubagent: { enabled: false },
  excludedTools: ["ls", "glob", "grep", "write_file", "edit_file", "delete", "execute", "task", "write_todos", "eval"],
  excludedMiddleware: ["SummarizationMiddleware"],
});

export interface TestModelAgentResult {
  taskId: string;
  result: TestModelDocument;
  usage: { inputTokens: number; outputTokens: number; totalTokens: number };
  skillActivations: TestDesignSkillDecision[];
  observability?: PhoenixTraceReference;
}

async function runTestModelAgentImpl(input: {
  taskId?: string;
  baselineId: string;
  baseline: BaselineSnapshot;
  prdMarkdown: string;
  model: BaseChatModel;
  requestedBy?: string;
  knowledgeSearch?: (query: string) => Promise<KnowledgeSearchHit[]>;
}): Promise<TestModelAgentResult> {
  const taskId = input.taskId ?? randomUUID();
  const observability = currentPhoenixTraceReference();
  const requiredCoverage = input.baseline.accepted
    .filter((entry) => ["requirements", "business_rules", "flows", "states", "constraints", "exceptions", "open_questions"].includes(entry.section))
    .map((entry) => entry.item.id);
  const skillActivations = selectTestDesignSkills(input.baseline);
  const skills = skillActivations.filter((item) => item.applicable).map((item) => `/skills/${item.skill_id}/`);
  const retrievedKnowledge = new Map<string, KnowledgeSearchHit>();
  const knowledgeTool = input.knowledgeSearch ? tool(async ({ query }) => {
    const hits = await input.knowledgeSearch!(query);
    for (const hit of hits) retrievedKnowledge.set(hit.chunkId, hit);
    return JSON.stringify(hits.map((hit) => ({
      chunk_id: hit.chunkId, score: hit.score, filename: hit.filename, headings: hit.headings,
      page_numbers: hit.pageNumbers, doc_items: hit.docItems, text: hit.text,
    })));
  }, {
    name: "search_project_knowledge",
    description: "检索已索引的架构、接口契约、数据字典、历史缺陷和企业规则。只返回可引用的真实证据。",
    schema: z.object({ query: z.string().min(2) }),
  }) : undefined;
  const agent = createDeepAgent({
    model: input.model,
    backend: new CompositeBackend(new StateBackend(), {
      "/skills/": new FilesystemBackend({ rootDir: SKILL_ROOT, virtualMode: true }),
    }),
    skills,
    permissions: [
      { operations: ["read" as const], paths: skills.map((skill) => `${skill}**`) },
      { operations: ["read" as const, "write" as const], paths: ["/**"], mode: "deny" as const },
    ],
    tools: knowledgeTool ? [knowledgeTool] : [],
    name: "test_model_builder",
    systemPrompt: TEST_MODEL_INSTRUCTIONS,
    responseFormat: providerStrategy(ModelTestModelPlanSchema),
    middleware: [createMiddleware({
      name: "TestModelValidation",
      afterAgent: (state) => validateTestDesignPlan(normalizePlan(
        (state as typeof state & { structuredResponse?: unknown }).structuredResponse,
        input.baseline,
      ), input.baseline, new Set(retrievedKnowledge.keys())),
    })],
  });
  const response = await agent.invoke({
    messages: [new HumanMessage({
      content: `建立可审核的测试模型。基线 ID：${input.baselineId}\n\n必须建模并覆盖的基线 ID：\n${requiredCoverage.join("、")}\n\n必须建立四个相互引用但职责分离的行为模型：M-01 语义与参数模型只定义意图、Slot、规范化与跨参数约束；M-02 业务决策模型定义筛选、排序、数量和异常动作；M-03 会话状态模型定义状态、上下文更新及迁移；M-04 Agent 交互模型定义工具契约、调用条件、成功、无结果与失败路径。随后形成 Risk、TestPoint 和仅供下一阶段核对的候选 TestCondition。涉及 AI/Agent 时，同时考虑 TestMesh 自身 Agent 与被测 AI 应用，并按 Agent 决策、工具执行、业务结果、最终回复四层规划证据。此阶段禁止生成 TestCase。参数提取适用性必须自洽：status=blocked 或 not_applicable 时 aspects 必须为空，并且绝对不能生成 ai_dimension=parameter_extraction 的 TestCondition；只有真实来源已经提供参数 Schema、归一化规则、上下文状态和工具映射契约，status 才能为 applicable，此时才允许生成参数提取条件，并必须完整规划18个专项维度。${knowledgeTool ? "可按需检索真实项目知识。" : "当前没有已索引项目知识，knowledge_refs 必须为空。"}\n\n获批 PRD（Docling Markdown）：\n${input.prdMarkdown}\n\n批准基线：\n${JSON.stringify(input.baseline)}`,
    })],
  }, {
    configurable: { thread_id: `${taskId}:test-model` },
    metadata: { requested_by: input.requestedBy ?? "local-user", "testmesh.stage": "test-model", "testmesh.prompt.version": PROMPT_VERSIONS.testModel },
  }).catch((error: unknown) => {
    let cause = error;
    while (cause instanceof MiddlewareError && cause.cause) cause = cause.cause;
    throw cause;
  });
  const plan = normalizePlan(
    (response as typeof response & { structuredResponse?: unknown }).structuredResponse,
    input.baseline,
  );
  const knowledgeEvidence = [...retrievedKnowledge.values()].map((hit) => ({
    chunk_id: hit.chunkId, document_id: hit.documentId, filename: hit.filename, score: hit.score,
    text: hit.text, headings: hit.headings, page_numbers: hit.pageNumbers, doc_items: hit.docItems,
  }));
  const elements = (section: BaselineSnapshot["accepted"][number]["section"]) => input.baseline.accepted
    .filter((entry) => entry.section === section)
    .map((entry) => ({ id: entry.item.id, description: entry.item.description, source_refs: entry.item.source_refs }));
  const dimensions = [...new Set(plan.test_conditions.flatMap((item) => item.ai_dimension ? [item.ai_dimension] : []))];
  const result = TestModelDocumentSchema.parse({
    objective: `基于 Requirement Baseline ${input.baselineId} 建立可审核、可追溯的测试模型，批准后才能生成 TestCase。`,
    quality_model: {
      objectives: [plan.objective],
      risk_refs: plan.risks.map((item) => item.id),
      coverage_targets: requiredCoverage,
    },
    business_model: {
      actors: elements("actors"), business_rules: elements("business_rules"), flows: elements("flows"),
      states: elements("states"), constraints: elements("constraints"), exceptions: elements("exceptions"),
    },
    ai_model: {
      applicable: dimensions.length > 0,
      evaluation_subjects: dimensions.length ? ["testmesh", "target_application"] : [],
      evaluation_layers: dimensions.length ? ["agent_decision", "tool_execution", "business_outcome", "final_response"] : [],
      dimensions,
    },
    behavior_models: plan.behavior_models,
    test_analysis: plan,
    knowledge_evidence: knowledgeEvidence,
  });
  validateTestModel(result, input.baseline);
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

export function normalizeEvidenceSourceRefs(refs: string[], baseline: BaselineSnapshot) {
  const sourceIds = new Set(baseline.sourceRefs.map((source) => source.id));
  const sourcesByTrace = new Map(
    baseline.accepted.map((entry) => [entry.item.id, entry.item.source_refs]),
  );
  return [...new Set(refs.flatMap((ref) => {
    if (sourceIds.has(ref)) return [ref];
    return sourcesByTrace.get(ref) ?? [ref];
  }))];
}

function normalizePlan(value: unknown, baseline: BaselineSnapshot) {
  const parsed = ModelTestModelPlanSchema.parse(value);
  const normalized = TestDesignPlanSchema.parse({
    ...parsed,
    parameter_extraction_assessment: parsed.parameter_extraction_assessment ? {
      ...parsed.parameter_extraction_assessment,
      source_refs: normalizeEvidenceSourceRefs(parsed.parameter_extraction_assessment.source_refs, baseline),
    } : undefined,
    test_conditions: parsed.test_conditions.map((condition) => ({ ...condition, ai_dimension: condition.ai_dimension ?? undefined })),
  });
  return { ...normalized, behavior_models: parsed.behavior_models };
}

export const runTestModelAgent = traceAgent(runTestModelAgentImpl, {
  name: "testmesh.test_model",
  processInput: (input: Parameters<typeof runTestModelAgentImpl>[0]) => ({
    "testmesh.task.id": input.taskId ?? "generated",
    "testmesh.baseline.id": input.baselineId,
    "testmesh.baseline.accepted_count": input.baseline.accepted.length,
    "testmesh.prompt.version": PROMPT_VERSIONS.testModel,
  }),
  processOutput: (output) => ({
    "testmesh.task.id": output.taskId,
    "testmesh.risk.count": output.result.test_analysis.risks.length,
    "testmesh.behavior_model.count": 4,
    "testmesh.test_condition_candidate.count": output.result.test_analysis.test_conditions.length,
    "llm.token_count.total": output.usage.totalTokens,
  }),
});
