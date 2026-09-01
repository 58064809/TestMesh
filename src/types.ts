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

