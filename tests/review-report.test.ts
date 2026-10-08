import { describe, expect, it } from "vitest";
import { renderReviewMarkdown, reviewEntries, visibleReviewEntries } from "../src/review-report";
import type { RequirementAnalysis } from "../src/types";

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
});
