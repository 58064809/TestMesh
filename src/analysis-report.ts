import type { AnalysisItem, AnalysisOrigin, LocatorType, RequirementAnalysis } from "./types";

export const analysisSections = [
  ["requirements", "需求项"],
  ["actors", "参与角色"],
  ["business_rules", "业务规则"],
  ["flows", "业务流程"],
  ["states", "状态及状态迁移"],
  ["constraints", "约束条件"],
  ["exceptions", "明确的异常处理"],
  ["open_questions", "缺失、歧义与冲突"],
] as const;

export const originLabels: Record<AnalysisOrigin, string> = {
  explicit: "原文明确",
  inferred: "基于原文推导",
  missing: "需求缺失",
  conflict: "需求冲突",
};
export const locatorLabels: Record<LocatorType, string> = { page: "页码", paragraph: "段落", image: "图片", limited: "定位受限" };

function itemMarkdown(item: AnalysisItem, document: RequirementAnalysis): string[] {
  const sources = new Map(document.sources.map((source) => [source.id, source]));
  const references = item.source_refs.map((id) => {
    const source = sources.get(id);
    return source
      ? `${source.source_file_name} · ${locatorLabels[source.locator_type]}${source.locator ? ` ${source.locator}` : ""} · ${id}`
      : `${id}（来源未找到）`;
  });
  return [
    `- ${item.id} · ${originLabels[item.origin]} · 可信度 ${Math.round(item.confidence * 100)}%：${item.description}`,
    ...(references.length ? [`  - 原文引用：${references.join("；")}`] : []),
  ];
}

export function renderAnalysisMarkdown(document: RequirementAnalysis): string {
  const lines = ["# 需求分析报告", "", "## 需求概述", ""];
  lines.push(...(document.summary ? itemMarkdown(document.summary, document) : ["暂无可确认的概述。"]));
  for (const [key, label] of analysisSections) {
    lines.push("", `## ${label}`, "");
    const items = document[key];
    if (items.length === 0) {
      lines.push("暂无已识别内容。");
      continue;
    }
    for (const item of items) {
      lines.push(...itemMarkdown(item, document));
      if (key === "requirements") {
        const requirement = item as RequirementAnalysis["requirements"][number];
        if (requirement.acceptance_criteria.length > 0) {
          lines.push(`  - 原文验收标准：${requirement.acceptance_criteria.join("；")}`);
        }
      }
    }
  }
  lines.push("", "## 原文引用", "");
  if (document.sources.length === 0) lines.push("暂无原文引用。");
  for (const source of document.sources) {
    lines.push(`- ${source.id} · ${source.source_file_name} · ${locatorLabels[source.locator_type]}${source.locator ? ` ${source.locator}` : ""}`);
    if (source.excerpt) lines.push(`  - 摘录：${source.excerpt}`);
    if (source.description) lines.push(`  - 说明：${source.description}`);
  }
  return `${lines.join("\n")}\n`;
}
