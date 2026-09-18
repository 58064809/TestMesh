import { describe, expect, it } from "vitest";
import { evaluateRequirementAnalysisCompletion } from "../server/requirement-analysis/completion-gate.js";
import { createSources } from "../server/requirement-analysis/sources.js";

const sourceFiles = createSources([{
  originalname: "order.md",
  mimetype: "text/markdown",
  buffer: Buffer.from("订单 30 分钟未支付自动关闭。\n\n补充说明写订单 15 分钟未支付自动关闭。"),
}], []);

const task = {
  task_id: "ra-gate-test",
  stage: "requirement_analysis" as const,
  stage_profile_version: "1.0.0",
  input_refs: [{ slot: "current_sources", kind: "source" as const, id: "ATT-1", required: true }],
  requested_by: "ra01-test",
  created_at: "2026-09-17T06:00:00.000Z",
};

function candidate() {
  return {
    summary: {
      id: "SUM-1",
      description: "订单超时关闭需求",
      origin: "explicit" as const,
      source_refs: ["SRC-1"],
      confidence: 1,
    },
    requirements: [],
    actors: [],
    business_rules: [],
    flows: [],
    states: [],
    constraints: [],
    exceptions: [],
    open_questions: [],
    sources: [{
      id: "SRC-1",
      description: "订单关闭规则原文",
      origin: "explicit" as const,
      source_refs: [],
      confidence: 1,
      source_file_id: "ATT-1",
      source_file_name: "order.md",
      locator_type: "paragraph" as const,
      locator: "段落 1",
      excerpt: "订单 30 分钟未支付自动关闭。",
    }],
  };
}

describe("RA01 deterministic completion gate", () => {
  it("accepts a schema-valid candidate with traceable evidence", () => {
    const result = evaluateRequirementAnalysisCompletion({ task, candidate: candidate(), sources: sourceFiles });
    expect(result.report.accepted).toBe(true);
    expect(result.report.checks).toHaveLength(5);
    expect(result.report.checks.every((item) => item.passed)).toBe(true);
  });

  it("rejects important conclusions without evidence", () => {
    const input = candidate();
    input.summary.source_refs = [];
    const result = evaluateRequirementAnalysisCompletion({ task, candidate: input, sources: sourceFiles });
    expect(result.report.accepted).toBe(false);
    expect(result.report.failed_at).toContain("SUM-1 缺少原文来源");
  });

  it("rejects a fabricated source file locator", () => {
    const input = candidate();
    input.sources[0].source_file_id = "ATT-404";
    const result = evaluateRequirementAnalysisCompletion({ task, candidate: input, sources: sourceFiles });
    expect(result.report.accepted).toBe(false);
    expect(result.report.failed_at).toContain("引用了未知文件");
  });

  it("rejects conflict classification with only one distinct evidence reference", () => {
    const input = candidate();
    input.open_questions.push({
      id: "OQ-1",
      description: "关闭时间存在冲突",
      origin: "explicit",
      source_refs: ["SRC-1", "SRC-1"],
      confidence: 1,
      issue_type: "conflict",
    });
    const result = evaluateRequirementAnalysisCompletion({ task, candidate: input, sources: sourceFiles });
    expect(result.report.accepted).toBe(false);
    expect(result.report.failed_at).toContain("至少要关联相互矛盾的两处原文");
  });

  it("rejects a source-priority claim not present in its cited excerpt", () => {
    const input = candidate();
    input.business_rules.push({
      id: "BR-1",
      description: "PRD 优先于补充说明",
      origin: "explicit",
      source_refs: ["SRC-1"],
      confidence: 1,
    });
    const result = evaluateRequirementAnalysisCompletion({ task, candidate: input, sources: sourceFiles });
    expect(result.report.accepted).toBe(false);
    expect(result.report.failed_at).toContain("关联原文没有该规则");
  });
});
