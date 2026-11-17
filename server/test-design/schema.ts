import { z } from "zod";

export const TestTechniqueSchema = z.enum([
  "scenario",
  "equivalence_partition",
  "boundary_value",
  "decision_table",
  "state_transition",
  "combinatorial",
  "property_based",
  "ai_evaluation",
]);

export const TestScenarioTypeSchema = z.enum([
  "normal", "exception", "boundary", "rule_combination", "state_transition", "cross_business", "ai_behavior",
]);

const BusinessScenarioTypeSchema = z.enum([
  "normal", "exception", "boundary", "rule_combination", "state_transition", "cross_business",
]);

const BusinessTestTechniqueSchema = z.enum([
  "scenario", "equivalence_partition", "boundary_value", "decision_table",
  "state_transition", "combinatorial", "property_based",
]);

export const TestStepSchema = z.object({
  order: z.number().int().positive(),
  action: z.string().min(1),
  expected: z.string().min(1),
}).strict();

export const TestConditionCategorySchema = z.enum([
  "normal", "alternate", "negative", "boundary", "rule_combination",
  "valid_transition", "invalid_transition", "dependency_failure", "recovery", "cross_business",
  "intent_recognition", "multi_turn_context", "constraint_adherence", "response_correctness",
  "groundedness_hallucination", "safety_refusal", "parameter_extraction", "tool_use", "robustness_consistency",
]);

export const AiTestDimensionSchema = z.enum([
  "intent_recognition", "multi_turn_context", "constraint_adherence", "response_correctness",
  "groundedness_hallucination", "safety_refusal", "parameter_extraction", "tool_selection", "tool_invocation", "robustness_consistency",
]);

export const AiEvaluationSubjectSchema = z.enum(["testmesh", "target_application"]);
export const AiEvaluationLayerSchema = z.enum([
  "agent_decision", "tool_execution", "business_outcome", "final_response",
]);

export const PARAMETER_EXTRACTION_ASPECTS = [
  "parameter_identification", "value_accuracy", "completeness", "no_redundancy", "type_conformance",
  "semantic_normalization", "ambiguity_handling", "negation_exclusion", "multi_value", "conflict_resolution",
  "context_inheritance", "context_override", "required_missing_clarification", "business_constraint",
  "noise_robustness", "tool_parameter_mapping", "repeatability", "prompt_injection_resistance",
] as const;

export const ParameterExtractionAspectSchema = z.enum(PARAMETER_EXTRACTION_ASPECTS);

export const ParameterExtractionEvaluationSchema = z.object({
  layer: z.enum(["semantic_extraction", "structure_business_validation", "tool_parameter_mapping"]),
  aspect: ParameterExtractionAspectSchema,
  slot_name: z.string().min(1),
  expected_presence: z.boolean(),
  expected_value_json: z.string().min(1),
  expected_type: z.enum(["string", "integer", "number", "boolean", "date", "time", "datetime", "currency", "array", "object", "missing", "null"]),
  match_type: z.enum(["exact", "normalized", "range", "set", "semantic", "schema", "context_state", "tool_mapping", "absence", "human_review"]),
  normalization_rule: z.string().min(1),
  tolerance: z.string().min(1),
  expected_action: z.enum(["extract", "clarify", "reject", "execute"]),
  state_target: z.enum(["slot_delta", "merged_slots", "tool_arguments", "not_applicable"]),
  reference_datetime: z.string().min(1),
  timezone: z.string().min(1),
  locale: z.string().min(1),
  schema_version: z.string().min(1),
  risk_level: z.enum(["P0", "P1", "P2", "P3"]),
}).strict();

export const ParameterExtractionAssessmentSchema = z.object({
  status: z.enum(["applicable", "not_applicable", "blocked"]),
  implementation_pattern: z.enum(["traditional_nlu", "structured_output", "function_calling", "agent_workflow", "unknown"]),
  reason: z.string().min(1),
  source_refs: z.array(z.string().min(1)),
  schema_version: z.string().min(1),
  aspects: z.array(z.object({
    aspect: ParameterExtractionAspectSchema,
    status: z.enum(["planned", "not_applicable"]),
    condition_refs: z.array(z.string().min(1)),
    reason: z.string().min(1),
  }).strict()),
}).strict();

export const AiEvaluationSchema = z.object({
  dimension: AiTestDimensionSchema,
  evaluation_subjects: z.array(AiEvaluationSubjectSchema).min(1).optional(),
  evaluation_layers: z.array(AiEvaluationLayerSchema).min(1).optional(),
  oracle_type: z.enum(["exact_match", "contains", "regex", "reference_answer", "code_evaluator", "llm_judge", "human_review"]),
  expected_behavior: z.string().min(1),
  evaluator: z.string().min(1),
  threshold: z.string().min(1),
  dataset_requirements: z.array(z.string().min(1)).min(1),
  evidence_requirements: z.array(z.string().min(1)).min(1),
  parameter_extraction: ParameterExtractionEvaluationSchema.optional(),
}).strict();

const ModelAiEvaluationSchema = AiEvaluationSchema.extend({
  parameter_extraction: ParameterExtractionEvaluationSchema.nullable(),
  evaluation_subjects: z.array(AiEvaluationSubjectSchema).min(1),
  evaluation_layers: z.array(AiEvaluationLayerSchema).min(1),
}).strict();

export const TestConditionSchema = z.object({
  id: z.string().regex(/^TCND-\d{3}$/),
  title: z.string().min(1),
  objective: z.string().min(1),
  primary_trace_ref: z.string().min(1),
  category: TestConditionCategorySchema,
  technique: TestTechniqueSchema,
  rationale: z.string().min(1),
  source_refs: z.array(z.string().min(1)).min(1),
  knowledge_refs: z.array(z.string().min(1)).default([]),
  ai_dimension: AiTestDimensionSchema.optional(),
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
  knowledge_refs: z.array(z.string().min(1)).default([]),
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
  knowledge_refs: z.array(z.string().min(1)).default([]),
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
  knowledge_refs: z.array(z.string().min(1)).default([]),
  ai_evaluation: AiEvaluationSchema.optional(),
}).strict();

export const ToolApplicationSchema = z.object({
  tool: z.enum(["cucumber_gherkin", "fast_check", "nist_acts", "graphwalker", "phoenix_evals"]),
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

export const KnowledgeEvidenceSchema = z.object({
  chunk_id: z.string().min(1),
  document_id: z.string().min(1),
  filename: z.string().min(1),
  score: z.number(),
  text: z.string().min(1),
  headings: z.array(z.string()),
  page_numbers: z.array(z.number().int().positive()),
  doc_items: z.array(z.string()),
}).strict();

export const TestDesignSchema = z.object({
  objective: z.string().min(1),
  risks: z.array(TestRiskSchema),
  test_points: z.array(TestPointSchema).min(1),
  test_conditions: z.array(TestConditionSchema).optional(),
  test_cases: z.array(TestCaseSchema).min(1),
  tool_applications: z.array(ToolApplicationSchema).min(4).max(5),
  coverage_exclusions: z.array(CoverageExclusionSchema),
  coverage: z.record(z.string(), CoverageEntrySchema),
  knowledge_evidence: z.array(KnowledgeEvidenceSchema).default([]),
  parameter_extraction_assessment: ParameterExtractionAssessmentSchema.optional(),
}).strict();

export const TestDesignPlanSchema = TestDesignSchema.pick({
  objective: true,
  risks: true,
  test_points: true,
  test_conditions: true,
  tool_applications: true,
  coverage_exclusions: true,
  parameter_extraction_assessment: true,
}).extend({
  test_conditions: z.array(TestConditionSchema).min(1),
}).strict();

// OpenAI Structured Outputs requires every declared object property to be
// present. Keep the persisted/domain schema backward compatible, while the
// provider schema represents a non-AI condition explicitly with null.
export const ModelTestConditionSchema = TestConditionSchema.extend({
  ai_dimension: AiTestDimensionSchema.nullable(),
}).strict();

export const ModelTestDesignPlanSchema = TestDesignPlanSchema.extend({
  test_conditions: z.array(ModelTestConditionSchema).min(1),
  parameter_extraction_assessment: ParameterExtractionAssessmentSchema.nullable(),
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
    ai_evaluation: ModelAiEvaluationSchema.nullable(),
  }).strict();
}

export function createTestCaseBatchSchema(obligations: readonly {
  conditionId: string;
  caseId: string;
  traceRef: string;
  aiDimension?: z.infer<typeof AiTestDimensionSchema>;
}[]) {
  const modelTestCaseSchema = createModelTestCaseSchema();
  return z.object({
    cases: z.object(Object.fromEntries(obligations.map(({ conditionId, caseId, traceRef, aiDimension }) => [
      conditionId,
      modelTestCaseSchema.extend({
        id: z.literal(caseId),
        primary_trace_ref: z.literal(traceRef),
        primary_test_condition_ref: z.literal(conditionId),
        test_condition_refs: z.array(z.literal(conditionId)).length(1),
        scenario_type: aiDimension ? z.literal("ai_behavior") : BusinessScenarioTypeSchema,
        technique: aiDimension ? z.literal("ai_evaluation") : BusinessTestTechniqueSchema,
        ai_evaluation: aiDimension
          ? ModelAiEvaluationSchema.extend({ dimension: z.literal(aiDimension) }).strict()
          : z.null(),
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

export const TestModelElementSchema = z.object({
  id: z.string().min(1),
  description: z.string(),
  source_refs: z.array(z.string().min(1)),
}).strict();

const ModelSourceRefsSchema = z.array(z.string().min(1));

export const SemanticParameterModelSchema = z.object({
  model_id: z.literal("M-01"),
  name: z.string().min(1),
  intents: z.array(z.object({
    id: z.string().min(1),
    description: z.string().min(1),
    in_scope: z.boolean(),
    required_slots: z.array(z.string().min(1)),
    source_refs: ModelSourceRefsSchema,
  }).strict()).min(1),
  slots: z.array(z.object({
    name: z.string().min(1),
    value_type: z.enum(["string", "integer", "number", "boolean", "enum", "object", "array"]),
    required: z.boolean(),
    default_value_json: z.string(),
    allowed_range: z.string(),
    canonical_unit: z.string(),
    enum_values: z.array(z.string()),
    normalization_rules: z.array(z.string()),
    validation_rules: z.array(z.string()),
    source_refs: ModelSourceRefsSchema,
  }).strict()),
  cross_parameter_constraints: z.array(z.object({
    id: z.string().min(1),
    expression: z.string().min(1),
    invalid_action: z.string().min(1),
    source_refs: ModelSourceRefsSchema,
  }).strict()),
}).strict();

export const BusinessDecisionModelSchema = z.object({
  model_id: z.literal("M-02"),
  name: z.string().min(1),
  rules: z.array(z.object({
    id: z.string().min(1),
    conditions: z.array(z.string().min(1)).min(1),
    actions: z.array(z.string().min(1)).min(1),
    priority: z.number().int().nonnegative(),
    source_refs: ModelSourceRefsSchema,
  }).strict()).min(1),
}).strict();

export const DialogueStateModelSchema = z.object({
  model_id: z.literal("M-03"),
  name: z.string().min(1),
  states: z.array(z.object({
    id: z.string().min(1),
    description: z.string().min(1),
    terminal: z.boolean(),
    source_refs: ModelSourceRefsSchema,
  }).strict()).min(1),
  transitions: z.array(z.object({
    id: z.string().min(1),
    from: z.string().min(1),
    event: z.string().min(1),
    guard: z.string(),
    actions: z.array(z.string()),
    to: z.string().min(1),
    search_allowed: z.boolean(),
    source_refs: ModelSourceRefsSchema,
  }).strict()),
  context_rules: z.array(z.object({
    id: z.string().min(1),
    trigger: z.string().min(1),
    operation: z.enum(["retain", "replace", "merge", "clear", "clarify", "cancel", "retry"]),
    targets: z.array(z.string()),
    outcome: z.string().min(1),
    source_refs: ModelSourceRefsSchema,
  }).strict()),
}).strict();

export const AgentInteractionModelSchema = z.object({
  model_id: z.literal("M-04"),
  name: z.string().min(1),
  tools: z.array(z.object({
    name: z.string().min(1),
    description: z.string().min(1),
    request_contract: z.string().min(1),
    response_contract: z.string().min(1),
    source_refs: ModelSourceRefsSchema,
  }).strict()),
  interaction_rules: z.array(z.object({
    id: z.string().min(1),
    trigger: z.string().min(1),
    preconditions: z.array(z.string()),
    tool: z.string(),
    argument_mapping: z.array(z.string()),
    success_outcome: z.string().min(1),
    empty_outcome: z.string().min(1),
    failure_outcome: z.string().min(1),
    evidence_requirements: z.array(z.string()).min(1),
    source_refs: ModelSourceRefsSchema,
  }).strict()).min(1),
}).strict();

export const BehaviorModelsSchema = z.object({
  semantic_parameter: SemanticParameterModelSchema,
  business_decision: BusinessDecisionModelSchema,
  dialogue_state: DialogueStateModelSchema,
  agent_interaction: AgentInteractionModelSchema,
}).strict();

export const ModelTestModelPlanSchema = ModelTestDesignPlanSchema.extend({
  behavior_models: BehaviorModelsSchema,
}).strict();

export const TestModelDocumentSchema = z.object({
  objective: z.string().min(1),
  quality_model: z.object({
    objectives: z.array(z.string().min(1)).min(1),
    risk_refs: z.array(z.string().min(1)),
    coverage_targets: z.array(z.string().min(1)),
  }).strict(),
  business_model: z.object({
    actors: z.array(TestModelElementSchema),
    business_rules: z.array(TestModelElementSchema),
    flows: z.array(TestModelElementSchema),
    states: z.array(TestModelElementSchema),
    constraints: z.array(TestModelElementSchema),
    exceptions: z.array(TestModelElementSchema),
  }).strict(),
  ai_model: z.object({
    applicable: z.boolean(),
    evaluation_subjects: z.array(AiEvaluationSubjectSchema),
    evaluation_layers: z.array(AiEvaluationLayerSchema),
    dimensions: z.array(AiTestDimensionSchema),
  }).strict(),
  // Optional only so historical, unapproved drafts remain inspectable. Every
  // newly generated model uses ModelTestModelPlanSchema and must provide all
  // four views.
  behavior_models: BehaviorModelsSchema.optional(),
  test_analysis: TestDesignPlanSchema,
  knowledge_evidence: z.array(KnowledgeEvidenceSchema).default([]),
}).strict();

export type TestModelDocument = z.infer<typeof TestModelDocumentSchema>;

export interface TestModelRecord {
  id: string;
  baselineId: string;
  version: number;
  status: "draft" | "approved";
  model: string;
  document: TestModelDocument;
  traceProvider: string;
  traceProjectName: string;
  traceId: string;
  createdAt: string;
  approvedBy: string;
  approvedAt: string | null;
}

export interface ApprovedTestModelVersionRecord {
  id: string;
  testModelId: string;
  baselineId: string;
  version: number;
  approvedBy: string;
  approvedAt: string;
}

export type TestCaseReviewStatus = "accepted" | "rejected";

export interface TestDesignRecord {
  id: string;
  baselineId: string;
  approvedTestModelVersionId: string;
  approvedTestConditionVersionId: string;
  version: number;
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
