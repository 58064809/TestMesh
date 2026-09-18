import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { ClientTool, ServerTool } from "@langchain/core/tools";
import type { BaseCheckpointSaver } from "@langchain/langgraph";
import {
  FilesystemBackend,
  createFilesystemMiddleware,
  createSkillsMiddleware,
} from "deepagents";
import { createAgent, type ResponseFormat } from "langchain";
import type { AssembledStage } from "./assembler.js";

const SKILL_READER_TOOL = "read_file";

export interface StageAgentHarnessInput {
  assembled: AssembledStage;
  model: BaseChatModel;
  skillRoot: string;
  skillSources: ReadonlyMap<string, string>;
  tools: ReadonlyMap<string, ClientTool | ServerTool>;
  instructions?: string;
  responseFormat?: ResponseFormat;
  checkpointer?: BaseCheckpointSaver;
}

function buildSystemPrompt(assembled: AssembledStage): string {
  const policies = assembled.profile.policies
    .map((policy) => `- ${policy.id}: ${policy.description}`)
    .join("\n");
  return [
    `当前阶段：${assembled.profile.id}@${assembled.profile.version}`,
    `输出协议：${assembled.output_schema.name}@${assembled.output_schema.version}`,
    "阶段策略：",
    policies || "- 无",
    "只使用当前运行环境暴露的 Context、Knowledge、Skill 和 Tool。",
  ].join("\n");
}

export function createStageAgentHarness(input: StageAgentHarnessInput) {
  if (input.assembled.skill_ids.length > 0 && !input.assembled.tool_ids.includes(SKILL_READER_TOOL)) {
    throw new Error(`阶段加载 Skill 时需要在 Stage Profile 声明 ${SKILL_READER_TOOL}`);
  }

  const backend = new FilesystemBackend({ rootDir: input.skillRoot, virtualMode: true });
  const sources = input.assembled.skill_ids.map((skillId) => {
    const source = input.skillSources.get(skillId);
    if (!source) throw new Error(`Skill 没有注册来源：${skillId}`);
    return source;
  });
  const selectedTools = input.assembled.tool_ids
    .filter((toolId) => toolId !== SKILL_READER_TOOL)
    .map((toolId) => {
      const selected = input.tools.get(toolId);
      if (!selected) throw new Error(`Tool 没有注册实现：${toolId}`);
      return selected;
    });

  const middleware = [];
  if (sources.length > 0) {
    middleware.push(createSkillsMiddleware({ backend, sources }));
    middleware.push(createFilesystemMiddleware({
      backend,
      tools: [SKILL_READER_TOOL],
      permissions: [
        { operations: ["read"], paths: ["/skills/**"] },
        { operations: ["read"], paths: ["/**"], mode: "deny" },
      ],
    }));
  }

  const systemPrompt = [
    buildSystemPrompt(input.assembled),
    input.instructions?.trim(),
  ].filter(Boolean).join("\n\n");

  return createAgent({
    name: `${input.assembled.profile.id}_agent`,
    model: input.model,
    tools: selectedTools,
    middleware,
    systemPrompt,
    ...(input.responseFormat ? { responseFormat: input.responseFormat } : {}),
    checkpointer: input.checkpointer,
  });
}
