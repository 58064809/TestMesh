import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ControlledBenchmarkSchema, benchmarkSummary } from "../server/ai-quality/benchmark.js";

const benchmarkPath = path.resolve(import.meta.dirname, "..", "evaluation", "requirement-analysis-controlled-v0.json");
const benchmark = ControlledBenchmarkSchema.parse(JSON.parse(readFileSync(benchmarkPath, "utf8")));

describe("需求问题受控基准", () => {
  it("提供至少 20 个唯一、单缺陷、可分层的样本", () => {
    const summary = benchmarkSummary(benchmark);
    expect(summary.total).toBe(20);
    expect(summary.mutationKinds).toBe(20);
    expect(summary.issueTypes).toEqual({ missing: 7, ambiguity: 7, conflict: 6 });
  });

  it("明确标记为受控合成数据而不冒充真实业务资料", () => {
    expect(benchmark.status).toBe("controlled-synthetic");
    expect(benchmark.limitations.join(" ")).toContain("不能替代真实项目资料");
  });

  it("冲突样本全部要求至少两个证据段落", () => {
    const conflicts = benchmark.cases.filter((item) => item.expected.issueType === "conflict");
    expect(conflicts.every((item) => item.expected.paragraphs.length >= 2)).toBe(true);
  });
});
