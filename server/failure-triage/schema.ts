import { z } from "zod";

export const FailureRunKindSchema = z.enum(["api_schema", "api_scenario", "ui"]);
export type FailureRunKind = z.infer<typeof FailureRunKindSchema>;

export const FailureDiagnosisRequestSchema = z.object({
  runKind: FailureRunKindSchema,
  runId: z.string().trim().min(1, "请选择失败 TestRun"),
}).strict();
export type FailureDiagnosisRequest = z.infer<typeof FailureDiagnosisRequestSchema>;

export const FailureDiagnosisContextSchema = z.object({
  projectId: z.string().trim().min(1, "请选择项目"),
  environmentId: z.string().trim().min(1, "请选择测试环境"),
  runKind: FailureRunKindSchema,
  runId: z.string().trim().min(1, "请选择失败 TestRun"),
  approvedVersionId: z.string().default(""),
  approvedTestCaseIds: z.array(z.string()).default([]),
}).strip();
export type FailureDiagnosisContext = z.infer<typeof FailureDiagnosisContextSchema>;

export const FailureEvidenceSchema = z.object({
  id: z.string().min(1),
  category: z.enum(["reporter", "test_case", "test_run", "assertion", "http", "runner", "artifact", "telemetry", "database", "middleware", "source_code"]),
  title: z.string().min(1),
  content: z.string().min(1),
  locator: z.string().min(1),
  direct: z.boolean().default(false),
}).strict();
export type FailureEvidence = z.infer<typeof FailureEvidenceSchema>;

const EvidenceFindingSchema = z.object({
  statement: z.string().min(1),
  evidence_refs: z.array(z.string().min(1)).min(1),
}).strict();

const HypothesisSchema = z.object({
  cause: z.string().min(1),
  confidence: z.enum(["low", "medium", "high"]),
  supporting_evidence_refs: z.array(z.string().min(1)).min(1),
  contradicting_evidence_refs: z.array(z.string().min(1)).default([]),
}).strict();

export const FailureTriageSchema = z.object({
  status: z.enum(["located", "suspected", "insufficient_evidence"]),
  failure_layer: z.enum([
    "test_script", "frontend", "gateway", "backend", "database", "cache",
    "message_queue", "third_party", "environment", "unknown",
  ]),
  summary: z.string().min(1),
  suspected_components: z.array(z.string().min(1)).max(12),
  facts: z.array(EvidenceFindingSchema).min(1),
  hypotheses: z.array(HypothesisSchema).max(8),
  source_locations: z.array(z.object({
    repository: z.string(),
    commit: z.string(),
    file: z.string().min(1),
    line: z.number().int().positive().nullable(),
    evidence_refs: z.array(z.string().min(1)).min(1),
  }).strict()).default([]),
  database_findings: z.array(z.object({
    statement: z.string().min(1),
    query_summary: z.string().min(1),
    evidence_refs: z.array(z.string().min(1)).min(1),
  }).strict()).default([]),
  missing_evidence: z.array(z.string().min(1)),
  next_checks: z.array(z.string().min(1)).min(1).max(12),
  submission_draft: z.object({
    title: z.string().min(2),
    severity: z.enum(["blocker", "critical", "major", "minor", "trivial", "undetermined"]),
    steps: z.array(z.string().min(1)).min(1),
    expected: z.string().min(1),
    actual: z.string().min(1),
    technical_analysis: z.string().min(1),
    attachment_evidence_refs: z.array(z.string().min(1)),
  }).strict(),
}).strict();
export type FailureTriage = z.infer<typeof FailureTriageSchema>;

export interface FailureRunOption {
  kind: FailureRunKind;
  id: string;
  projectId: string;
  environmentId: string;
  label: string;
  status: "failed" | "error";
  startedAt: string;
  failed: number;
}

export interface FailureTriageRecord {
  id: string;
  taskId: string;
  input: FailureDiagnosisContext;
  evidence: FailureEvidence[];
  result: FailureTriage;
  model: string;
  traceProvider: string;
  traceProjectName: string;
  traceId: string;
  createdAt: string;
}
