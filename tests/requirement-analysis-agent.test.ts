import { AIMessage, ToolMessage } from "@langchain/core/messages";
import { fakeModel } from "@langchain/core/testing";
import { getHarnessProfile } from "deepagents";
import { describe, expect, it, vi } from "vitest";
import { createOpenAIRequirementAnalysisModel, runRequirementAnalysisAgent } from "../server/requirement-analysis/agent.js";
import { selectRequirementAnalysisSkills } from "../server/requirement-analysis/skill-selection.js";
import { createSources } from "../server/requirement-analysis/sources.js";

function openAIModel() {
  const model = fakeModel();
  vi.spyOn(model, "getName").mockReturnValue("ChatOpenAI");
  return model;
}

const sources = createSources([{
  originalname: "member.md",
  mimetype: "text/markdown",
  buffer: Buffer.from("会员续费成功后，有效期增加 365 天。"),
}], []);

function analysisDocument(sourceFileId = "ATT-1") {
  const sourceRef = {
    id: "SRC-1",
    description: "会员续费规则原文",
    origin: "explicit" as const,
    source_refs: [],
    confidence: 1,
    source_file_id: sourceFileId,
    locator_type: "paragraph" as const,
    locator: "段落 1",
    excerpt: "会员续费成功后，有效期增加 365 天。",
  };
  return {
    summary: {
      id: "SUM-1",
      description: "会员续费需求",
      origin: "explicit" as const,
      source_refs: ["SRC-1"],
      confidence: 1,
    },
    requirements: [{
      id: "REQ-1",
      description: "续费成功后增加 365 天有效期",
      origin: "explicit" as const,
      source_refs: ["SRC-1"],
      confidence: 1,
      acceptance_criteria: ["续费成功后会员有效期增加 365 天"],
    }],
    actors: [],
    business_rules: [],
    flows: [],
    states: [],
    constraints: [],
    exceptions: [],
    open_questions: [],
    sources: [sourceRef],
  };
}

describe("RA01 requirement analysis Agent", () => {
  it("applies the official profile to the actual ChatOpenAI provider without a modelName alias", () => {
    const model = createOpenAIRequirementAnalysisModel("constructor-only-no-api-call");
    expect(model.getName()).toBe("ChatOpenAI");
    const profile = getHarnessProfile("openai");
    expect(profile?.excludedTools.has("delete")).toBe(true);
    expect(profile?.excludedTools.has("execute")).toBe(true);
    expect(profile?.generalPurposeSubagent?.enabled).toBe(false);
  });
  it("uses the official harness to load a skill progressively with only read tools", async () => {
    const model = openAIModel()
      .respondWithTools([{ name: "read_file", args: { path: "/skills/requirement-extraction/SKILL.md" } }])
      .respond(new AIMessage(JSON.stringify(analysisDocument())));
    const bind = vi.spyOn(model, "bindTools");
    await runRequirementAnalysisAgent({ message: "分析需求", sources, model });
    const tools = bind.mock.calls[0][0].map((value) => "name" in value ? value.name : value.function?.name);
    expect(tools.sort()).toEqual(["locate_source", "read_file", "read_source", "validate_reference"]);
    const firstPrompt = JSON.stringify(model.calls[0].messages);
    expect(firstPrompt).toContain("requirement-extraction");
    const loaded = model.calls[1].messages.find((message) => message instanceof ToolMessage);
    expect(JSON.stringify(loaded?.content)).toContain("name: requirement-extraction");
    expect(firstPrompt).not.toContain("name: requirement-extraction");
  });

  it("denies reading source code outside the selected skill directories", async () => {
    const model = openAIModel()
      .respondWithTools([{ name: "read_file", args: { path: "/agent.ts" } }])
      .respond(new AIMessage(JSON.stringify(analysisDocument())));
    await runRequirementAnalysisAgent({ message: "分析需求", sources, model });
    const reply = model.calls[1].messages.find((message) => message instanceof ToolMessage);
    expect(String(reply?.content)).toMatch(/denied|not permitted|not allowed/i);
    expect(String(reply?.content)).not.toContain("registerHarnessProfile");
  });

  it("rejects unsupported business conclusions through the official afterAgent hook", async () => {
    const candidate = analysisDocument();
    candidate.summary.source_refs = [];
    const model = openAIModel().respond(new AIMessage(JSON.stringify(candidate)));
    await expect(runRequirementAnalysisAgent({ message: "分析需求", sources, model })).rejects.toThrow("缺少原文来源");
    expect(model.callCount).toBe(1);
  });

  it("records deterministic skill activation without loading unrelated skills", () => {
    const decisions = selectRequirementAnalysisSkills(sources);
    expect(decisions.filter((decision) => decision.applicable).map((decision) => decision.skill_id))
      .toEqual([
        "requirement-extraction",
        "business-rule-analysis",
        "ambiguity-detection",
        "source-conflict-analysis",
      ]);
    expect(decisions.find((decision) => decision.skill_id === "flow-analysis"))
      .toMatchObject({ applicable: false, reason: "当前可读文本没有流程信号" });
    expect(decisions.find((decision) => decision.skill_id === "state-analysis"))
      .toMatchObject({ applicable: false, reason: "当前可读文本没有状态信号" });
  });

  it("returns only schema-valid and source-valid structured analysis", async () => {
    const model = openAIModel()
      .respond(new AIMessage(JSON.stringify(analysisDocument())));

    const result = await runRequirementAnalysisAgent({
      message: "分析完整需求",
      sources,
      model,
      requestedBy: "ra01-test",
    });

    expect(result.result.requirements).toHaveLength(1);
    expect(result.result.sources[0]).toMatchObject({
      source_file_id: "ATT-1",
      source_file_name: "member.md",
      locator_type: "paragraph",
    });
    expect(result.skillActivations.filter((decision) => decision.applicable)).toHaveLength(4);
    expect(model.callCount).toBeGreaterThanOrEqual(1);
  });

  it("rejects an otherwise structured result that cites an unknown task source", async () => {
    const model = fakeModel()
      .respond(new AIMessage(JSON.stringify(analysisDocument("ATT-404"))));

    await expect(runRequirementAnalysisAgent({
      message: "分析完整需求",
      sources,
      model,
    })).rejects.toThrow("response schema");
  });
});
