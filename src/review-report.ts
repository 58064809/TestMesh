import { analysisSections, issueTypeLabels, locatorLabels, originLabels } from "./analysis-report";
import type { AnalysisIssueType, AnalysisItem, AnalysisReviewRecord, RequirementAnalysis } from "./types";

const reviewLabels = { accepted: "已接受", rejected: "已驳回", merged: "已合并", clarify: "待澄清" } as const;

export type ReviewView = "pending" | "accepted" | "all";
export type ReviewEntry = { section: string; label: string; item: AnalysisItem; review?: AnalysisReviewRecord };

export function reviewEntries(document: RequirementAnalysis, reviews: AnalysisReviewRecord[]): ReviewEntry[] {
  const byId = new Map(reviews.map((review) => [review.itemId, review]));
  return [
    ...(document.summary ? [{ section: "summary", label: "需求概述", item: document.summary, review: byId.get(document.summary.id) }] : []),
    ...analysisSections.flatMap(([section, label]) => document[section].map((item) => ({ section, label, item, review: byId.get(item.id) }))),
  ];
}

export function visibleReviewEntries(entries: ReviewEntry[], view: ReviewView): ReviewEntry[] {
  if (view === "pending") return entries.filter((entry) => !entry.review || entry.review.status === "clarify");
  if (view === "accepted") return entries.filter((entry) => entry.review?.status === "accepted");
  return entries;
}

export function unresolvedDecisionEntries(entries: ReviewEntry[]): ReviewEntry[] {
  return entries.filter((entry) => entry.section === "open_questions"
    && entry.review?.status === "accepted"
    && (!entry.review.decision.trim() || !entry.review.decisionBy.trim() || !entry.review.prdRevision.trim()));
}

export function renderReviewMarkdown(document: RequirementAnalysis, reviews: AnalysisReviewRecord[], view: ReviewView): string {
  const all = reviewEntries(document, reviews);
  const entries = visibleReviewEntries(all, view);
  const sources = new Map(document.sources.map((source) => [source.id, source]));
  const title = view === "pending" ? "待评审清单" : view === "accepted" ? "已接受需求分析报告" : "完整评审记录";
  const lines = [`# ${title}`, "", `共 ${entries.length} 条。`, ""];
  for (const entry of entries) {
    const merged = view === "accepted" ? all.filter((other) => other.review?.status === "merged" && other.review.mergeInto === entry.item.id) : [];
    const refs = [...new Set([...entry.item.source_refs, ...merged.flatMap((other) => other.item.source_refs)])];
    lines.push(`## ${entry.label} · ${entry.item.id}`, "", entry.item.description, "",
      `结论来源：${originLabels[entry.item.origin]}${"issue_type" in entry.item ? `；AI 问题分类：${issueTypeLabels[entry.item.issue_type as AnalysisIssueType]}` : ""}；人工评审：${entry.review ? reviewLabels[entry.review.status] : "待评审"}${entry.review?.issueType ? `；人工问题分类：${issueTypeLabels[entry.review.issueType]}` : ""}`, "");
    if (entry.review?.decision) lines.push(`评审决策：${entry.review.decision}（${entry.review.decisionBy}；PRD ${entry.review.prdRevision}）`, "");
    if (merged.length) lines.push(`合并来源：${merged.map((other) => other.item.id).join("、")}`, "");
    for (const id of refs) {
      const source = sources.get(id);
      if (source) lines.push(`- 原文 ${id}：${source.source_file_name} · ${locatorLabels[source.locator_type]} ${source.locator} · ${source.excerpt || source.description}`);
    }
    if (refs.length) lines.push("");
  }
  return lines.join("\n").trimEnd() + "\n";
}
