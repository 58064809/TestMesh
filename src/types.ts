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

export interface AnalysisResponse {
  analysisId: string;
  result: AnalysisResult;
  model: string;
  usage: {
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
