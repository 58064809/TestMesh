import type { RequirementAnalysis } from "../requirement-analysis/schema.js";
import type { AnalysisReviewRecord } from "../requirement-analysis/postgres-store.js";

export type AiQualityProfileStatus = "pending" | "approved" | "retired";

export interface AiQualityCriteria {
  minimumOpenQuestions: number;
  requiredIssueTypes: Array<"missing" | "ambiguity" | "conflict">;
  requiredTopicGroups: string[][];
  maximumAgentLatencyMs: number;
  maximumTotalTokens: number;
}

export interface PhoenixEvidence {
  endpoint: string;
  projectName: string;
  datasetId: string;
  experimentId: string;
  traceId: string;
}

export interface AiQualityProfile {
  id: string;
  name: string;
  version: string;
  status: AiQualityProfileStatus;
  targetName: string;
  targetVersion: string;
  environment: string;
  sourceAnalysisId: string;
  sourceFilename: string;
  sourceSha256: string;
  criteria: AiQualityCriteria;
  phoenix: PhoenixEvidence;
  approvedBy: string;
  approvalNote: string;
  approvedAt: string | null;
  createdAt: string;
}

export interface ProfileReadiness {
  ready: boolean;
  totalOpenQuestions: number;
  reviewedOpenQuestions: number;
  blockers: string[];
}

export function assessProfileReadiness(
  document: RequirementAnalysis,
  reviews: AnalysisReviewRecord[],
): ProfileReadiness {
  const openQuestions = document.open_questions;
  const latestByItem = new Map(reviews.map((review) => [review.itemId, review]));
  const unfinished = openQuestions.filter((item) => {
    const review = latestByItem.get(item.id);
    return !review || review.status === "clarify";
  });
  const reviewedOpenQuestions = openQuestions.length - unfinished.length;
  const blockers = unfinished.length
    ? [`仍有 ${unfinished.length} 条待确认问题未完成评审：${unfinished.map((item) => item.id).join("、")}`]
    : [];
  return {
    ready: blockers.length === 0,
    totalOpenQuestions: openQuestions.length,
    reviewedOpenQuestions,
    blockers,
  };
}
