import { fileURLToPath } from "node:url";
import { AIMessage, ToolMessage } from "@langchain/core/messages";
import { fakeModel } from "@langchain/core/testing";
import { describe, expect, it } from "vitest";
import { assembleStage } from "../server/harness/assembler.js";
import { createStageAgentHarness } from "../server/harness/stage-agent.js";

const task = {
  task_id: "agent-probe-task",
  stage: "requirement_analysis" as const,
  stage_profile_version: "1.0.0",
  input_refs: [{ slot: "current_sources", kind: "source" as const, id: "source-1", required: true }],
  requested_by: "h00",
  created_at: "2026-09-17T04:00:00.000Z",
};

const profile = {
  id: "requirement_analysis" as const,
  version: "1.0.0",
  description: "H00 Agent Harness 探针",
  context: [{ id: "current_sources", description: "来源引用", required: true }],
  knowledge: [],
  skills: [{
    id: "foundation-probe",
    description: "渐进技能加载探针",
    required: true,
    version: "1.0.0",
    activation: "always" as const,
  }],
  tools: [{
    id: "read_file",
    description: "读取已选择 Skill",
    required: true,
    version: "1.0.0",
    mutating: false,
    approval: "never" as const,
  }],
  policies: [{
    id: "declared_capabilities_only",
    description: "只暴露声明能力",
    enforcement: "permission" as const,
  }],
  output_schema: { name: "FoundationProbe", version: "1.0.0" },
  completion_criteria: [{ id: "skill_loaded", description: "技能按需读取", evidence_required: false }],
};

describe("H00 mature Agent Harness integration", () => {
  it("uses LangChain Agent with Deep Agents progressive skill disclosure", async () => {
    const assembled = assembleStage(task, profile, {
      knowledge: new Set(),
      skills: new Set(["foundation-probe", "undeclared_skill"]),
      tools: new Set(["read_file", "write_file"]),
    });
    const model = fakeModel()
      .respondWithTools([{
        name: "read_file",
        args: { path: "/skills/foundation-probe/SKILL.md" },
        id: "read-skill",
      }])
      .respond(new AIMessage("FOUNDATION_SKILL_BODY_LOADED"));
    const skillRoot = fileURLToPath(new URL(
      "../server/harness/skill-catalog",
      import.meta.url,
    ));
    const agent = createStageAgentHarness({
      assembled,
      model,
      skillRoot,
      skillSources: new Map([["foundation-probe", "/skills/foundation-probe/"]]),
      tools: new Map(),
    });

    const result = await agent.invoke({
      messages: [{ role: "user", content: "执行 H00 技能加载探针" }],
    });

    expect(model.callCount).toBe(2);
    const firstSystemPrompt = model.calls[0].messages
      .map((message) => JSON.stringify(message.content))
      .join("\n");
    expect(firstSystemPrompt).toContain("foundation-probe");
    expect(firstSystemPrompt).not.toContain("FOUNDATION_SKILL_BODY_LOADED");
    const toolMessage = result.messages.find((message) => message instanceof ToolMessage);
    expect(JSON.stringify(toolMessage?.content)).toContain("FOUNDATION_SKILL_BODY_LOADED");
    expect(result.messages.at(-1)?.content).toBe("FOUNDATION_SKILL_BODY_LOADED");
    expect(assembled.skill_ids).toEqual(["foundation-probe"]);
    expect(assembled.tool_ids).toEqual(["read_file"]);

    const blockedModel = fakeModel()
      .respondWithTools([{
        name: "write_file",
        args: { path: "/forbidden", content: "forbidden" },
        id: "blocked-write",
      }])
      .respond(new AIMessage("已停止"));
    const restrictedAgent = createStageAgentHarness({
      assembled,
      model: blockedModel,
      skillRoot,
      skillSources: new Map([["foundation-probe", "/skills/foundation-probe/"]]),
      tools: new Map(),
    });
    const blockedResult = await restrictedAgent.invoke({
      messages: [{ role: "user", content: "尝试未声明工具" }],
    });
    const blockedToolMessage = blockedResult.messages.find(
      (message) => message instanceof ToolMessage,
    );
    expect(String(blockedToolMessage?.content)).toContain(
      "write_file is not a valid tool, try one of [read_file]",
    );
  });

  it("rejects skills when the Stage Profile does not declare the reader tool", () => {
    const assembled = assembleStage(task, { ...profile, tools: [] }, {
      knowledge: new Set(),
      skills: new Set(["foundation-probe"]),
      tools: new Set(),
    });
    expect(() => createStageAgentHarness({
      assembled,
      model: fakeModel(),
      skillRoot: ".",
      skillSources: new Map([["foundation-probe", "/skills/foundation-probe/"]]),
      tools: new Map(),
    })).toThrow("阶段加载 Skill 时需要在 Stage Profile 声明 read_file");
  });
});
