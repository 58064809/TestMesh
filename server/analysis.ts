import { z } from "zod";
import {
  type SourceFile,
} from "./requirement-analysis/sources.js";
import {
  MAX_OUTPUT_TOKENS,
  MODEL_CONTEXT_TOKENS,
} from "./requirement-analysis/config.js";
export {
  MAX_OUTPUT_TOKENS,
  MODEL,
  MODEL_CONTEXT_TOKENS,
} from "./requirement-analysis/config.js";
export {
  ACCEPTED_EXTENSIONS,
  MAX_FILE_BYTES,
  MAX_FILES,
  buildSourceInput,
  createSources,
  extensionOf,
  formatTextWithParagraphs,
  isAcceptedFilename,
  locationCapability,
  normalizeUploadFilename,
} from "./requirement-analysis/sources.js";
export type {
  LocationCapability,
  SourceFile,
  SourceScope,
  UploadLike,
} from "./requirement-analysis/sources.js";
export {
  ModelRequirementAnalysisSchema,
  RequirementAnalysisSchema,
} from "./requirement-analysis/schema.js";
export type {
  ModelRequirementAnalysis,
  RequirementAnalysis,
} from "./requirement-analysis/schema.js";
export {
  RequirementAnalysisValidationError,
  attachRequirementSources,
  validateRequirementAnalysis,
} from "./requirement-analysis/validation.js";

// Current GPT-5.6 Luna pricing applies a 2x input and 1.5x output multiplier
// above 272K input tokens. Implicit prompt caching is disabled below, so the
// maximum token cost is bounded by the context window and this output cap.
export function worstCaseTokenCostUsd(maxOutputTokens = MAX_OUTPUT_TOKENS): number {
  const maximumInputTokens = MODEL_CONTEXT_TOKENS - maxOutputTokens;
  const inputCost = (maximumInputTokens / 1_000_000) * 0.4;
  const outputCost = (maxOutputTokens / 1_000_000) * 1.8;
  return inputCost + outputCost;
}

const ModelEvidenceSchema = z.object({
  id: z.string().min(1),
  sourceId: z.string().min(1),
  locatorType: z.enum(["page", "paragraph", "image", "limited"]),
  locator: z.string(),
  excerpt: z.string(),
  note: z.string(),
});

const analysisFields = {
  summary: z.string().min(1),
  requirements: z.array(
    z.object({
      id: z.string().min(1),
      title: z.string().min(1),
      description: z.string().min(1),
      priority: z.enum(["must", "should", "could"]),
      acceptanceCriteria: z.array(z.string().min(1)),
      evidenceIds: z.array(z.string().min(1)),
    }),
  ),
  risks: z.array(
    z.object({
      id: z.string().min(1),
      title: z.string().min(1),
      description: z.string().min(1),
      severity: z.enum(["high", "medium", "low"]),
      mitigation: z.string().min(1),
      evidenceIds: z.array(z.string().min(1)),
    }),
  ),
  pendingQuestions: z.array(
    z.object({
      id: z.string().min(1),
      question: z.string().min(1),
      reason: z.string().min(1),
      relatedRequirementIds: z.array(z.string().min(1)),
    }),
  ),
};

const ModelAnalysisSchema = z.object({
  ...analysisFields,
  evidence: z.array(ModelEvidenceSchema).min(1),
});

export const AnalysisSchema = z.object({
  ...analysisFields,
  evidence: z.array(ModelEvidenceSchema.extend({ sourceName: z.string().min(1) })).min(1),
});

export type AnalysisResult = z.infer<typeof AnalysisSchema>;
export type Evidence = AnalysisResult["evidence"][number];
type ModelAnalysisResult = z.infer<typeof ModelAnalysisSchema>;

export function validateEvidenceSources(result: AnalysisResult, sources: SourceFile[]): void {
  const sourceById = new Map(sources.map((source) => [source.id, source]));
  const evidenceIds = new Set(result.evidence.map((item) => item.id));

  for (const evidence of result.evidence) {
    const source = sourceById.get(evidence.sourceId);
    if (!source) {
      throw new Error(`Evidence ${evidence.id} 引用了未知来源 ${evidence.sourceId}`);
    }
    if (evidence.sourceName !== source.name) {
      throw new Error(`Evidence ${evidence.id} 的来源名称与 ${evidence.sourceId} 不一致`);
    }
    if (source.capability === "limited" && evidence.locatorType !== "limited") {
      throw new Error(`Evidence ${evidence.id} 对定位受限格式给出了未经保证的位置`);
    }
  }

  const references = [
    ...result.requirements.flatMap((item) => item.evidenceIds),
    ...result.risks.flatMap((item) => item.evidenceIds),
  ];
  for (const evidenceId of references) {
    if (!evidenceIds.has(evidenceId)) {
      throw new Error(`分析条目引用了不存在的 Evidence ${evidenceId}`);
    }
  }
}

export function attachEvidenceSourceNames(
  result: ModelAnalysisResult,
  sources: SourceFile[],
): AnalysisResult {
  const validated = ModelAnalysisSchema.parse(result);
  const sourceById = new Map(sources.map((source) => [source.id, source]));
  const evidence = validated.evidence.map((item) => {
    const source = sourceById.get(item.sourceId);
    if (!source) {
      throw new Error(`Evidence ${item.id} 引用了未知来源 ${item.sourceId}`);
    }
    return { ...item, sourceName: source.name };
  });

  return AnalysisSchema.parse({ ...validated, evidence });
}
