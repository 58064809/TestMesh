import { randomUUID } from "node:crypto";
import { evaluateCompletion } from "../harness/completion.js";
import {
  ArtifactEnvelopeSchema,
  type ArtifactEnvelope,
  type CompletionReport,
  type TaskManifest,
} from "../harness/contracts.js";
import { RequirementAnalysisStageProfile } from "../harness/profiles/requirement-analysis.js";
import { RequirementAnalysisSchema, type RequirementAnalysis } from "./schema.js";
import type { SourceFile } from "./sources.js";
import {
  validateRequirementIssues,
  validateRequirementReferences,
  validateRequirementSourceLocations,
  validateSourcePriorityClaims,
} from "./validation.js";

interface GateCheckResult {
  passed: boolean;
  message: string;
  evidenceIds: string[];
}

function check(
  action: () => void,
  successMessage: string,
  evidenceIds: string[] = [],
): GateCheckResult {
  try {
    action();
    return { passed: true, message: successMessage, evidenceIds };
  } catch (error) {
    return {
      passed: false,
      message: error instanceof Error ? error.message : "完成条件校验失败",
      evidenceIds: [],
    };
  }
}

function candidateEvidenceIds(candidate: RequirementAnalysis): string[] {
  return [...new Set(candidate.sources.map((source) => source.id))];
}

export function evaluateRequirementAnalysisCompletion(input: {
  task: TaskManifest;
  candidate: unknown;
  sources: SourceFile[];
  artifactId?: string;
  approvedSourcePriorityRules?: readonly string[];
  completedAt?: string;
}): { artifact: ArtifactEnvelope; report: CompletionReport } {
  const parsed = RequirementAnalysisSchema.safeParse(input.candidate);
  const candidate = parsed.success ? parsed.data : null;
  const evidenceIds = candidate ? candidateEvidenceIds(candidate) : [];
  const schemaCheck: GateCheckResult = parsed.success
    ? { passed: true, message: "固定十字段 RequirementAnalysis Schema 校验通过", evidenceIds: [] }
    : {
      passed: false,
      message: `RequirementAnalysis Schema 校验失败：${parsed.error.message}`,
      evidenceIds: [],
    };
  const blockedBySchema = (): never => {
    throw new Error("RequirementAnalysis Schema 未通过，不能继续完成条件校验");
  };
  const checks = [
    { criterion_id: "schema_valid", ...schemaCheck },
    {
      criterion_id: "references_valid",
      ...check(
        () => candidate ? validateRequirementReferences(candidate) : blockedBySchema(),
        "所有结论均回链当前候选结果中的来源",
        evidenceIds,
      ),
    },
    {
      criterion_id: "source_locations_valid",
      ...check(
        () => candidate ? validateRequirementSourceLocations(candidate, input.sources) : blockedBySchema(),
        "来源文件、定位类型和定位信息均可核对",
        evidenceIds,
      ),
    },
    {
      criterion_id: "issues_valid",
      ...check(
        () => candidate ? validateRequirementIssues(candidate) : blockedBySchema(),
        "缺失、歧义和冲突分类及证据数量合法",
        evidenceIds,
      ),
    },
    {
      criterion_id: "source_priority_valid",
      ...check(
        () => candidate
          ? validateSourcePriorityClaims(candidate, input.approvedSourcePriorityRules)
          : blockedBySchema(),
        "没有擅自设定来源优先级",
        evidenceIds,
      ),
    },
  ].map(({ evidenceIds: ids, ...item }) => ({
    ...item,
    evidence_refs: ids.map((id) => ({ kind: "source" as const, id })),
  }));

  const artifact = ArtifactEnvelopeSchema.parse({
    artifact_id: input.artifactId ?? randomUUID(),
    task_id: input.task.task_id,
    stage: "requirement_analysis",
    schema_name: RequirementAnalysisStageProfile.output_schema.name,
    schema_version: RequirementAnalysisStageProfile.output_schema.version,
    status: "candidate",
    evidence_refs: evidenceIds.map((id) => ({ kind: "source" as const, id })),
    payload: input.candidate,
    created_at: input.completedAt ?? new Date().toISOString(),
  });
  const report = evaluateCompletion({
    task: input.task,
    profile: RequirementAnalysisStageProfile,
    artifact,
    checks,
    completedAt: input.completedAt,
  });
  return { artifact, report };
}
