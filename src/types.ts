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

export type AnalysisOrigin = "explicit" | "inferred" | "missing" | "conflict";

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

export interface RequirementAnalysis {
  summary: AnalysisItem | null;
  requirements: Array<AnalysisItem & { acceptance_criteria: string[] }>;
  actors: AnalysisItem[];
  business_rules: AnalysisItem[];
  flows: AnalysisItem[];
  states: AnalysisItem[];
  constraints: AnalysisItem[];
  exceptions: AnalysisItem[];
  open_questions: AnalysisItem[];
  sources: AnalysisSource[];
}

export type AnalysisReviewStatus = "accepted" | "rejected" | "merged" | "clarify";
export type AnalysisIssueType = "missing" | "ambiguity" | "conflict";

export interface AnalysisReviewRecord {
  id: string;
  analysisId: string;
  itemId: string;
  status: AnalysisReviewStatus;
  reviewer: string;
  reason: string;
  evidenceChecked: boolean;
  issueType: AnalysisIssueType | "";
  mergeInto: string;
  decision: string;
  decisionBy: string;
  prdRevision: string;
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

export interface TestDesignAnalysis {
  id: string;
  summary: string;
  model: string;
  createdAt: string;
  analysisFormat: "legacy" | "requirement-analysis";
  requirements: Array<TraceRequirement & { acceptanceCriteria: string[]; evidenceIds: string[] }>;
  risks: Array<TraceRisk & { evidenceIds: string[] }>;
  evidence: TraceEvidence[];
}

export interface TestCaseRecord {
  id: string;
  specId: string;
  operationId: string;
  method: string;
  path: string;
  summary: string;
  requirementIds: string[];
  evidenceIds: string[];
}

export interface OpenApiSpecRecord {
  id: string;
  name: string;
  version: string;
  filename: string;
  testCases: TestCaseRecord[];
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

export interface RepositoryInspection {
  repoPath: string;
  branch: string;
  status: string;
  files: string[];
}

export interface DockerContainerSummary {
  id: string;
  name: string;
  image: string;
  status: string;
}

export type EngineeringTaskStatus =
  | "queued"
  | "starting"
  | "running"
  | "completed"
  | "failed"
  | "stopped";

export interface EngineeringEventRecord {
  id: string;
  taskId: string;
  ordinal: number;
  kind: string;
  source: string;
  timestamp: string;
  payload: unknown;
  terminalOutput: string;
}

export interface EngineeringTaskRecord {
  id: string;
  repoPath: string;
  instruction: string;
  selectedFiles: string[];
  logContext: string;
  dockerContainerId: string;
  dockerContainerName: string;
  dockerContext: string;
  status: EngineeringTaskStatus;
  model: string;
  agentServerImage: string;
  clientVersion: string;
  conversationId: string;
  finalResponse: string;
  terminalOutput: string;
  gitDiff: string;
  tokenUsage: unknown;
  cost: number | null;
  error: string;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  events: EngineeringEventRecord[];
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

export interface TestDesignCaseRecord {
  id: string;
  analysisId: string;
  title: string;
  testType: "playwright";
  objective: string;
  preconditions: string[];
  steps: string[];
  expectedResults: string[];
  priority: Priority;
  requirementIds: string[];
  riskIds: string[];
  evidenceIds: string[];
  reviewStatus: "draft" | "approved";
  automationRepoPath: string;
  automationFile: string;
  engineeringTaskId: string | null;
  engineeringTaskStatus: EngineeringTaskStatus | null;
  uiRuns: UiTestRunRecord[];
  createdAt: string;
}

export interface TestDesignGenerationResponse {
  model: string;
  usage: { inputTokens: number; outputTokens: number; totalTokens: number };
  sourceReviews: Array<{
    sourceId: string;
    reviewedText: boolean;
    reviewedImages: boolean;
    visualFindings: Array<{ locator: string; description: string; evidenceIds: string[] }>;
  }>;
  coverageReview: {
    requirements: Array<{ requirementId: string; disposition: "covered" | "not_playwright_applicable" }>;
    acceptanceCriteria: Array<{ requirementId: string; criterionNumber: number; disposition: "covered" | "not_playwright_applicable" }>;
    risks: Array<{ riskId: string; disposition: "covered" | "not_playwright_applicable" }>;
  };
  qualityReview: {
    approved: boolean;
    summary: string;
    findings: Array<{ draftKey: string; title: string; issue: string; recommendation: string }>;
  };
  savedCaseCount: number;
}

export interface TestDesignProgress {
  phase: "source_review" | "partition_generation" | "partition_review" | "coverage_review" | "fill_generation" | "complete";
  status: "started" | "streaming" | "completed";
  message: string;
  partitionKey?: string;
  partitionTitle?: string;
  completedPartitions: number;
  totalPartitions: number;
  acceptedCaseCount: number;
}

export type TestDesignStreamEvent =
  | { type: "progress"; progress: TestDesignProgress }
  | { type: "batch_saved"; partitionKey: string; partitionTitle: string; savedCaseCount: number; testCases: TestDesignCaseRecord[] }
  | ({ type: "complete" } & TestDesignGenerationResponse)
  | { type: "error"; error: string; savedCaseCount: number };

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
