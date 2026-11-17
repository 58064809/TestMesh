import { describe, expect, it } from "vitest";
import { renderReviewMarkdown, reviewEntries, visibleReviewEntries } from "../src/review-report";
import type { AnalysisReviewRecord, RequirementAnalysis } from "../src/types";

const item = (id: string, description: string) => ({
  id, description, origin: "inferred" as const, source_refs: [], confidence: 0.9,
});

const document: RequirementAnalysis = {
  summary: item("SUM-1", "需求概述"),
  requirements: [{ ...item("REQ-1", "用户可以退款"), acceptance_criteria: [] }],
  actors: [], business_rules: [], flows: [], states: [], constraints: [], exceptions: [],
  open_questions: [
    { ...item("OQ-1", "退款时限没有定义"), issue_type: "missing" },
    { ...item("OQ-2", "快速退款的含义不明确"), issue_type: "ambiguity" },
  ],
  sources: [],
};

describe("人工评审问题视图", () => {
  it("只显示缺失、歧义和冲突问题，并能导出独立验收清单", () => {
    const entries = visibleReviewEntries(reviewEntries(document, []), "issues");
    expect(entries.map((entry) => entry.item.id)).toEqual(["OQ-1", "OQ-2"]);
    const markdown = renderReviewMarkdown(document, [], "issues");
    expect(markdown).toContain("# 需求问题验收清单");
    expect(markdown).toContain("OQ-1");
    expect(markdown).not.toContain("REQ-1");
  });

  it("保留长决策中的 Markdown 表格结构", () => {
    const review: AnalysisReviewRecord = {
      id: "REV-1",
      analysisId: "AN-1",
      itemId: "OQ-1",
      status: "accepted",
      reviewer: "产品负责人",
      reason: "已完成业务评审",
      issueType: "missing",
      mergeInto: "",
      decision: "## BR-001：推荐数量\n\n| 场景 | 正式规则 |\n| --- | --- |\n| 未指定数量 | 默认推荐 3 款 |",
      decisionBy: "产品负责人",
      prdRevision: "V1.0",
      createdAt: "2026-11-13T00:00:00.000Z",
    };
    const markdown = renderReviewMarkdown(document, [review], "accepted");
    expect(markdown).toContain("### 正式评审决策\n\n## BR-001：推荐数量");
    expect(markdown).toContain("| 场景 | 正式规则 |");
    expect(markdown).toContain("决策人：产品负责人；回写 PRD：V1.0");
  });
});
