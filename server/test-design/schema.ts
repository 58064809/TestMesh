import { z } from "zod";

export const TestTechniqueSchema = z.enum([
  "scenario",
  "equivalence_partition",
  "boundary_value",
  "decision_table",
  "state_transition",
  "combinatorial",
  "property_based",
]);

export const TestScenarioTypeSchema = z.enum([
  "normal", "exception", "boundary", "rule_combination", "state_transition", "cross_business",
]);

export const TestStepSchema = z.object({
  order: z.number().int().positive(),
  action: z.string().min(1),
  expected: z.string().min(1),
}).strict();

export const TestConditionCategorySchema = z.enum([
  "normal", "alternate", "negative", "boundary", "rule_combination",
  "valid_transition", "invalid_transition", "dependency_failure", "recovery", "cross_business",
]);

export const TestConditionSchema = z.object({
  id: z.string().regex(/^TCND-\d{3}$/),
  title: z.string().min(1),
  objective: z.string().min(1),
  primary_trace_ref: z.string().min(1),
  category: TestConditionCategorySchema,
  technique: TestTechniqueSchema,
  rationale: z.string().min(1),
  source_refs: z.array(z.string().min(1)).min(1),
}).strict();

export const TestRiskSchema = z.object({
  id: z.string().regex(/^RISK-\d{3}$/),
  title: z.string().min(1),
  description: z.string().min(1),
  likelihood: z.enum(["low", "medium", "high"]),
  impact: z.enum(["low", "medium", "high"]),
  rationale: z.string().min(1),
  trace_refs: z.array(z.string().min(1)).min(1),
  source_refs: z.array(z.string().min(1)).min(1),
}).strict();

export const TestPointSchema = z.object({
  id: z.string().regex(/^TP-\d{3}$/),
  title: z.string().min(1),
  objective: z.string().min(1),
  technique: TestTechniqueSchema,
  technique_rationale: z.string().min(1),
  trace_refs: z.array(z.string().min(1)).min(1),
  risk_refs: z.array(z.string().min(1)),
  source_refs: z.array(z.string().min(1)).min(1),
}).strict();

export const TestCaseSchema = z.object({
  id: z.string().regex(/^TC-\d{3}$/),
  module: z.string().min(1).optional(),
  title: z.string().min(1),
  objective: z.string().min(1),
  primary_trace_ref: z.string().min(1).optional(),
  primary_test_condition_ref: z.string().min(1).optional(),
  test_condition_refs: z.array(z.string().min(1)).optional(),
  scenario_type: TestScenarioTypeSchema.optional(),
  technique: TestTechniqueSchema.optional(),
  priority: z.enum(["P0", "P1", "P2", "P3"]),
  preconditions: z.array(z.string().min(1)),
  test_data: z.array(z.string().min(1)).optional(),
  steps: z.array(TestStepSchema).min(1).optional(),
  gherkin: z.string().min(1),
  trace_refs: z.array(z.string().min(1)).min(1),
  risk_refs: z.array(z.string().min(1)),
  test_point_refs: z.array(z.string().min(1)).min(1),
  source_refs: z.array(z.string().min(1)).min(1),
}).strict();

export const ToolApplicationSchema = z.object({
  tool: z.enum(["cucumber_gherkin", "fast_check", "nist_acts", "graphwalker"]),
  status: z.enum(["applied", "not_applicable"]),
  reason: z.string().min(1),
}).strict();

export const CoverageExclusionSchema = z.object({
  trace_ref: z.string().min(1),
  reason: z.string().min(1),
}).strict();

export const CoverageEntrySchema = z.object({
  test_point_refs: z.array(z.string().min(1)),
  test_case_refs: z.array(z.string().min(1)),
  exclusion_reason: z.string(),
}).strict();

export const TestDesignSchema = z.object({
  objective: z.string().min(1),
  risks: z.array(TestRiskSchema),
  test_points: z.array(TestPointSchema).min(1),
  test_conditions: z.array(TestConditionSchema).optional(),
  test_cases: z.array(TestCaseSchema).min(1),
  tool_applications: z.array(ToolApplicationSchema).length(4),
  coverage_exclusions: z.array(CoverageExclusionSchema),
  coverage: z.record(z.string(), CoverageEntrySchema),
}).strict();

export const TestDesignPlanSchema = TestDesignSchema.pick({
  objective: true,
  risks: true,
  test_points: true,
  test_conditions: true,
  tool_applications: true,
  coverage_exclusions: true,
}).extend({
  test_conditions: z.array(TestConditionSchema).min(1),
}).strict();

export function createModelTestCaseSchema() {
  return TestCaseSchema.extend({
    module: z.string().min(1),
    primary_trace_ref: z.string().min(1),
    primary_test_condition_ref: z.string().min(1),
    test_condition_refs: z.array(z.string().min(1)).min(1),
    scenario_type: TestScenarioTypeSchema,
    technique: TestTechniqueSchema,
    test_data: z.array(z.string().min(1)),
    steps: z.array(TestStepSchema).min(1),
  }).strict();
}

export function createTestCaseBatchSchema(obligations: readonly { conditionId: string; caseId: string; traceRef: string }[]) {
  const modelTestCaseSchema = createModelTestCaseSchema();
  return z.object({
    cases: z.object(Object.fromEntries(obligations.map(({ conditionId, caseId, traceRef }) => [
      conditionId,
      modelTestCaseSchema.extend({
        id: z.literal(caseId),
        primary_trace_ref: z.literal(traceRef),
        primary_test_condition_ref: z.literal(conditionId),
        test_condition_refs: z.tuple([z.literal(conditionId)]),
      }).strict(),
    ]))).strict(),
  }).strict();
}

export function createModelTestDesignSchema(requiredCoverage: readonly string[]) {
  const coverageShape = Object.fromEntries(requiredCoverage.map((id) => [id, CoverageEntrySchema]));
  const modelTestCaseSchema = createModelTestCaseSchema();
  return TestDesignSchema.extend({
    test_conditions: z.array(TestConditionSchema).min(1),
    test_cases: z.array(modelTestCaseSchema).min(1),
    coverage: z.object(coverageShape).strict(),
  }).strict();
}

export type TestDesign = z.infer<typeof TestDesignSchema>;
export type TestCase = z.infer<typeof TestCaseSchema>;
export type TestDesignPlan = z.infer<typeof TestDesignPlanSchema>;

export const BaselineAcceptedItemSchema = z.object({
  section: z.enum([
    "summary", "requirements", "actors", "business_rules", "flows",
    "states", "constraints", "exceptions", "open_questions",
  ]),
  item: z.object({
    id: z.string().min(1),
    description: z.string(),
    source_refs: z.array(z.string()),
  }).passthrough(),
  mergedFrom: z.array(z.string()).default([]),
  review: z.object({
    status: z.literal("accepted"),
    decision: z.string().default(""),
    decisionBy: z.string().default(""),
    prdRevision: z.string().default(""),
  }).passthrough(),
}).strict();

export const BaselineSnapshotSchema = z.object({
  accepted: z.array(BaselineAcceptedItemSchema),
  reviews: z.array(z.unknown()),
  sourceRefs: z.array(z.object({
    id: z.string().min(1),
    source_file_id: z.string().min(1),
    source_file_name: z.string().min(1),
    locator_type: z.string().min(1),
    locator: z.string(),
    excerpt: z.string(),
    description: z.string(),
  }).passthrough()),
}).strict();

export type BaselineSnapshot = z.infer<typeof BaselineSnapshotSchema>;

export type TestCaseReviewStatus = "accepted" | "rejected";

export interface TestDesignRecord {
  id: string;
  baselineId: string;
  status: "draft" | "approved";
  model: string;
  document: TestDesign;
  traceProvider: string;
  traceProjectName: string;
  traceId: string;
  createdAt: string;
}

export interface TestCaseReviewRecord {
  id: string;
  designId: string;
  testCaseId: string;
  status: TestCaseReviewStatus;
  reviewer: string;
  reason: string;
  createdAt: string;
}

export interface ApprovedTestCaseVersionRecord {
  id: string;
  designId: string;
  version: number;
  approvedBy: string;
  approvedAt: string;
}
