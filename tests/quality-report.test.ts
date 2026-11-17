import { describe, expect, it } from "vitest";
import { renderQualityReport } from "../server/quality-management/report.js";

describe("quality report", () => {
  it("renders measurable layers and auditable asset ids without inventing evidence", () => {
    const report = renderQualityReport({
      plan: { id: "QP-1", name: "AI 售后发布", version: 2, status: "approved", projectId: "P-1", release: "R2", objectives: ["幻觉率受控"], scope: "需求分析、Agent", qualityCharacteristics: ["ai_groundedness_hallucination"] },
      metrics: { requirementCoveragePct: 95, executionPassRatePct: 90, missingAiEvaluationTestCaseIds: ["TC-3"] },
      metricCatalog: [
        { id: "requirement_coverage", name: "需求覆盖率", category: "覆盖", status: "available", value: 95, unit: "%", numerator: 19, denominator: 20, formula: "已覆盖需求 / 需求总数", evidence: "Baseline", note: "" },
        { id: "defect_escape_rate", name: "缺陷逃逸率", category: "缺陷", status: "unavailable", value: null, unit: "%", numerator: null, denominator: null, formula: "", evidence: "", note: "尚未接入生产缺陷数据" },
      ],
      latestGate: { id: "G-1", policyVersion: "qm01-v2", opaVersion: "1.21.2", status: "deny", result: { reasons: ["缺少 Phoenix 评测证据"] }, riskAcceptance: null, evaluatedAt: "2026-10-28T00:00:00.000Z" },
      gateFresh: true,
      layers: { governance: { planApproved: true }, aiQuality: { aiDimensionCoveragePct: 80 } },
      assets: { nodes: [{ id: "QP-1", type: "quality_plan", label: "AI 售后发布 v2", status: "approved" }], links: [] },
      improvements: [],
    }, new Date("2026-10-28T00:00:00.000Z"));
    expect(report).toContain("executionPassRatePct");
    expect(report).toContain("TC-3");
    expect(report).toContain("`QP-1`");
    expect(report).toContain("缺少的证据保持缺失状态，不由 AI 补造");
    expect(report).toContain("缺陷逃逸率");
    expect(report).toContain("暂无数据");
    expect(report).toContain("缺少 Phoenix 评测证据");
  });
});
