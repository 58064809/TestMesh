import { z } from "zod";

export const StageIdSchema = z.enum([
  "requirement_analysis",
  "test_design",
  "api_automation",
  "ui_automation",
  "failure_triage",
]);

export const HarnessRunStatusSchema = z.enum([
  "created",
  "preparing",
  "running",
  "waiting_human",
  "completed",
  "failed",
  "cancelled",
]);

const VersionSchema = z.string().regex(/^\d+\.\d+\.\d+$/, "版本需要使用 x.y.z 格式");
const IdSchema = z.string().trim().min(1);

export const TaskInputRefSchema = z.object({
  slot: IdSchema,
  kind: z.enum([
    "source",
    "analysis",
    "baseline",
    "human_decision",
    "test_scope",
    "test_case",
    "repository",
    "test_run",
  ]),
  id: IdSchema,
  required: z.boolean(),
}).strict();

export const TaskManifestSchema = z.object({
  task_id: IdSchema,
  stage: StageIdSchema,
  stage_profile_version: VersionSchema,
  input_refs: z.array(TaskInputRefSchema),
  requested_by: IdSchema,
  created_at: z.iso.datetime(),
}).strict().superRefine((value, context) => {
  const keys = value.input_refs.map((item) => `${item.slot}:${item.kind}:${item.id}`);
  if (new Set(keys).size !== keys.length) {
    context.addIssue({ code: "custom", path: ["input_refs"], message: "任务输入引用不能重复" });
  }
});

const AssemblyItemSchema = z.object({
  id: IdSchema,
  description: IdSchema,
  required: z.boolean(),
}).strict();

const SkillBindingSchema = AssemblyItemSchema.extend({
  version: VersionSchema,
  activation: z.enum(["always", "conditional"]),
}).strict();

const ToolBindingSchema = AssemblyItemSchema.extend({
  version: VersionSchema,
  mutating: z.boolean(),
  approval: z.enum(["never", "when_mutating", "always"]),
}).strict();

const PolicyBindingSchema = z.object({
  id: IdSchema,
  description: IdSchema,
  enforcement: z.enum(["instruction", "guardrail", "permission", "completion_gate"]),
}).strict();

const CompletionCriterionSchema = z.object({
  id: IdSchema,
  description: IdSchema,
  evidence_required: z.boolean(),
}).strict();

function uniqueIds<T extends { id: string }>(items: T[], path: string, context: z.RefinementCtx): void {
  if (new Set(items.map((item) => item.id)).size !== items.length) {
    context.addIssue({ code: "custom", path: [path], message: `${path} 中的 ID 不能重复` });
  }
}

export const StageProfileSchema = z.object({
  id: StageIdSchema,
  version: VersionSchema,
  description: IdSchema,
  context: z.array(AssemblyItemSchema),
  knowledge: z.array(AssemblyItemSchema),
  skills: z.array(SkillBindingSchema),
  tools: z.array(ToolBindingSchema),
  policies: z.array(PolicyBindingSchema),
  output_schema: z.object({
    name: IdSchema,
    version: VersionSchema,
  }).strict(),
  completion_criteria: z.array(CompletionCriterionSchema).min(1),
}).strict().superRefine((value, context) => {
  uniqueIds(value.context, "context", context);
  uniqueIds(value.knowledge, "knowledge", context);
  uniqueIds(value.skills, "skills", context);
  uniqueIds(value.tools, "tools", context);
  uniqueIds(value.policies, "policies", context);
  uniqueIds(value.completion_criteria, "completion_criteria", context);
});

export const ArtifactEvidenceRefSchema = z.object({
  kind: z.enum(["source", "knowledge", "decision", "runner", "trace"]),
  id: IdSchema,
}).strict();

export const ArtifactEnvelopeSchema = z.object({
  artifact_id: IdSchema,
  task_id: IdSchema,
  stage: StageIdSchema,
  schema_name: IdSchema,
  schema_version: VersionSchema,
  status: z.enum(["candidate", "accepted", "rejected"]),
  evidence_refs: z.array(ArtifactEvidenceRefSchema),
  payload: z.unknown(),
  created_at: z.iso.datetime(),
}).strict();

export const CompletionCheckSchema = z.object({
  criterion_id: IdSchema,
  passed: z.boolean(),
  message: IdSchema,
  evidence_refs: z.array(ArtifactEvidenceRefSchema),
}).strict();

export const CompletionReportSchema = z.object({
  task_id: IdSchema,
  artifact_id: IdSchema,
  accepted: z.boolean(),
  checks: z.array(CompletionCheckSchema),
  failed_at: z.string(),
  completed_at: z.union([z.iso.datetime(), z.literal("")]),
}).strict();

export type StageId = z.infer<typeof StageIdSchema>;
export type TaskManifest = z.infer<typeof TaskManifestSchema>;
export type StageProfile = z.infer<typeof StageProfileSchema>;
export type ArtifactEnvelope = z.infer<typeof ArtifactEnvelopeSchema>;
export type CompletionReport = z.infer<typeof CompletionReportSchema>;
