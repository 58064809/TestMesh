import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { HumanMessage, isAIMessage } from "@langchain/core/messages";
import { ChatOpenAI } from "@langchain/openai";
import { createMiddleware, MiddlewareError, providerStrategy } from "langchain";
import { traceAgent } from "@arizeai/phoenix-otel";
import { CompositeBackend, createDeepAgent, FilesystemBackend, registerHarnessProfile, StateBackend } from "deepagents";
import type { BaseCheckpointSaver } from "@langchain/langgraph";
import { MAX_OUTPUT_TOKENS, MODEL } from "./config.js";
import { REQUIREMENT_ANALYSIS_INSTRUCTIONS } from "./prompt.js";
import {
  createModelRequirementAnalysisSchema,
  ModelRequirementAnalysisSchema,
  type RequirementAnalysis,
} from "./schema.js";
import { selectRequirementAnalysisSkills, type SkillActivationDecision } from "./skill-selection.js";
import {
  MAX_FILES,
  buildRequirementSourceContent,
  createRequirementSourceTools,
  type SourceFile,
} from "./sources.js";
import {
  RequirementAnalysisValidationError,
  attachRequirementSources,
  canonicalizeModelRequirementSources,
  validateRequirementAnalysis,
} from "./validation.js";
import { currentPhoenixTraceReference, type PhoenixTraceReference } from "../observability/phoenix.js";

const SKILL_ROOT = fileURLToPath(new URL("./skills/", import.meta.url));
// Official Deep Agents profile; no TestMesh profile schema or capability assembler.
// This ChatOpenAI version exposes `model`, whereas Deep Agents 1.13.5 looks
// for `modelName`/`model_name`. Use its documented provider-level profile so
// the restrictions also apply to the actual production model instance.
registerHarnessProfile("openai", {
  generalPurposeSubagent: { enabled: false },
  excludedTools: ["ls", "glob", "grep", "write_file", "edit_file", "delete", "execute", "task", "write_todos", "eval"],
  // This bounded analysis must retain the complete original material.
  excludedMiddleware: ["SummarizationMiddleware"],
});

export interface RequirementAnalysisAgentResult {
  taskId: string;
  result: RequirementAnalysis;
  usage: { inputTokens: number; outputTokens: number; totalTokens: number };
  skillActivations: SkillActivationDecision[];
  observability?: PhoenixTraceReference;
}

export function createOpenAIRequirementAnalysisModel(apiKey: string): ChatOpenAI {
  return new ChatOpenAI({
    apiKey,
    model: MODEL,
    useResponsesApi: true,
    maxRetries: 0,
    maxTokens: MAX_OUTPUT_TOKENS,
    zdrEnabled: true,
  });
}

async function runRequirementAnalysisAgentImpl(input: {
  taskId?: string;
  message: string;
  sources: SourceFile[];
  model: BaseChatModel;
  requestedBy?: string;
  checkpointer?: BaseCheckpointSaver;
}): Promise<RequirementAnalysisAgentResult> {
  if (input.sources.length === 0) throw new Error("至少需要上传一个 PRD、文档或图片来源");
  if (input.sources.length > MAX_FILES) throw new Error(`单次最多上传 ${MAX_FILES} 个文件`);

  const taskId = input.taskId ?? randomUUID();
  const observability = currentPhoenixTraceReference();
  const skillActivations = selectRequirementAnalysisSkills(input.sources);
  const sourceTools = createRequirementSourceTools(input.sources);
  const skills = skillActivations.filter((item) => item.applicable)
    .map((item) => `/skills/${item.skill_id}/`);
  const agent = createDeepAgent({
    name: "requirement_analysis",
    model: input.model,
    backend: new CompositeBackend(new StateBackend(), {
      "/skills/": new FilesystemBackend({ rootDir: SKILL_ROOT, virtualMode: true }),
    }),
    skills,
    permissions: [
      { operations: ["read"], paths: skills.map((skill) => `${skill}**`) },
      { operations: ["read", "write"], paths: ["/**"], mode: "deny" },
    ],
    tools: sourceTools,
    systemPrompt: REQUIREMENT_ANALYSIS_INSTRUCTIONS,
    responseFormat: providerStrategy(createModelRequirementAnalysisSchema(input.sources)),
    checkpointer: input.checkpointer,
    middleware: [createMiddleware({
      name: "RequirementEvidenceValidation",
      afterAgent: (state) => {
        try {
          const candidate = ModelRequirementAnalysisSchema.parse(
            (state as typeof state & { structuredResponse?: unknown }).structuredResponse,
          );
          validateRequirementAnalysis(
            attachRequirementSources(canonicalizeModelRequirementSources(candidate, input.sources), input.sources),
            input.sources,
          );
        } catch (error) {
          throw new RequirementAnalysisValidationError(error instanceof Error ? error.message : "需求证据校验失败");
        }
      },
    })],
  });

  const response = await agent.invoke({
    messages: [new HumanMessage({
      contentBlocks: buildRequirementSourceContent(input.message, input.sources),
    })],
  }, { configurable: { thread_id: `${taskId}:analysis` }, metadata: { requested_by: input.requestedBy ?? "local-user" } }).catch((error: unknown) => {
    let cause = error;
    while (cause instanceof MiddlewareError && cause.cause) cause = cause.cause;
    // Keep the existing HTTP 422 contract for invalid business evidence.
    if (cause instanceof RequirementAnalysisValidationError) throw cause;
    throw error;
  });
  const structuredResponse = (response as typeof response & { structuredResponse?: unknown })
    .structuredResponse;
  const parsed = ModelRequirementAnalysisSchema.safeParse(structuredResponse);
  if (!parsed.success) {
    throw new RequirementAnalysisValidationError(`Structured Output 不符合 RequirementAnalysis Schema：${parsed.error.message}`);
  }

  let result: RequirementAnalysis;
  try {
    result = attachRequirementSources(canonicalizeModelRequirementSources(parsed.data, input.sources), input.sources);
    validateRequirementAnalysis(result, input.sources);
  } catch (error) {
    throw new RequirementAnalysisValidationError(
      error instanceof Error ? error.message : "结构或来源校验失败",
    );
  }

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

export const runRequirementAnalysisAgent = traceAgent(runRequirementAnalysisAgentImpl, {
  name: "testmesh.requirement_analysis",
  processInput: (input: Parameters<typeof runRequirementAnalysisAgentImpl>[0]) => ({
    "testmesh.task.id": input.taskId ?? "generated",
    "testmesh.requested_by": input.requestedBy ?? "local-user",
    "testmesh.source.count": input.sources.length,
    "testmesh.source.ids": input.sources.map((source) => source.id),
  }),
  processOutput: (output) => ({
    "testmesh.task.id": output.taskId,
    "testmesh.requirement.count": output.result.requirements.length,
    "testmesh.open_question.count": output.result.open_questions.length,
    "llm.token_count.total": output.usage.totalTokens,
  }),
});
