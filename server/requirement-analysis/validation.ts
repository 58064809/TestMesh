import {
  RequirementAnalysisSchema,
  type AnalysisItemSchema,
  type ModelRequirementAnalysis,
  type RequirementAnalysis,
} from "./schema.js";
import { validateSourceLocator, type SourceFile } from "./sources.js";
import type { z } from "zod";

export class RequirementAnalysisValidationError extends Error {}

type AnalysisItem = z.infer<typeof AnalysisItemSchema>;

function analysisEntries(result: RequirementAnalysis): Array<{
  section: string;
  item: AnalysisItem & { issue_type?: "missing" | "ambiguity" | "conflict" };
}> {
  return [
    ...(result.summary ? [{ section: "summary", item: result.summary }] : []),
    ...result.requirements.map((item) => ({ section: "requirements", item })),
    ...result.actors.map((item) => ({ section: "actors", item })),
    ...result.business_rules.map((item) => ({ section: "business_rules", item })),
    ...result.flows.map((item) => ({ section: "flows", item })),
    ...result.states.map((item) => ({ section: "states", item })),
    ...result.constraints.map((item) => ({ section: "constraints", item })),
    ...result.exceptions.map((item) => ({ section: "exceptions", item })),
    ...result.open_questions.map((item) => ({ section: "open_questions", item })),
    ...result.sources.map((item) => ({ section: "sources", item })),
  ];
}

export function attachRequirementSources(
  result: ModelRequirementAnalysis,
  files: SourceFile[],
): RequirementAnalysis {
  const byId = new Map(files.map((file) => [file.id, file]));
  const sources = result.sources.map((source) => {
    const file = byId.get(source.source_file_id);
    if (!file) throw new Error(`来源引用 ${source.id} 引用了未知文件 ${source.source_file_id}`);
    return { ...source, source_file_name: file.name };
  });
  return RequirementAnalysisSchema.parse({ ...result, sources });
}

export function validateRequirementAnalysis(result: RequirementAnalysis, files: SourceFile[]): void {
  validateRequirementReferences(result);
  validateRequirementSourceLocations(result, files);
  validateRequirementIssues(result);
  validateSourcePriorityClaims(result);
}

export function validateRequirementReferences(result: RequirementAnalysis): void {
  const entries = analysisEntries(result);
  const itemIds = new Set<string>();
  for (const { item } of entries) {
    if (itemIds.has(item.id)) throw new Error(`需求分析条目 ID 重复：${item.id}`);
    itemIds.add(item.id);
  }
  const sourceIds = new Set(result.sources.map((source) => source.id));
  for (const { section, item } of entries) {
    for (const ref of item.source_refs) {
      if (!sourceIds.has(ref)) throw new Error(`需求分析条目 ${item.id} 引用了不存在的原文来源 ${ref}`);
    }
    const missingQuestion = section === "open_questions" && "issue_type" in item && item.issue_type === "missing";
    if (!missingQuestion && item.description && item.source_refs.length === 0 && section !== "sources") {
      throw new Error(`需求分析条目 ${item.id} 缺少原文来源`);
    }
  }
}

export function validateRequirementSourceLocations(
  result: RequirementAnalysis,
  files: SourceFile[],
): void {
  const fileById = new Map(files.map((file) => [file.id, file]));
  for (const source of result.sources) {
    const file = fileById.get(source.source_file_id);
    if (!file) throw new Error(`来源引用 ${source.id} 引用了未知文件`);
    if (source.source_file_name !== file.name) throw new Error(`来源引用 ${source.id} 的文件名不一致`);
    validateSourceLocator(file, source.locator_type, source.locator);
  }
}

export function validateRequirementIssues(result: RequirementAnalysis): void {
  for (const question of result.open_questions) {
    if (question.issue_type === "conflict" && new Set(question.source_refs).size < 2) {
      throw new Error(`冲突条目 ${question.id} 至少要关联相互矛盾的两处原文；单处表述歧义请作为待确认问题保留，不标成冲突`);
    }
  }
}

const SOURCE_PRIORITY_PATTERN = /(?:PRD|需求文档|补充说明|流程图|截图|来源|文档).{0,16}(?:优先|为准|覆盖)|(?:优先|以).{0,16}(?:PRD|需求文档|补充说明|流程图|截图|来源|文档).{0,8}(?:为准)?/i;
const NEGATED_PRIORITY_PATTERN = /(?:不存在|没有|不设|不假设|未定义|不得).{0,12}(?:来源)?优先/;

function isSourcePriorityClaim(description: string): boolean {
  return SOURCE_PRIORITY_PATTERN.test(description) && !NEGATED_PRIORITY_PATTERN.test(description);
}

export function validateSourcePriorityClaims(
  result: RequirementAnalysis,
  approvedRules: readonly string[] = [],
): void {
  const sourceById = new Map(result.sources.map((source) => [source.id, source]));
  for (const { section, item } of analysisEntries(result)) {
    if (section === "sources" || !isSourcePriorityClaim(item.description)) continue;
    if (approvedRules.includes(item.description)) continue;
    if (item.origin !== "explicit" || item.source_refs.length === 0) {
      throw new Error(`条目 ${item.id} 声明了来源优先级，但没有已批准规则或明确原文证据`);
    }
    const evidenceText = item.source_refs
      .map((reference) => sourceById.get(reference)?.excerpt ?? "")
      .join("\n");
    if (!isSourcePriorityClaim(evidenceText)) {
      throw new Error(`条目 ${item.id} 声明了来源优先级，但关联原文没有该规则`);
    }
  }
}
