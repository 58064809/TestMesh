import { z } from "zod";

export const QualityCharacteristicSchema = z.enum([
  "functional_suitability",
  "performance_efficiency",
  "compatibility",
  "interaction_capability",
  "reliability",
  "security",
  "maintainability",
  "flexibility",
  "safety",
  "ai_validity_reliability",
  "ai_transparency_traceability",
  "ai_intent_recognition",
  "ai_multi_turn_context",
  "ai_constraint_adherence",
  "ai_response_correctness",
  "ai_groundedness_hallucination",
  "ai_safety_refusal",
  "ai_parameter_extraction",
  "ai_tool_use_correctness",
  "ai_robustness_consistency",
]);

const NonEmptyList = z.array(z.string().trim().min(1)).max(100);

export const QualityRiskSchema = z.object({
  id: z.string().trim().min(1).max(40),
  title: z.string().trim().min(1).max(200),
  probability: z.enum(["low", "medium", "high"]),
  impact: z.enum(["low", "medium", "high"]),
  treatment: z.string().trim().min(1).max(1_000),
  owner: z.string().trim().min(1).max(100),
}).strict();

export const ReleaseGateRulesSchema = z.object({
  requireApprovedBaseline: z.boolean().default(true),
  requireApprovedTestModel: z.boolean().default(true),
  requireApprovedTestCases: z.boolean().default(true),
  minimumRequirementCoveragePct: z.number().min(0).max(100).default(100),
  minimumTraceabilityCompletenessPct: z.number().min(0).max(100).default(100),
  minimumTestDataSpecificationCoveragePct: z.number().min(0).max(100).default(100),
  minimumAssertionDesignCoveragePct: z.number().min(0).max(100).default(100),
  minimumExecutionCompletenessPct: z.number().min(0).max(100).default(100),
  minimumExecutionPassRatePct: z.number().min(0).max(100).default(100),
  minimumFailureTriageCoveragePct: z.number().min(0).max(100).default(100),
  maximumFailedTests: z.number().int().min(0).default(0),
  requireApiExecution: z.boolean().default(false),
  requireUiExecution: z.boolean().default(false),
  requireApprovedAiQualityProfile: z.boolean().default(false),
  maximumOpenImprovementActions: z.number().int().min(0).default(0),
}).strict();

export const QualityPlanInputSchema = z.object({
  projectId: z.string().trim().min(1),
  name: z.string().trim().min(1).max(120),
  release: z.string().trim().min(1).max(80),
  owner: z.string().trim().min(1).max(100),
  objectives: NonEmptyList.min(1, "至少填写一个质量目标"),
  qualityCharacteristics: z.array(QualityCharacteristicSchema).min(1, "至少选择一个质量属性"),
  risks: z.array(QualityRiskSchema).max(100).default([]),
  scope: z.string().trim().min(1).max(4_000),
  exclusions: NonEmptyList.default([]),
  strategies: NonEmptyList.min(1, "至少填写一项测试策略"),
  entryCriteria: NonEmptyList.min(1, "至少填写一项准入条件"),
  exitCriteria: NonEmptyList.min(1, "至少填写一项准出条件"),
  requiredEvidence: NonEmptyList.min(1, "至少填写一项必需证据"),
  approvers: NonEmptyList.min(1, "至少填写一名批准人"),
  baselineId: z.string().trim().default(""),
  approvedTestModelVersionId: z.string().trim().default(""),
  approvedTestCaseVersionId: z.string().trim().default(""),
  aiQualityProfileId: z.string().trim().default(""),
  gateRules: ReleaseGateRulesSchema,
}).strict();

export const QualityPlanApprovalSchema = z.object({
  approvedBy: z.string().trim().min(1),
  note: z.string().trim().max(1_000).default(""),
}).strict();

export const ImprovementActionInputSchema = z.object({
  sourceType: z.enum(["release_gate", "failure_triage", "retrospective", "manual"]),
  sourceId: z.string().trim().default(""),
  title: z.string().trim().min(1).max(200),
  rootCauseCategory: z.enum(["requirement", "design", "code", "test", "environment", "data", "process", "ai_quality", "unknown"]),
  action: z.string().trim().min(1).max(2_000),
  owner: z.string().trim().min(1).max(100),
  dueDate: z.string().date().or(z.literal("")),
}).strict();

export const ImprovementActionUpdateSchema = z.object({
  status: z.enum(["open", "in_progress", "verified", "closed"]),
  verificationEvidence: z.string().trim().max(2_000).default(""),
  updatedBy: z.string().trim().min(1),
}).strict().superRefine((value, context) => {
  if ((value.status === "verified" || value.status === "closed") && !value.verificationEvidence) {
    context.addIssue({ code: "custom", path: ["verificationEvidence"], message: "验证或关闭改进项必须填写验证证据" });
  }
});

export const RiskAcceptanceSchema = z.object({
  acceptedBy: z.string().trim().min(1),
  reason: z.string().trim().min(1).max(2_000),
  expiresAt: z.string().datetime().nullable().default(null),
}).strict();

export type QualityPlanInput = z.infer<typeof QualityPlanInputSchema>;
export type ImprovementActionInput = z.infer<typeof ImprovementActionInputSchema>;
export type ImprovementActionUpdate = z.infer<typeof ImprovementActionUpdateSchema>;
export type RiskAcceptanceInput = z.infer<typeof RiskAcceptanceSchema>;
