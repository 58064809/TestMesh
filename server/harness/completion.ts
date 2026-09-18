import {
  ArtifactEnvelopeSchema,
  CompletionCheckSchema,
  CompletionReportSchema,
  StageProfileSchema,
  TaskManifestSchema,
  type CompletionReport,
} from "./contracts.js";

export function evaluateCompletion(input: {
  task: unknown;
  profile: unknown;
  artifact: unknown;
  checks: unknown[];
  completedAt?: string;
}): CompletionReport {
  const task = TaskManifestSchema.parse(input.task);
  const profile = StageProfileSchema.parse(input.profile);
  const artifact = ArtifactEnvelopeSchema.parse(input.artifact);
  const checks = input.checks.map((item) => CompletionCheckSchema.parse(item));
  const completedAt = input.completedAt ?? new Date().toISOString();

  const failures: Array<{ criterionId: string; message: string }> = [];
  if (task.stage !== profile.id || task.stage_profile_version !== profile.version) {
    failures.push({ criterionId: "stage_profile", message: "任务与 Stage Profile 不一致" });
  }
  if (artifact.task_id !== task.task_id || artifact.stage !== task.stage) {
    failures.push({ criterionId: "artifact_ownership", message: "Artifact 不属于当前任务或阶段" });
  }
  if (artifact.schema_name !== profile.output_schema.name || artifact.schema_version !== profile.output_schema.version) {
    failures.push({ criterionId: "artifact_schema", message: "Artifact Schema 与 Stage Profile 不一致" });
  }

  const expectedIds = new Set(profile.completion_criteria.map((item) => item.id));
  const receivedIds = new Set(checks.map((item) => item.criterion_id));
  if (receivedIds.size !== checks.length) failures.push({ criterionId: "completion_checks", message: "完成检查项不能重复" });
  for (const check of checks) {
    if (!expectedIds.has(check.criterion_id)) failures.push({ criterionId: check.criterion_id, message: "出现未声明的完成检查项" });
  }
  for (const criterion of profile.completion_criteria) {
    const check = checks.find((item) => item.criterion_id === criterion.id);
    if (!check) failures.push({ criterionId: criterion.id, message: "缺少完成检查结果" });
    else if (!check.passed) failures.push({ criterionId: criterion.id, message: check.message });
    else if (criterion.evidence_required && check.evidence_refs.length === 0) {
      failures.push({ criterionId: criterion.id, message: "完成检查缺少证据" });
    }
  }

  const report = {
    task_id: task.task_id,
    artifact_id: artifact.artifact_id,
    accepted: failures.length === 0,
    checks,
    failed_at: failures.map((item) => `${item.criterionId}: ${item.message}`).join("；"),
    completed_at: failures.length === 0 ? completedAt : "",
  };
  return CompletionReportSchema.parse(report);
}
