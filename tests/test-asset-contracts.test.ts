import { describe, expect, it } from "vitest";
import { ASSET_SCHEMA_VERSIONS, PROMPT_VERSIONS, TestConditionSetDocumentSchema } from "../server/test-design/asset-contracts.js";
import { TEST_DESIGN_PROMPT_REGISTRY } from "../server/test-design/prompt-registry.js";

const condition = {
  id: "TCND-001",
  title: "未指定数量时采用默认数量",
  objective: "验证默认推荐三款",
  primary_trace_ref: "BR-001",
  category: "normal" as const,
  technique: "equivalence_partition" as const,
  rationale: "覆盖未指定数量的有效等价类",
  source_refs: ["SRC-1"],
  knowledge_refs: [],
};

describe("versioned test asset and prompt contracts", () => {
  it("accepts an independently versioned TestCondition set", () => {
    expect(TestConditionSetDocumentSchema.parse({
      schemaVersion: ASSET_SCHEMA_VERSIONS.testCondition,
      baselineId: "baseline-v1",
      approvedTestModelVersionId: "model-v1",
      objective: "验证智能导购业务规则",
      conditions: [condition],
      generation: { mode: "prompt", promptVersion: PROMPT_VERSIONS.testCondition, note: "独立生成" },
    }).conditions).toHaveLength(1);
  });

  it("rejects an unversioned or mismatched TestCondition payload", () => {
    expect(TestConditionSetDocumentSchema.safeParse({
      schemaVersion: "latest",
      baselineId: "baseline-v1",
      approvedTestModelVersionId: "model-v1",
      objective: "验证智能导购业务规则",
      conditions: [condition],
      generation: { mode: "prompt", promptVersion: PROMPT_VERSIONS.testCase, note: "错误版本" },
    }).success).toBe(false);
  });

  it("loads prompts only for semantic generation and LLM judging", () => {
    const byStage = new Map(TEST_DESIGN_PROMPT_REGISTRY.map((item) => [item.stage, item]));
    expect(byStage.get("test_model")?.loadsPrompt).toBe(true);
    expect(byStage.get("test_condition")?.loadsPrompt).toBe(true);
    expect(byStage.get("test_case")?.loadsPrompt).toBe(true);
    expect(byStage.get("approval")?.loadsPrompt).toBe(false);
    expect(byStage.get("dataset_export")?.loadsPrompt).toBe(false);
  });
});

