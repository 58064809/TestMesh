import { AIMessage } from "@langchain/core/messages";
import { fakeModel } from "@langchain/core/testing";
import { describe, expect, it } from "vitest";
import { runRequirementAnalysisAgent } from "../server/requirement-analysis/agent.js";
import { selectRequirementAnalysisSkills } from "../server/requirement-analysis/skill-selection.js";
import { createSources } from "../server/requirement-analysis/sources.js";

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
    const model = fakeModel()
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
