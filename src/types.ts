export type Priority = "must" | "should" | "could";
export type Severity = "high" | "medium" | "low";
export type LocatorType = "page" | "paragraph" | "image" | "limited";

export interface Evidence {
  id: string;
  sourceId: string;
  sourceName: string;
  locatorType: LocatorType;
  locator: string;
  excerpt: string;
  note: string;
}

export interface Requirement {
  id: string;
  title: string;
  description: string;
  priority: Priority;
  acceptanceCriteria: string[];
  evidenceIds: string[];
}

export interface Risk {
  id: string;
  title: string;
  description: string;
  severity: Severity;
  mitigation: string;
  evidenceIds: string[];
}

export interface PendingQuestion {
  id: string;
  question: string;
  reason: string;
  relatedRequirementIds: string[];
}

export interface AnalysisResult {
  summary: string;
  requirements: Requirement[];
  risks: Risk[];
  pendingQuestions: PendingQuestion[];
  evidence: Evidence[];
}

export type AnalysisOrigin = "explicit" | "inferred";
export type AnalysisIssueType = "missing" | "ambiguity" | "conflict";

export interface AnalysisItem {
  id: string;
  description: string;
  origin: AnalysisOrigin;
  source_refs: string[];
  confidence: number;
}

export interface AnalysisSource extends AnalysisItem {
  source_file_id: string;
  source_file_name: string;
  locator_type: LocatorType;
  locator: string;
  excerpt: string;
}

export interface AnalysisOpenQuestion extends AnalysisItem {
  issue_type: AnalysisIssueType;
}

export interface RequirementAnalysis {
  summary: AnalysisItem | null;
  requirements: Array<AnalysisItem & { acceptance_criteria: string[] }>;
  actors: AnalysisItem[];
  business_rules: AnalysisItem[];
  flows: AnalysisItem[];
  states: AnalysisItem[];
  constraints: AnalysisItem[];
  exceptions: AnalysisItem[];
  open_questions: AnalysisOpenQuestion[];
  sources: AnalysisSource[];
}

export type AnalysisReviewStatus = "accepted" | "rejected" | "merged" | "clarify";
export const PENDING_PRD_REVISION = "待建立的新版本";

export interface AnalysisReviewRecord {
  id: string;
  analysisId: string;
  itemId: string;
  status: AnalysisReviewStatus;
  reviewer: string;
  reason: string;
  issueType: AnalysisIssueType | "";
  mergeInto: string;
  decision: string;
  decisionBy: string;
  prdRevision: string;
  createdAt: string;
}

export interface AnalysisAmendmentRecord {
  id: string;
  analysisId: string;
  itemId: string;
  editor: string;
  reason: string;
  before: AnalysisItem | AnalysisOpenQuestion;
  after: AnalysisItem | AnalysisOpenQuestion;
  createdAt: string;
}

export interface RequirementBaselineRecord {
  id: string;
  analysisId: string;
  previousBaselineId: string | null;
  version: number;
  prdRevision: string;
  prdFilename: string;
  prdSha256: string;
  approvedBy: string;
  approvedAt: string;
}

export type TestTechnique = "scenario" | "equivalence_partition" | "boundary_value" | "decision_table" | "state_transition" | "combinatorial" | "property_based" | "ai_evaluation";
export type AiTestDimension = "intent_recognition" | "multi_turn_context" | "constraint_adherence" | "response_correctness" | "groundedness_hallucination" | "safety_refusal" | "parameter_extraction" | "tool_selection" | "tool_invocation" | "robustness_consistency";
export type AiEvaluationSubject = "testmesh" | "target_application";
export type AiEvaluationLayer = "agent_decision" | "tool_execution" | "business_outcome" | "final_response";
export type ParameterExtractionAspect = "parameter_identification" | "value_accuracy" | "completeness" | "no_redundancy" | "type_conformance" | "semantic_normalization" | "ambiguity_handling" | "negation_exclusion" | "multi_value" | "conflict_resolution" | "context_inheritance" | "context_override" | "required_missing_clarification" | "business_constraint" | "noise_robustness" | "tool_parameter_mapping" | "repeatability" | "prompt_injection_resistance";

export interface TestRisk {
  id: string;
  title: string;
  description: string;
  likelihood: "low" | "medium" | "high";
  impact: "low" | "medium" | "high";
  rationale: string;
  trace_refs: string[];
  source_refs: string[];
  knowledge_refs: string[];
}

export interface TestPoint {
  id: string;
  title: string;
  objective: string;
  technique: TestTechnique;
  technique_rationale: string;
  trace_refs: string[];
  risk_refs: string[];
  source_refs: string[];
  knowledge_refs: string[];
}

export interface DesignedTestCase {
  id: string;
  module?: string;
  title: string;
  objective: string;
  primary_trace_ref?: string;
  primary_test_condition_ref?: string;
  test_condition_refs?: string[];
  scenario_type?: "normal" | "exception" | "boundary" | "rule_combination" | "state_transition" | "cross_business" | "ai_behavior";
  technique?: TestTechnique;
  priority: "P0" | "P1" | "P2" | "P3";
  preconditions: string[];
  test_data?: string[];
  steps?: Array<{ order: number; action: string; expected: string }>;
  gherkin: string;
  trace_refs: string[];
  risk_refs: string[];
  test_point_refs: string[];
  source_refs: string[];
  knowledge_refs: string[];
  ai_evaluation?: {
    dimension: AiTestDimension;
    evaluation_subjects?: AiEvaluationSubject[];
    evaluation_layers?: AiEvaluationLayer[];
    oracle_type: "exact_match" | "contains" | "regex" | "reference_answer" | "code_evaluator" | "llm_judge" | "human_review";
    expected_behavior: string;
    evaluator: string;
    threshold: string;
    dataset_requirements: string[];
    evidence_requirements: string[];
    parameter_extraction?: {
      layer: "semantic_extraction" | "structure_business_validation" | "tool_parameter_mapping";
      aspect: ParameterExtractionAspect;
      slot_name: string;
      expected_presence: boolean;
      expected_value_json: string;
      expected_type: "string" | "integer" | "number" | "boolean" | "date" | "time" | "datetime" | "currency" | "array" | "object" | "missing" | "null";
      match_type: "exact" | "normalized" | "range" | "set" | "semantic" | "schema" | "context_state" | "tool_mapping" | "absence" | "human_review";
      normalization_rule: string;
      tolerance: string;
      expected_action: "extract" | "clarify" | "reject" | "execute";
      state_target: "slot_delta" | "merged_slots" | "tool_arguments" | "not_applicable";
      reference_datetime: string;
      timezone: string;
      locale: string;
      schema_version: string;
      risk_level: "P0" | "P1" | "P2" | "P3";
    };
  };
}

export interface TestDesignDocument {
  objective: string;
  risks: TestRisk[];
  test_points: TestPoint[];
  test_conditions?: Array<{
    id: string;
    title: string;
    objective: string;
    primary_trace_ref: string;
    category: string;
    technique: TestTechnique;
    rationale: string;
    source_refs: string[];
    knowledge_refs: string[];
    ai_dimension?: AiTestDimension;
  }>;
  test_cases: DesignedTestCase[];
  tool_applications: Array<{
    tool: "cucumber_gherkin" | "fast_check" | "nist_acts" | "graphwalker" | "phoenix_evals";
    status: "applied" | "not_applicable";
    reason: string;
  }>;
  coverage_exclusions: Array<{ trace_ref: string; reason: string }>;
  coverage: Record<string, { test_point_refs: string[]; test_case_refs: string[]; exclusion_reason: string }>;
  knowledge_evidence: Array<{
    chunk_id: string;
    document_id: string;
    filename: string;
    score: number;
    text: string;
    headings: string[];
    page_numbers: number[];
    doc_items: string[];
  }>;
  parameter_extraction_assessment?: {
    status: "applicable" | "not_applicable" | "blocked";
    implementation_pattern: "traditional_nlu" | "structured_output" | "function_calling" | "agent_workflow" | "unknown";
    reason: string;
    source_refs: string[];
    schema_version: string;
    aspects: Array<{ aspect: ParameterExtractionAspect; status: "planned" | "not_applicable"; condition_refs: string[]; reason: string }>;
  };
}

export interface TestCaseReviewRecord {
  id: string;
  designId: string;
  testCaseId: string;
  status: "accepted" | "rejected";
  reviewer: string;
  reason: string;
  createdAt: string;
}

export interface TestDesignRecord {
  id: string;
  baselineId: string;
  approvedTestModelVersionId: string;
  approvedTestConditionVersionId: string;
  version: number;
  status: "draft" | "approved";
  model: string;
  document: TestDesignDocument;
  traceProvider: string;
  traceProjectName: string;
  traceId: string;
  traceUrl?: string;
  createdAt: string;
  reviewSummary?: { total: number; pending: number; accepted: number; rejected: number };
  reviews?: TestCaseReviewRecord[];
  amendments?: Array<{
    id: string;
    designId: string;
    testCaseId: string;
    editor: string;
    reason: string;
    before: DesignedTestCase;
    after: DesignedTestCase;
    createdAt: string;
  }>;
  approvedVersion?: Omit<ApprovedTestCaseVersionOption, "testCases"> | null;
  baselineSources?: Array<{
    id: string;
    source_file_name: string;
    locator_type: string;
    locator: string;
    excerpt: string;
    description: string;
  }>;
}

export interface TestConditionSetRecord {
  id: string;
  baselineId: string;
  approvedTestModelVersionId: string;
  version: number;
  status: "draft" | "approved";
  document: {
    schemaVersion: "test-condition-set/v1";
    baselineId: string;
    approvedTestModelVersionId: string;
    objective: string;
    conditions: NonNullable<TestDesignDocument["test_conditions"]>;
    generation: { mode: "prompt" | "approved_model_projection"; promptVersion: string | null; note: string };
  };
  createdAt: string;
  approvedBy: string;
  approvedAt: string | null;
}

export interface ApprovedTestConditionVersion {
  record: {
    id: string;
    testConditionSetId: string;
    baselineId: string;
    approvedTestModelVersionId: string;
    version: number;
    approvedBy: string;
    approvedAt: string;
  };
  snapshot: TestConditionSetRecord["document"];
}

export interface TestModelDocument {
  objective: string;
  quality_model: { objectives: string[]; risk_refs: string[]; coverage_targets: string[] };
  business_model: Record<"actors" | "business_rules" | "flows" | "states" | "constraints" | "exceptions", Array<{
    id: string; description: string; source_refs: string[];
  }>>;
  ai_model: {
    applicable: boolean;
    evaluation_subjects: AiEvaluationSubject[];
    evaluation_layers: AiEvaluationLayer[];
    dimensions: AiTestDimension[];
  };
  behavior_models?: {
    semantic_parameter: {
      model_id: "M-01"; name: string;
      intents: Array<{ id: string; description: string; in_scope: boolean; required_slots: string[]; source_refs: string[] }>;
      slots: Array<{ name: string; value_type: "string" | "integer" | "number" | "boolean" | "enum" | "object" | "array"; required: boolean; default_value_json: string; allowed_range: string; canonical_unit: string; enum_values: string[]; normalization_rules: string[]; validation_rules: string[]; source_refs: string[] }>;
      cross_parameter_constraints: Array<{ id: string; expression: string; invalid_action: string; source_refs: string[] }>;
    };
    business_decision: {
      model_id: "M-02"; name: string;
      rules: Array<{ id: string; conditions: string[]; actions: string[]; priority: number; source_refs: string[] }>;
    };
    dialogue_state: {
      model_id: "M-03"; name: string;
      states: Array<{ id: string; description: string; terminal: boolean; source_refs: string[] }>;
      transitions: Array<{ id: string; from: string; event: string; guard: string; actions: string[]; to: string; search_allowed: boolean; source_refs: string[] }>;
      context_rules: Array<{ id: string; trigger: string; operation: "retain" | "replace" | "merge" | "clear" | "clarify" | "cancel" | "retry"; targets: string[]; outcome: string; source_refs: string[] }>;
    };
    agent_interaction: {
      model_id: "M-04"; name: string;
      tools: Array<{ name: string; description: string; request_contract: string; response_contract: string; source_refs: string[] }>;
      interaction_rules: Array<{ id: string; trigger: string; preconditions: string[]; tool: string; argument_mapping: string[]; success_outcome: string; empty_outcome: string; failure_outcome: string; evidence_requirements: string[]; source_refs: string[] }>;
    };
  };
  test_analysis: {
    objective: string;
    risks: TestRisk[];
    test_points: TestPoint[];
    test_conditions: NonNullable<TestDesignDocument["test_conditions"]>;
    tool_applications: TestDesignDocument["tool_applications"];
    coverage_exclusions: TestDesignDocument["coverage_exclusions"];
    parameter_extraction_assessment?: TestDesignDocument["parameter_extraction_assessment"];
  };
  knowledge_evidence: TestDesignDocument["knowledge_evidence"];
}

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

export interface ApprovedTestModelVersion {
  record: {
    id: string;
    testModelId: string;
    baselineId: string;
    version: number;
    approvedBy: string;
    approvedAt: string;
  };
  snapshot: TestModelDocument;
}

export interface KnowledgeDocumentRecord {
  id: string;
  filename: string;
  mimeType: string;
  sha256: string;
  byteSize: number;
  status: "processing" | "indexed" | "failed";
  chunkCount: number;
  embeddingModel: string;
  error: string;
  createdAt: string;
  indexedAt: string | null;
}

export interface AnalysisResponse {
  analysisId: string;
  result: RequirementAnalysis;
  model: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  sources: Array<{
    id: string;
    name: string;
    mimeType: string;
    scope: "attachment" | "knowledge";
    capability: LocatorType;
    capabilityNote: string;
  }>;
  observability?: {
    provider: "phoenix";
    projectName: string;
    traceId: string;
    traceUrl: string;
  };
}

export interface TraceRequirement {
  id: string;
  analysisId: string;
  externalId: string;
  title: string;
  description: string;
  priority: Priority;
}

export interface TraceEvidence {
  id: string;
  analysisId: string;
  externalId: string;
  sourceName: string;
  locatorType: LocatorType;
  locator: string;
  excerpt: string;
}

export interface TraceRisk {
  id: string;
  analysisId: string;
  externalId: string;
  title: string;
  description: string;
  severity: Severity;
  mitigation: string;
}

export interface TestCaseRecord {
  id: string;
  specId: string;
  operationId: string;
  method: string;
  path: string;
  summary: string;
  approvedTestCaseIds: string[];
}

export interface OpenApiSpecRecord {
  id: string;
  approvedVersionId: string;
  projectId: string;
  environmentId: string;
  name: string;
  version: string;
  filename: string;
  testCases: TestCaseRecord[];
}

export interface ProjectEnvironmentRecord {
  id: string;
  projectId: string;
  name: string;
  baseUrl: string;
  headers: Array<{ name: string; value: string }>;
  variables: Array<{ name: string; value: string }>;
  configProvider: "testmesh_non_secret" | "infisical";
  infisicalEnvironmentSlug: string;
  infisicalSecretPath: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectRecord {
  id: string;
  name: string;
  code: string;
  description: string;
  infisicalProjectId: string;
  defaultApiEnvironmentId: string;
  defaultUiEnvironmentId: string;
  uiRepositoryPath: string;
  environments: ProjectEnvironmentRecord[];
  createdAt: string;
  updatedAt: string;
}

export type QualityCharacteristic =
  | "functional_suitability" | "performance_efficiency" | "compatibility" | "interaction_capability"
  | "reliability" | "security" | "maintainability" | "flexibility" | "safety"
  | "ai_validity_reliability" | "ai_transparency_traceability" | "ai_intent_recognition"
  | "ai_multi_turn_context" | "ai_constraint_adherence" | "ai_response_correctness"
  | "ai_groundedness_hallucination" | "ai_safety_refusal" | "ai_parameter_extraction" | "ai_tool_use_correctness" | "ai_robustness_consistency";

export interface QualityPlanRecord {
  id: string;
  projectId: string;
  version: number;
  status: "draft" | "approved" | "closed";
  name: string;
  release: string;
  owner: string;
  objectives: string[];
  qualityCharacteristics: QualityCharacteristic[];
  risks: Array<{ id: string; title: string; probability: "low" | "medium" | "high"; impact: "low" | "medium" | "high"; treatment: string; owner: string }>;
  scope: string;
  exclusions: string[];
  strategies: string[];
  entryCriteria: string[];
  exitCriteria: string[];
  requiredEvidence: string[];
  approvers: string[];
  baselineId: string;
  approvedTestModelVersionId: string;
  approvedTestCaseVersionId: string;
  aiQualityProfileId: string;
  gateRules: {
    requireApprovedBaseline: boolean;
    requireApprovedTestModel: boolean;
    requireApprovedTestCases: boolean;
    minimumRequirementCoveragePct: number;
    minimumTraceabilityCompletenessPct: number;
    minimumTestDataSpecificationCoveragePct: number;
    minimumAssertionDesignCoveragePct: number;
    minimumExecutionCompletenessPct: number;
    minimumExecutionPassRatePct: number;
    minimumFailureTriageCoveragePct: number;
    maximumFailedTests: number;
    requireApiExecution: boolean;
    requireUiExecution: boolean;
    requireApprovedAiQualityProfile: boolean;
    maximumOpenImprovementActions: number;
  };
  approvedBy: string;
  approvalNote: string;
  approvedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface QualitySnapshot {
  plan: QualityPlanRecord;
  metrics: { requirementCoveragePct: number; approvedTestCases: number; executionCount: number; executionPassRatePct: number; executionCompletenessPct: number; passedTests: number; failedTests: number; apiExecutionCount: number; uiExecutionCount: number; aiTestCases: number; aiDimensions: number; requiredAiDimensions: number; aiDimensionCoveragePct: number; aiEvaluationCoveragePct: number; missingAiDimensions: string[]; aiEvaluatedTestCases: number; missingAiEvaluationTestCaseIds: string[]; requirementReviewCount: number; requirementDecisionRatePct: number; requirementAmendmentCount: number; testCaseReviewCount: number; testCaseAcceptanceRatePct: number; testCaseAmendmentCount: number; testDataSpecificationCoveragePct: number; assertionDesignCoveragePct: number; traceabilityCompletenessPct: number; failedRunsRequiringTriage: number; failureTriageCoveragePct: number; locatedFailureRatePct: number; triageEvidenceCategories: string[]; openImprovementActions: number };
  metricCatalog: Array<{ id: string; name: string; category: string; status: "available" | "unavailable"; value: number | null; unit: string; numerator: number | null; denominator: number | null; formula: string; evidence: string; note: string }>;
  latestGate: ReleaseGateRecord | null;
  gateFresh: boolean;
  layers: {
    governance: { planApproved: boolean; baselineApproved: boolean; testModelApproved: boolean; approvedTestCases: boolean };
    coverage: { requirementCoveragePct: number; approvedTestCases: number };
    humanReview: { requirementReviewCount: number; requirementDecisionRatePct: number; requirementAmendmentCount: number; testCaseReviewCount: number; testCaseAcceptanceRatePct: number; testCaseAmendmentCount: number };
    testDesign: { testDataSpecificationCoveragePct: number; assertionDesignCoveragePct: number; traceabilityCompletenessPct: number };
    execution: { executionCount: number; executionPassRatePct: number; passedTests: number; failedTests: number; failedRunsRequiringTriage: number };
    diagnosis: { failureTriageCoveragePct: number; locatedFailureRatePct: number; evidenceCategories: string[] };
    aiQuality: { profileApproved: boolean; evaluationEvidenceLinked: boolean; aiTestCases: number; aiEvaluatedTestCases: number; aiDimensions: number; requiredAiDimensions: number; aiDimensionCoveragePct: number; missingAiDimensions: string[]; missingAiEvaluationTestCaseIds: string[] };
    improvement: { openActions: number };
  };
  assets: { nodes: Array<{ id: string; type: string; label: string; status: string }>; links: Array<{ from: string; to: string; relation: string }> };
  improvements: QualityImprovementRecord[];
}

export interface ReleaseGateRecord {
  id: string;
  planId: string;
  projectId: string;
  policyVersion: string;
  opaVersion: string;
  status: "allow" | "review" | "deny";
  facts: unknown;
  result: { status: "allow" | "review" | "deny"; reasons: string[]; checks: Array<{ id: string; passed: boolean }> };
  riskAcceptance: { acceptedBy: string; reason: string; expiresAt: string | null; acceptedAt: string } | null;
  evaluatedAt: string;
}

export interface QualityImprovementRecord {
  id: string;
  planId: string;
  projectId: string;
  sourceType: "release_gate" | "failure_triage" | "retrospective" | "manual";
  sourceId: string;
  title: string;
  rootCauseCategory: "requirement" | "design" | "code" | "test" | "environment" | "data" | "process" | "ai_quality" | "unknown";
  action: string;
  owner: string;
  dueDate: string;
  status: "open" | "in_progress" | "verified" | "closed";
  verificationEvidence: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface ApprovedTestCaseVersionOption {
  id: string;
  designId: string;
  version: number;
  approvedBy: string;
  approvedAt: string;
  testCases: DesignedTestCase[];
}

export interface TestRunItem {
  id: string;
  testCaseId: string | null;
  operation: string;
  status: "passed" | "failed" | "error";
  durationMs: number;
  failureType: string;
  checks: string[];
  request: string;
  response: string;
  reproduction: string;
  detail: string;
}

export interface TestRunRecord {
  id: string;
  specId: string;
  targetBaseUrl: string;
  status: "running" | "passed" | "failed" | "error";
  startedAt: string;
  finishedAt: string | null;
  generatedExamples: number;
  passed: number;
  failed: number;
  exitCode: number | null;
  runnerOutput: string;
  items: TestRunItem[];
}

export interface ApiScenarioSuiteRecord {
  id: string;
  projectId: string;
  environmentId: string;
  approvedVersionId: string;
  filename: string;
  sourceFormat: "testmesh-hurl/v1";
  sourceContent: string;
  approvedTestCaseIds: string[];
  createdAt: string;
}

export interface ApiScenarioRunRecord {
  id: string;
  suiteId: string;
  projectId: string;
  environmentId: string;
  targetBaseUrl: string;
  status: "running" | "passed" | "failed" | "error";
  hurlVersion: string;
  startedAt: string;
  finishedAt: string | null;
  passed: number;
  failed: number;
  exitCode: number | null;
  runnerOutput: string;
  items: Array<{
    id: string;
    name: string;
    classname: string;
    status: "passed" | "failed" | "error";
    durationMs: number;
    detail: string;
  }>;
}

export interface RepositoryInspection {
  repoPath: string;
  branch: string;
  status: string;
  files: string[];
  agentsInitialized?: boolean;
  agentFiles?: string[];
}

export interface UiTestResultRecord {
  id: string;
  title: string;
  projectName: string;
  status: "passed" | "failed" | "skipped" | "timedOut" | "interrupted";
  durationMs: number;
  error: string;
}

export interface UiTestArtifactRecord {
  id: string;
  runId: string;
  name: string;
  kind: "trace";
}

export interface UiTestRunRecord {
  id: string;
  projectId: string;
  environmentId: string;
  approvedVersionId: string;
  approvedTestCaseIds: string[];
  targetBaseUrl: string;
  repoPath: string;
  testFile: string;
  status: "running" | "passed" | "failed" | "error";
  playwrightVersion: string;
  image: string;
  containerName: string;
  startedAt: string;
  finishedAt: string | null;
  passed: number;
  failed: number;
  skipped: number;
  exitCode: number | null;
  runnerOutput: string;
  error: string;
  results: UiTestResultRecord[];
  artifacts: UiTestArtifactRecord[];
}

export type FailureRunKind = "api_schema" | "api_scenario" | "fastapi_yaml" | "ui";

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

export interface FailureEvidence {
  id: string;
  category: "reporter" | "test_case" | "test_run" | "assertion" | "http" | "runner" | "artifact" | "telemetry" | "database" | "middleware" | "source_code";
  title: string;
  content: string;
  locator: string;
  direct: boolean;
}

export interface FailureTriageRecord {
  id: string;
  taskId: string;
  input: {
    projectId: string;
    environmentId: string;
    runKind: FailureRunKind;
    runId: string;
    approvedVersionId: string;
    approvedTestCaseIds: string[];
  };
  evidence: FailureEvidence[];
  result: {
    status: "located" | "suspected" | "insufficient_evidence";
    failure_layer: "test_script" | "frontend" | "gateway" | "backend" | "database" | "cache" | "message_queue" | "third_party" | "environment" | "unknown";
    summary: string;
    suspected_components: string[];
    facts: Array<{ statement: string; evidence_refs: string[] }>;
    hypotheses: Array<{ cause: string; confidence: "low" | "medium" | "high"; supporting_evidence_refs: string[]; contradicting_evidence_refs: string[] }>;
    source_locations: Array<{ repository: string; commit: string; file: string; line: number | null; evidence_refs: string[] }>;
    database_findings: Array<{ statement: string; query_summary: string; evidence_refs: string[] }>;
    missing_evidence: string[];
    next_checks: string[];
    submission_draft: {
      title: string;
      severity: "blocker" | "critical" | "major" | "minor" | "trivial" | "undetermined";
      steps: string[];
      expected: string;
      actual: string;
      technical_analysis: string;
      attachment_evidence_refs: string[];
    };
  };
  model: string;
  traceProvider: string;
  traceProjectName: string;
  traceId: string;
  createdAt: string;
}

export interface AndroidTestResultRecord {
  id: string;
  title: string;
  suite: string;
  status: "passed" | "failed" | "skipped";
  durationMs: number;
  error: string;
}

export interface AndroidTestArtifactRecord {
  id: string;
  runId: string;
  name: string;
  kind: "screenshot" | "page_source" | "appium_log";
}

export interface AndroidTestRunRecord {
  id: string;
  repoPath: string;
  configFile: string;
  testFile: string;
  status: "running" | "passed" | "failed" | "error";
  deviceSerial: string;
  platformVersion: string;
  appiumVersion: string;
  driverVersion: string;
  wdioVersion: string;
  startedAt: string;
  finishedAt: string | null;
  passed: number;
  failed: number;
  skipped: number;
  exitCode: number | null;
  runnerOutput: string;
  error: string;
  results: AndroidTestResultRecord[];
  artifacts: AndroidTestArtifactRecord[];
}

export interface PerformanceThresholdRecord {
  id: string;
  metric: string;
  expression: string;
  failed: boolean;
}

export interface PerformanceTestArtifactRecord {
  id: string;
  runId: string;
  name: string;
  kind: "summary" | "terminal_output";
}

export interface PerformanceTestRunRecord {
  id: string;
  repoPath: string;
  scriptFile: string;
  status: "running" | "passed" | "failed" | "error";
  k6Version: string;
  startedAt: string;
  finishedAt: string | null;
  exitCode: number | null;
  httpRequests: number;
  requestFailedRate: number;
  iterations: number;
  checksPassed: number;
  checksFailed: number;
  durationAvgMs: number;
  durationP90Ms: number;
  durationP95Ms: number;
  durationMaxMs: number;
  runnerOutput: string;
  error: string;
  thresholds: PerformanceThresholdRecord[];
  artifacts: PerformanceTestArtifactRecord[];
}

export type SecurityRisk = "high" | "medium" | "low" | "informational" | "unknown";

export interface SecurityFindingRecord {
  id: string;
  pluginId: string;
  name: string;
  risk: SecurityRisk;
  confidence: string;
  url: string;
  method: string;
  parameter: string;
  evidence: string;
  description: string;
  solution: string;
  reference: string;
}

export interface SecurityTestArtifactRecord {
  id: string;
  runId: string;
  name: string;
  kind: "report" | "terminal_output";
}

export interface SecurityTestRunRecord {
  id: string;
  targetUrl: string;
  status: "running" | "completed" | "error";
  zapVersion: string;
  startedAt: string;
  finishedAt: string | null;
  exitCode: number | null;
  high: number;
  medium: number;
  low: number;
  informational: number;
  totalFindings: number;
  runnerOutput: string;
  error: string;
  findings: SecurityFindingRecord[];
  artifacts: SecurityTestArtifactRecord[];
}
