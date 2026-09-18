import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { HumanMessage, isAIMessage } from "@langchain/core/messages";
import { ChatOpenAI } from "@langchain/openai";
import { providerStrategy } from "langchain";
import { assembleStage } from "../harness/assembler.js";
import { RequirementAnalysisStageProfile } from "../harness/profiles/requirement-analysis.js";
import { createStageAgentHarness } from "../harness/stage-agent.js";
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
  validateRequirementAnalysis,
} from "./validation.js";

const SKILL_ROOT = fileURLToPath(new URL("../harness/skill-catalog", import.meta.url));
const SKILL_SOURCES = new Map([
  ["requirement-extraction", "/skills/requirement-extraction/"],
  ["business-rule-analysis", "/skills/business-rule-analysis/"],
  ["flow-analysis", "/skills/flow-analysis/"],
  ["state-analysis", "/skills/state-analysis/"],
  ["ambiguity-detection", "/skills/ambiguity-detection/"],
  ["source-conflict-analysis", "/skills/source-conflict-analysis/"],
]);

export interface RequirementAnalysisAgentResult {
  taskId: string;
  result: RequirementAnalysis;
  usage: { inputTokens: number; outputTokens: number; totalTokens: number };
  skillActivations: SkillActivationDecision[];
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

export async function runRequirementAnalysisAgent(input: {
  taskId?: string;
  message: string;
  sources: SourceFile[];
  model: BaseChatModel;
  requestedBy?: string;
}): Promise<RequirementAnalysisAgentResult> {
  if (input.sources.length === 0) throw new Error("至少需要上传一个 PRD、文档或图片来源");
  if (input.sources.length > MAX_FILES) throw new Error(`单次最多上传 ${MAX_FILES} 个文件`);

  const taskId = input.taskId ?? randomUUID();
  const skillActivations = selectRequirementAnalysisSkills(input.sources);
  const sourceTools = createRequirementSourceTools(input.sources);
  const assembled = assembleStage({
    task_id: taskId,
    stage: "requirement_analysis",
    stage_profile_version: RequirementAnalysisStageProfile.version,
    input_refs: input.sources.map((source) => ({
      slot: "current_sources",
      kind: "source" as const,
      id: source.id,
      required: true,
    })),
    requested_by: input.requestedBy?.trim() || "local-user",
    created_at: new Date().toISOString(),
  }, RequirementAnalysisStageProfile, {
    knowledge: new Set(),
    skills: new Set(
      skillActivations.filter((decision) => decision.applicable).map((decision) => decision.skill_id),
    ),
    tools: new Set(["read_file", ...sourceTools.map((sourceTool) => sourceTool.name)]),
  });
  const tools = new Map(sourceTools.map((sourceTool) => [sourceTool.name, sourceTool]));
  const agent = createStageAgentHarness({
    assembled,
    model: input.model,
    skillRoot: SKILL_ROOT,
    skillSources: SKILL_SOURCES,
    tools,
    instructions: REQUIREMENT_ANALYSIS_INSTRUCTIONS,
    responseFormat: providerStrategy(createModelRequirementAnalysisSchema(input.sources)),
  });

  const response = await agent.invoke({
    messages: [new HumanMessage({
      contentBlocks: buildRequirementSourceContent(input.message, input.sources),
    })],
  });
  const structuredResponse = (response as typeof response & { structuredResponse?: unknown })
    .structuredResponse;
  const parsed = ModelRequirementAnalysisSchema.safeParse(structuredResponse);
  if (!parsed.success) {
    throw new RequirementAnalysisValidationError(`Structured Output 不符合 RequirementAnalysis Schema：${parsed.error.message}`);
  }

  let result: RequirementAnalysis;
  try {
    result = attachRequirementSources(parsed.data, input.sources);
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

  return { taskId, result, usage, skillActivations };
}
