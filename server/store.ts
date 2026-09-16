import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { RequirementAnalysisSchema, type AnalysisResult, type RequirementAnalysis, type SourceFile } from "./analysis.js";

export interface TraceRequirement {
  id: string;
  analysisId: string;
  externalId: string;
  title: string;
  description: string;
  priority: string;
}

export interface TraceEvidence {
  id: string;
  analysisId: string;
  externalId: string;
  sourceName: string;
  locatorType: string;
  locator: string;
  excerpt: string;
}

export interface TraceRisk {
  id: string;
  analysisId: string;
  externalId: string;
  title: string;
  description: string;
  severity: string;
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

export type AnalysisReviewStatus = "accepted" | "rejected" | "merged" | "clarify";
export type AnalysisIssueType = "missing" | "ambiguity" | "conflict";

export interface AnalysisReviewInput {
  status: AnalysisReviewStatus;
  reviewer: string;
  reason: string;
  evidenceChecked: boolean;
  issueType: AnalysisIssueType | "";
  mergeInto: string;
  decision: string;
  decisionBy: string;
  prdRevision: string;
}

export interface AnalysisReviewRecord extends AnalysisReviewInput {
  id: string;
  analysisId: string;
  itemId: string;
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

export interface GeneratedTestCaseInput {
  title: string;
  objective: string;
  preconditions: string[];
  steps: string[];
  expectedResults: string[];
  priority: "must" | "should" | "could";
  requirementIds: string[];
  riskIds: string[];
  evidenceIds: string[];
}

export interface TestDesignCaseRecord extends GeneratedTestCaseInput {
  id: string;
  analysisId: string;
  testType: "playwright";
  reviewStatus: "draft" | "approved";
  automationRepoPath: string;
  automationFile: string;
  engineeringTaskId: string | null;
  engineeringTaskStatus: EngineeringTaskStatus | null;
  uiRuns: UiTestRunRecord[];
  createdAt: string;
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

export interface TestRunItemInput {
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
  items: Array<TestRunItemInput & { id: string }>;
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

export interface UiTestResultInput {
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
  results: Array<UiTestResultInput & { id: string }>;
  artifacts: UiTestArtifactRecord[];
}

export interface AndroidTestResultInput {
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
  results: Array<AndroidTestResultInput & { id: string }>;
  artifacts: AndroidTestArtifactRecord[];
}

export interface PerformanceThresholdInput {
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
  thresholds: Array<PerformanceThresholdInput & { id: string }>;
  artifacts: PerformanceTestArtifactRecord[];
}

export type SecurityRisk = "high" | "medium" | "low" | "informational" | "unknown";

export interface SecurityFindingInput {
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
  findings: Array<SecurityFindingInput & { id: string }>;
  artifacts: SecurityTestArtifactRecord[];
}

const schema = `
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS analyses (
  id TEXT PRIMARY KEY,
  summary TEXT NOT NULL,
  model TEXT NOT NULL,
  created_at TEXT NOT NULL,
  document_json TEXT
);
CREATE TABLE IF NOT EXISTS analysis_review_events (
  id TEXT PRIMARY KEY,
  analysis_id TEXT NOT NULL REFERENCES analyses(id) ON DELETE CASCADE,
  item_id TEXT NOT NULL,
  status TEXT NOT NULL,
  reviewer TEXT NOT NULL,
  reason TEXT NOT NULL,
  evidence_checked INTEGER NOT NULL,
  issue_type TEXT NOT NULL,
  merge_into TEXT NOT NULL,
  decision TEXT NOT NULL,
  decision_by TEXT NOT NULL,
  prd_revision TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS analysis_source_files (
  analysis_id TEXT NOT NULL REFERENCES analyses(id) ON DELETE CASCADE,
  source_file_id TEXT NOT NULL,
  filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  provenance TEXT NOT NULL,
  file BLOB NOT NULL,
  stored_at TEXT NOT NULL,
  PRIMARY KEY (analysis_id, source_file_id)
);
CREATE INDEX IF NOT EXISTS idx_analysis_review_events ON analysis_review_events (analysis_id, item_id);
CREATE TABLE IF NOT EXISTS requirement_baselines (
  id TEXT PRIMARY KEY,
  analysis_id TEXT NOT NULL REFERENCES analyses(id) ON DELETE RESTRICT,
  previous_baseline_id TEXT REFERENCES requirement_baselines(id) ON DELETE RESTRICT,
  version INTEGER NOT NULL,
  prd_revision TEXT NOT NULL,
  prd_filename TEXT NOT NULL,
  prd_sha256 TEXT NOT NULL,
  prd_file BLOB NOT NULL,
  approved_by TEXT NOT NULL,
  approved_at TEXT NOT NULL,
  snapshot_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS requirements (
  id TEXT PRIMARY KEY,
  analysis_id TEXT NOT NULL REFERENCES analyses(id) ON DELETE CASCADE,
  external_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  priority TEXT NOT NULL,
  acceptance_criteria TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS risks (
  id TEXT PRIMARY KEY,
  analysis_id TEXT NOT NULL REFERENCES analyses(id) ON DELETE CASCADE,
  external_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  severity TEXT NOT NULL,
  mitigation TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS evidence (
  id TEXT PRIMARY KEY,
  analysis_id TEXT NOT NULL REFERENCES analyses(id) ON DELETE CASCADE,
  external_id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  source_name TEXT NOT NULL,
  locator_type TEXT NOT NULL,
  locator TEXT NOT NULL,
  excerpt TEXT NOT NULL,
  note TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS requirement_evidence (
  requirement_id TEXT NOT NULL REFERENCES requirements(id) ON DELETE CASCADE,
  evidence_id TEXT NOT NULL REFERENCES evidence(id) ON DELETE CASCADE,
  PRIMARY KEY (requirement_id, evidence_id)
);
CREATE TABLE IF NOT EXISTS risk_evidence (
  risk_id TEXT NOT NULL REFERENCES risks(id) ON DELETE CASCADE,
  evidence_id TEXT NOT NULL REFERENCES evidence(id) ON DELETE CASCADE,
  PRIMARY KEY (risk_id, evidence_id)
);
CREATE TABLE IF NOT EXISTS openapi_specs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  version TEXT NOT NULL,
  filename TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS test_cases (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL DEFAULT 'api',
  analysis_id TEXT REFERENCES analyses(id) ON DELETE CASCADE,
  spec_id TEXT REFERENCES openapi_specs(id) ON DELETE CASCADE,
  operation_id TEXT NOT NULL DEFAULT '',
  method TEXT NOT NULL DEFAULT '',
  path TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL DEFAULT '',
  test_type TEXT NOT NULL DEFAULT 'api',
  objective TEXT NOT NULL DEFAULT '',
  preconditions TEXT NOT NULL DEFAULT '[]',
  steps TEXT NOT NULL DEFAULT '[]',
  expected_results TEXT NOT NULL DEFAULT '[]',
  priority TEXT NOT NULL DEFAULT 'should',
  review_status TEXT NOT NULL DEFAULT 'approved',
  automation_repo_path TEXT NOT NULL DEFAULT '',
  automation_file TEXT NOT NULL DEFAULT '',
  engineering_task_id TEXT REFERENCES engineering_tasks(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT '',
  UNIQUE(spec_id, method, path)
);
CREATE TABLE IF NOT EXISTS test_case_requirements (
  test_case_id TEXT NOT NULL REFERENCES test_cases(id) ON DELETE CASCADE,
  requirement_id TEXT NOT NULL REFERENCES requirements(id) ON DELETE CASCADE,
  PRIMARY KEY (test_case_id, requirement_id)
);
CREATE TABLE IF NOT EXISTS test_case_evidence (
  test_case_id TEXT NOT NULL REFERENCES test_cases(id) ON DELETE CASCADE,
  evidence_id TEXT NOT NULL REFERENCES evidence(id) ON DELETE CASCADE,
  PRIMARY KEY (test_case_id, evidence_id)
);
CREATE TABLE IF NOT EXISTS test_case_risks (
  test_case_id TEXT NOT NULL REFERENCES test_cases(id) ON DELETE CASCADE,
  risk_id TEXT NOT NULL REFERENCES risks(id) ON DELETE CASCADE,
  PRIMARY KEY (test_case_id, risk_id)
);
CREATE TABLE IF NOT EXISTS test_runs (
  id TEXT PRIMARY KEY,
  spec_id TEXT NOT NULL REFERENCES openapi_specs(id) ON DELETE CASCADE,
  target_base_url TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  generated_examples INTEGER NOT NULL DEFAULT 0,
  passed INTEGER NOT NULL DEFAULT 0,
  failed INTEGER NOT NULL DEFAULT 0,
  exit_code INTEGER,
  runner_output TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS test_run_items (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES test_runs(id) ON DELETE CASCADE,
  test_case_id TEXT REFERENCES test_cases(id) ON DELETE SET NULL,
  operation TEXT NOT NULL,
  status TEXT NOT NULL,
  duration_ms REAL NOT NULL,
  failure_type TEXT NOT NULL,
  checks TEXT NOT NULL,
  request_text TEXT NOT NULL,
  response_text TEXT NOT NULL,
  reproduction TEXT NOT NULL,
  detail TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS engineering_tasks (
  id TEXT PRIMARY KEY,
  repo_path TEXT NOT NULL,
  instruction TEXT NOT NULL,
  selected_files TEXT NOT NULL,
  log_context TEXT NOT NULL,
  docker_container_id TEXT NOT NULL,
  docker_container_name TEXT NOT NULL,
  docker_context TEXT NOT NULL,
  status TEXT NOT NULL,
  model TEXT NOT NULL,
  agent_server_image TEXT NOT NULL,
  client_version TEXT NOT NULL,
  conversation_id TEXT NOT NULL DEFAULT '',
  final_response TEXT NOT NULL DEFAULT '',
  terminal_output TEXT NOT NULL DEFAULT '',
  git_diff TEXT NOT NULL DEFAULT '',
  token_usage TEXT NOT NULL DEFAULT '{}',
  cost REAL,
  error TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT
);
CREATE TABLE IF NOT EXISTS engineering_task_events (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES engineering_tasks(id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL,
  kind TEXT NOT NULL,
  source TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  payload TEXT NOT NULL,
  terminal_output TEXT NOT NULL,
  UNIQUE(task_id, ordinal)
);
CREATE TABLE IF NOT EXISTS ui_test_runs (
  id TEXT PRIMARY KEY,
  repo_path TEXT NOT NULL,
  test_file TEXT NOT NULL,
  status TEXT NOT NULL,
  playwright_version TEXT NOT NULL,
  image TEXT NOT NULL,
  container_name TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  passed INTEGER NOT NULL DEFAULT 0,
  failed INTEGER NOT NULL DEFAULT 0,
  skipped INTEGER NOT NULL DEFAULT 0,
  exit_code INTEGER,
  runner_output TEXT NOT NULL DEFAULT '',
  error TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS ui_test_results (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES ui_test_runs(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  project_name TEXT NOT NULL,
  status TEXT NOT NULL,
  duration_ms REAL NOT NULL,
  error TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS ui_test_artifacts (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES ui_test_runs(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  path TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS test_case_ui_runs (
  test_case_id TEXT NOT NULL REFERENCES test_cases(id) ON DELETE CASCADE,
  run_id TEXT NOT NULL REFERENCES ui_test_runs(id) ON DELETE CASCADE,
  PRIMARY KEY (test_case_id, run_id)
);
CREATE TABLE IF NOT EXISTS android_test_runs (
  id TEXT PRIMARY KEY,
  repo_path TEXT NOT NULL,
  config_file TEXT NOT NULL,
  test_file TEXT NOT NULL,
  status TEXT NOT NULL,
  device_serial TEXT NOT NULL,
  platform_version TEXT NOT NULL,
  appium_version TEXT NOT NULL,
  driver_version TEXT NOT NULL,
  wdio_version TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  passed INTEGER NOT NULL DEFAULT 0,
  failed INTEGER NOT NULL DEFAULT 0,
  skipped INTEGER NOT NULL DEFAULT 0,
  exit_code INTEGER,
  runner_output TEXT NOT NULL DEFAULT '',
  error TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS android_test_results (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES android_test_runs(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  suite TEXT NOT NULL,
  status TEXT NOT NULL,
  duration_ms REAL NOT NULL,
  error TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS android_test_artifacts (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES android_test_runs(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  path TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS performance_test_runs (
  id TEXT PRIMARY KEY,
  repo_path TEXT NOT NULL,
  script_file TEXT NOT NULL,
  status TEXT NOT NULL,
  k6_version TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  exit_code INTEGER,
  http_requests INTEGER NOT NULL DEFAULT 0,
  request_failed_rate REAL NOT NULL DEFAULT 0,
  iterations INTEGER NOT NULL DEFAULT 0,
  checks_passed INTEGER NOT NULL DEFAULT 0,
  checks_failed INTEGER NOT NULL DEFAULT 0,
  duration_avg_ms REAL NOT NULL DEFAULT 0,
  duration_p90_ms REAL NOT NULL DEFAULT 0,
  duration_p95_ms REAL NOT NULL DEFAULT 0,
  duration_max_ms REAL NOT NULL DEFAULT 0,
  runner_output TEXT NOT NULL DEFAULT '',
  summary_json TEXT NOT NULL DEFAULT '',
  error TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS performance_test_thresholds (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES performance_test_runs(id) ON DELETE CASCADE,
  metric TEXT NOT NULL,
  expression TEXT NOT NULL,
  failed INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS performance_test_artifacts (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES performance_test_runs(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  path TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS security_test_runs (
  id TEXT PRIMARY KEY,
  target_url TEXT NOT NULL,
  status TEXT NOT NULL,
  zap_version TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  exit_code INTEGER,
  high INTEGER NOT NULL DEFAULT 0,
  medium INTEGER NOT NULL DEFAULT 0,
  low INTEGER NOT NULL DEFAULT 0,
  informational INTEGER NOT NULL DEFAULT 0,
  total_findings INTEGER NOT NULL DEFAULT 0,
  runner_output TEXT NOT NULL DEFAULT '',
  error TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS security_test_findings (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES security_test_runs(id) ON DELETE CASCADE,
  plugin_id TEXT NOT NULL,
  name TEXT NOT NULL,
  risk TEXT NOT NULL,
  confidence TEXT NOT NULL,
  url TEXT NOT NULL,
  method TEXT NOT NULL,
  parameter TEXT NOT NULL,
  evidence TEXT NOT NULL,
  description TEXT NOT NULL,
  solution TEXT NOT NULL,
  reference TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS security_test_artifacts (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES security_test_runs(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  path TEXT NOT NULL
);
`;

export class DomainStore {
  private readonly db: Database.Database;

  constructor(databasePath: string) {
    if (databasePath !== ":memory:") {
      fs.mkdirSync(path.dirname(databasePath), { recursive: true });
    }
    this.db = new Database(databasePath);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(schema);
    const analysisColumns = this.db.pragma("table_info(analyses)") as Array<{ name: string }>;
    if (!analysisColumns.some((column) => column.name === "document_json")) {
      this.db.exec("ALTER TABLE analyses ADD COLUMN document_json TEXT");
    }
    this.migrateLegacyTestCases();
  }

  private migrateLegacyTestCases(): void {
    const columns = this.db.pragma("table_info(test_cases)") as Array<{ name: string }>;
    if (columns.some((column) => column.name === "source")) return;

    this.db.pragma("foreign_keys = OFF");
    try {
      this.db.exec(`
        BEGIN;
        DROP TABLE IF EXISTS test_case_risks;
        DROP TABLE IF EXISTS test_case_ui_runs;
        ALTER TABLE test_case_requirements RENAME TO test_case_requirements_legacy;
        ALTER TABLE test_case_evidence RENAME TO test_case_evidence_legacy;
        ALTER TABLE test_run_items RENAME TO test_run_items_legacy;
        ALTER TABLE test_cases RENAME TO test_cases_legacy;
        CREATE TABLE test_cases (
          id TEXT PRIMARY KEY,
          source TEXT NOT NULL DEFAULT 'api',
          analysis_id TEXT REFERENCES analyses(id) ON DELETE CASCADE,
          spec_id TEXT REFERENCES openapi_specs(id) ON DELETE CASCADE,
          operation_id TEXT NOT NULL DEFAULT '',
          method TEXT NOT NULL DEFAULT '',
          path TEXT NOT NULL DEFAULT '',
          summary TEXT NOT NULL DEFAULT '',
          title TEXT NOT NULL DEFAULT '',
          test_type TEXT NOT NULL DEFAULT 'api',
          objective TEXT NOT NULL DEFAULT '',
          preconditions TEXT NOT NULL DEFAULT '[]',
          steps TEXT NOT NULL DEFAULT '[]',
          expected_results TEXT NOT NULL DEFAULT '[]',
          priority TEXT NOT NULL DEFAULT 'should',
          review_status TEXT NOT NULL DEFAULT 'approved',
          automation_repo_path TEXT NOT NULL DEFAULT '',
          automation_file TEXT NOT NULL DEFAULT '',
          engineering_task_id TEXT REFERENCES engineering_tasks(id) ON DELETE SET NULL,
          created_at TEXT NOT NULL DEFAULT '',
          UNIQUE(spec_id, method, path)
        );
        INSERT INTO test_cases
          (id, source, spec_id, operation_id, method, path, summary, title, test_type,
           objective, review_status, created_at)
        SELECT id, 'api', spec_id, operation_id, method, path, summary, summary, 'api',
               summary, 'approved', ''
        FROM test_cases_legacy;
        CREATE TABLE test_case_requirements (
          test_case_id TEXT NOT NULL REFERENCES test_cases(id) ON DELETE CASCADE,
          requirement_id TEXT NOT NULL REFERENCES requirements(id) ON DELETE CASCADE,
          PRIMARY KEY (test_case_id, requirement_id)
        );
        INSERT INTO test_case_requirements SELECT * FROM test_case_requirements_legacy;
        CREATE TABLE test_case_evidence (
          test_case_id TEXT NOT NULL REFERENCES test_cases(id) ON DELETE CASCADE,
          evidence_id TEXT NOT NULL REFERENCES evidence(id) ON DELETE CASCADE,
          PRIMARY KEY (test_case_id, evidence_id)
        );
        INSERT INTO test_case_evidence SELECT * FROM test_case_evidence_legacy;
        CREATE TABLE test_case_risks (
          test_case_id TEXT NOT NULL REFERENCES test_cases(id) ON DELETE CASCADE,
          risk_id TEXT NOT NULL REFERENCES risks(id) ON DELETE CASCADE,
          PRIMARY KEY (test_case_id, risk_id)
        );
        CREATE TABLE test_run_items (
          id TEXT PRIMARY KEY,
          run_id TEXT NOT NULL REFERENCES test_runs(id) ON DELETE CASCADE,
          test_case_id TEXT REFERENCES test_cases(id) ON DELETE SET NULL,
          operation TEXT NOT NULL,
          status TEXT NOT NULL,
          duration_ms REAL NOT NULL,
          failure_type TEXT NOT NULL,
          checks TEXT NOT NULL,
          request_text TEXT NOT NULL,
          response_text TEXT NOT NULL,
          reproduction TEXT NOT NULL,
          detail TEXT NOT NULL
        );
        INSERT INTO test_run_items SELECT * FROM test_run_items_legacy;
        CREATE TABLE test_case_ui_runs (
          test_case_id TEXT NOT NULL REFERENCES test_cases(id) ON DELETE CASCADE,
          run_id TEXT NOT NULL REFERENCES ui_test_runs(id) ON DELETE CASCADE,
          PRIMARY KEY (test_case_id, run_id)
        );
        DROP TABLE test_case_requirements_legacy;
        DROP TABLE test_case_evidence_legacy;
        DROP TABLE test_run_items_legacy;
        DROP TABLE test_cases_legacy;
        COMMIT;
      `);
    } catch (error) {
      if (this.db.inTransaction) this.db.exec("ROLLBACK");
      throw error;
    } finally {
      this.db.pragma("foreign_keys = ON");
    }
    const violations = this.db.pragma("foreign_key_check") as unknown[];
    if (violations.length > 0) throw new Error("TestCase 数据迁移后外键校验失败");
  }

  close(): void {
    this.db.close();
  }

  saveAnalysis(result: AnalysisResult, model: string): string {
    const analysisId = randomUUID();
    const save = this.db.transaction(() => {
      this.db.prepare("INSERT INTO analyses (id, summary, model, created_at) VALUES (?, ?, ?, ?)").run(
        analysisId,
        result.summary,
        model,
        new Date().toISOString(),
      );

      const evidenceIds = new Map<string, string>();
      const insertEvidence = this.db.prepare(
        "INSERT INTO evidence VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      );
      for (const item of result.evidence) {
        const id = randomUUID();
        evidenceIds.set(item.id, id);
        insertEvidence.run(
          id,
          analysisId,
          item.id,
          item.sourceId,
          item.sourceName,
          item.locatorType,
          item.locator,
          item.excerpt,
          item.note,
        );
      }

      const insertRequirement = this.db.prepare(
        "INSERT INTO requirements VALUES (?, ?, ?, ?, ?, ?, ?)",
      );
      const linkRequirementEvidence = this.db.prepare(
        "INSERT INTO requirement_evidence VALUES (?, ?)",
      );
      for (const item of result.requirements) {
        const id = randomUUID();
        insertRequirement.run(
          id,
          analysisId,
          item.id,
          item.title,
          item.description,
          item.priority,
          JSON.stringify(item.acceptanceCriteria),
        );
        for (const externalEvidenceId of item.evidenceIds) {
          const evidenceId = evidenceIds.get(externalEvidenceId);
          if (evidenceId) linkRequirementEvidence.run(id, evidenceId);
        }
      }

      const insertRisk = this.db.prepare("INSERT INTO risks VALUES (?, ?, ?, ?, ?, ?, ?)");
      const linkRiskEvidence = this.db.prepare("INSERT INTO risk_evidence VALUES (?, ?)");
      for (const item of result.risks) {
        const id = randomUUID();
        insertRisk.run(
          id,
          analysisId,
          item.id,
          item.title,
          item.description,
          item.severity,
          item.mitigation,
        );
        for (const externalEvidenceId of item.evidenceIds) {
          const evidenceId = evidenceIds.get(externalEvidenceId);
          if (evidenceId) linkRiskEvidence.run(id, evidenceId);
        }
      }
    });
    save();
    return analysisId;
  }

  saveRequirementAnalysis(document: RequirementAnalysis, model: string, files: SourceFile[]): string {
    const parsed = RequirementAnalysisSchema.parse(document);
    const analysisId = randomUUID();
    const save = this.db.transaction(() => {
      this.db.prepare(
        "INSERT INTO analyses (id, summary, model, created_at, document_json) VALUES (?, ?, ?, ?, ?)",
      ).run(analysisId, parsed.summary?.description ?? "", model, new Date().toISOString(), JSON.stringify(parsed));

      const insertFile = this.db.prepare(
        `INSERT INTO analysis_source_files VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const file of files) {
        insertFile.run(analysisId, file.id, file.name, file.mimeType,
          createHash("sha256").update(file.buffer).digest("hex"), "at_analysis", file.buffer,
          new Date().toISOString());
      }

      // These rows are trace indexes derived from the canonical document, not
      // a second editable analysis result. Historic Risk rows remain untouched.
      const evidenceIds = new Map<string, string>();
      const insertEvidence = this.db.prepare("INSERT INTO evidence VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)");
      for (const source of parsed.sources) {
        const id = randomUUID();
        evidenceIds.set(source.id, id);
        insertEvidence.run(
          id, analysisId, source.id, source.source_file_id, source.source_file_name,
          source.locator_type, source.locator, source.excerpt, source.description,
        );
      }

      const insertRequirement = this.db.prepare("INSERT INTO requirements VALUES (?, ?, ?, ?, ?, ?, ?)");
      const linkRequirementEvidence = this.db.prepare("INSERT INTO requirement_evidence VALUES (?, ?)");
      for (const item of parsed.requirements) {
        const id = randomUUID();
        insertRequirement.run(
          id, analysisId, item.id, item.description, item.description, "unspecified",
          JSON.stringify(item.acceptance_criteria),
        );
        for (const ref of item.source_refs) {
          const evidenceId = evidenceIds.get(ref);
          if (evidenceId) linkRequirementEvidence.run(id, evidenceId);
        }
      }
    });
    save();
    return analysisId;
  }

  getRequirementAnalysis(analysisId: string): RequirementAnalysis | null {
    const row = this.db.prepare("SELECT document_json AS documentJson FROM analyses WHERE id = ?")
      .get(analysisId) as { documentJson: string | null } | undefined;
    if (!row) throw new Error(`分析结果 ${analysisId} 不存在`);
    if (!row.documentJson) return null;
    const parsed = RequirementAnalysisSchema.safeParse(JSON.parse(row.documentJson));
    if (!parsed.success) {
      throw new Error("这份已保存分析不符合当前需求分析协议；原记录保持不变，请使用原始资料按新协议重新分析");
    }
    return parsed.data;
  }

  listAnalysisSourceFiles(analysisId: string): Array<{ sourceFileId: string; filename: string; mimeType: string; sha256: string; provenance: string; storedAt: string }> {
    const document = this.getRequirementAnalysis(analysisId);
    if (!document) throw new Error("旧协议分析没有新版原文件目录");
    return this.db.prepare(
      `SELECT source_file_id AS sourceFileId, filename, mime_type AS mimeType,
              sha256, provenance, stored_at AS storedAt
       FROM analysis_source_files WHERE analysis_id = ? ORDER BY rowid`,
    ).all(analysisId) as Array<{ sourceFileId: string; filename: string; mimeType: string; sha256: string; provenance: string; storedAt: string }>;
  }

  getAnalysisSourceFile(analysisId: string, sourceFileId: string): { filename: string; mimeType: string; file: Buffer; sha256: string; provenance: string } {
    const row = this.db.prepare(
      `SELECT filename, mime_type AS mimeType, file, sha256, provenance
       FROM analysis_source_files WHERE analysis_id = ? AND source_file_id = ?`,
    ).get(analysisId, sourceFileId) as { filename: string; mimeType: string; file: Buffer; sha256: string; provenance: string } | undefined;
    if (!row) throw new Error("原始来源文件未留存；当前仅可查看来源摘录与定位");
    return row;
  }

  backfillAnalysisSourceFile(analysisId: string, file: SourceFile): void {
    const document = this.getRequirementAnalysis(analysisId);
    if (!document) throw new Error("旧协议分析不能补录原文件");
    const referenced = document.sources.filter((source) => source.source_file_id === file.id);
    if (!referenced.length || referenced.some((source) => source.source_file_name !== file.name)) {
      throw new Error("补录原文件的来源 ID 或文件名与分析记录不一致");
    }
    if (this.db.prepare("SELECT 1 FROM analysis_source_files WHERE analysis_id = ? AND source_file_id = ?").get(analysisId, file.id)) {
      throw new Error("该来源原文件已保存，不能覆盖");
    }
    this.db.prepare("INSERT INTO analysis_source_files VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(
      analysisId, file.id, file.name, file.mimeType,
      createHash("sha256").update(file.buffer).digest("hex"), "backfilled_after_analysis",
      file.buffer, new Date().toISOString(),
    );
  }

  listRequirementAnalyses(): Array<{ id: string; summary: string; model: string; createdAt: string; protocol: "current" | "incompatible" }> {
    const rows = this.db.prepare(
      `SELECT id, summary, model, created_at AS createdAt, document_json AS documentJson
       FROM analyses WHERE document_json IS NOT NULL ORDER BY created_at DESC`,
    ).all() as Array<{ id: string; summary: string; model: string; createdAt: string; documentJson: string }>;
    return rows.map(({ documentJson, ...row }) => {
      try {
        const protocol = RequirementAnalysisSchema.safeParse(JSON.parse(documentJson)).success ? "current" : "incompatible";
        return { ...row, protocol } as const;
      } catch {
        return { ...row, protocol: "incompatible" as const };
      }
    });
  }

  private reviewSections(document: RequirementAnalysis): Array<{ section: string; item: RequirementAnalysis["actors"][number] }> {
    const sections = ["requirements", "actors", "business_rules", "flows", "states", "constraints", "exceptions", "open_questions"] as const;
    return [
      ...(document.summary ? [{ section: "summary", item: document.summary }] : []),
      ...sections.flatMap((section) => document[section].map((item) => ({ section, item }))),
    ];
  }

  listAnalysisReviews(analysisId: string): AnalysisReviewRecord[] {
    const document = this.getRequirementAnalysis(analysisId);
    if (!document) throw new Error("旧协议分析不能进入新版人工评审");
    return this.db.prepare(
      `SELECT e.id, e.analysis_id AS analysisId, e.item_id AS itemId, e.status,
              e.reviewer, e.reason, e.evidence_checked AS evidenceChecked,
              e.issue_type AS issueType, e.merge_into AS mergeInto, e.decision,
              e.decision_by AS decisionBy, e.prd_revision AS prdRevision,
              e.created_at AS createdAt
       FROM analysis_review_events e
       WHERE e.analysis_id = ? AND e.rowid IN (
         SELECT MAX(rowid) FROM analysis_review_events WHERE analysis_id = ? GROUP BY item_id
       ) ORDER BY e.rowid`,
    ).all(analysisId, analysisId).map((row) => {
      const record = row as Omit<AnalysisReviewRecord, "evidenceChecked"> & { evidenceChecked: number };
      return { ...record, evidenceChecked: Boolean(record.evidenceChecked) };
    });
  }

  listAnalysisReviewHistory(analysisId: string, itemId: string): AnalysisReviewRecord[] {
    const document = this.getRequirementAnalysis(analysisId);
    if (!document || !this.reviewSections(document).some(({ item }) => item.id === itemId)) {
      throw new Error("分析条目不存在，不能读取评审历史");
    }
    return this.db.prepare(
      `SELECT id, analysis_id AS analysisId, item_id AS itemId, status,
              reviewer, reason, evidence_checked AS evidenceChecked,
              issue_type AS issueType, merge_into AS mergeInto, decision,
              decision_by AS decisionBy, prd_revision AS prdRevision,
              created_at AS createdAt
       FROM analysis_review_events WHERE analysis_id = ? AND item_id = ? ORDER BY rowid DESC`,
    ).all(analysisId, itemId).map((row) => {
      const record = row as Omit<AnalysisReviewRecord, "evidenceChecked"> & { evidenceChecked: number };
      return { ...record, evidenceChecked: Boolean(record.evidenceChecked) };
    });
  }

  recordAnalysisReview(analysisId: string, itemId: string, input: AnalysisReviewInput): AnalysisReviewRecord {
    const document = this.getRequirementAnalysis(analysisId);
    if (!document) throw new Error("旧协议分析不能进入新版人工评审");
    if (this.db.prepare("SELECT 1 FROM requirement_baselines WHERE analysis_id = ?").get(analysisId)) {
      throw new Error("此分析已建立基线，评审记录已冻结；变更请重新分析新 PRD");
    }
    const items = this.reviewSections(document);
    const current = items.find((entry) => entry.item.id === itemId);
    if (!current) throw new Error(`分析条目 ${itemId} 不存在`);
    if (input.status === "merged") {
      const target = items.find((entry) => entry.item.id === input.mergeInto);
      if (!target || target.item.id === itemId || target.section !== current.section) throw new Error("合并目标需为同类的其他分析条目");
    } else if (input.mergeInto) throw new Error("只有合并条目才能填写目标");
    if (current.section === "open_questions") {
      if (input.status === "accepted" && !input.issueType) throw new Error("请明确待确认问题是缺失、歧义还是冲突");
      if (input.decision && (!input.decisionBy.trim() || !input.prdRevision.trim())) throw new Error("评审决策需要决策人和 PRD 修订标识");
    } else if (input.issueType || input.decision || input.decisionBy || input.prdRevision) {
      throw new Error("问题类型与会议决策只填写在待确认问题上");
    }
    const record: AnalysisReviewRecord = {
      ...input, id: randomUUID(), analysisId, itemId, createdAt: new Date().toISOString(),
    };
    this.db.prepare(
      `INSERT INTO analysis_review_events VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(record.id, analysisId, itemId, input.status, input.reviewer.trim(), input.reason.trim(),
      Number(input.evidenceChecked), input.issueType, input.mergeInto, input.decision.trim(),
      input.decisionBy.trim(), input.prdRevision.trim(), record.createdAt);
    return record;
  }

  listRequirementBaselines(): RequirementBaselineRecord[] {
    return this.db.prepare(
      `SELECT id, analysis_id AS analysisId, previous_baseline_id AS previousBaselineId,
              version, prd_revision AS prdRevision, prd_filename AS prdFilename,
              prd_sha256 AS prdSha256, approved_by AS approvedBy, approved_at AS approvedAt
       FROM requirement_baselines ORDER BY rowid DESC`,
    ).all() as RequirementBaselineRecord[];
  }

  createRequirementBaseline(
    analysisId: string,
    input: { prdRevision: string; approvedBy: string; previousBaselineId: string | null; prdFilename: string; prdFile: Buffer },
  ): RequirementBaselineRecord {
    const document = this.getRequirementAnalysis(analysisId);
    if (!document) throw new Error("旧协议分析不能建立新版需求基线");
    if (!input.prdRevision.trim() || !input.approvedBy.trim() || !input.prdFile.length) {
      throw new Error("建立基线需要 PRD 修订标识、批准人和评审后的 PRD 文件");
    }
    if (this.db.prepare("SELECT 1 FROM requirement_baselines WHERE analysis_id = ?").get(analysisId)) {
      throw new Error("此分析已建立基线；需求变化请重新分析新 PRD，不能覆盖旧基线");
    }
    const previous = input.previousBaselineId
      ? this.db.prepare("SELECT version FROM requirement_baselines WHERE id = ?").get(input.previousBaselineId) as { version: number } | undefined
      : null;
    if (input.previousBaselineId && !previous) throw new Error("前一需求基线不存在");
    if (input.previousBaselineId && this.db.prepare("SELECT 1 FROM requirement_baselines WHERE previous_baseline_id = ?").get(input.previousBaselineId)) {
      throw new Error("前一需求基线已有新版本，不能在单一路径中创建并行分支");
    }
    const items = this.reviewSections(document);
    const reviews = this.listAnalysisReviews(analysisId);
    const byId = new Map(reviews.map((review) => [review.itemId, review]));
    const unfinished = items.filter(({ item }) => !byId.has(item.id) || byId.get(item.id)?.status === "clarify");
    if (unfinished.length) throw new Error(`仍有 ${unfinished.length} 条未完成评审，不能建立基线`);
    for (const { section, item } of items) {
      const review = byId.get(item.id)!;
      if (section === "open_questions" && review.status === "accepted" && (!review.decision || !review.decisionBy || !review.prdRevision)) {
        throw new Error(`待确认问题 ${item.id} 尚未回写评审决策`);
      }
      if (section === "open_questions" && review.status === "accepted" && review.prdRevision !== input.prdRevision.trim()) {
        throw new Error(`待确认问题 ${item.id} 的决策登记在 PRD ${review.prdRevision}，与上传的获批版本 ${input.prdRevision} 不一致`);
      }
      if (review.status === "merged" && byId.get(review.mergeInto)?.status !== "accepted") {
        throw new Error(`合并目标 ${review.mergeInto} 尚未接受`);
      }
    }
    const accepted = items.filter(({ item }) => byId.get(item.id)?.status === "accepted").map(({ section, item }) => {
      const merged = items.filter(({ section: otherSection, item: otherItem }) =>
        otherSection === section && byId.get(otherItem.id)?.status === "merged" && byId.get(otherItem.id)?.mergeInto === item.id);
      return {
        section, item: { ...item, source_refs: [...new Set([...item.source_refs, ...merged.flatMap(({ item: mergedItem }) => mergedItem.source_refs)])] },
        mergedFrom: merged.map(({ item: mergedItem }) => mergedItem.id),
        review: byId.get(item.id),
      };
    });
    const record: RequirementBaselineRecord = {
      id: randomUUID(), analysisId, previousBaselineId: input.previousBaselineId,
      version: (previous?.version ?? 0) + 1, prdRevision: input.prdRevision.trim(),
      prdFilename: input.prdFilename, prdSha256: createHash("sha256").update(input.prdFile).digest("hex"),
      approvedBy: input.approvedBy.trim(), approvedAt: new Date().toISOString(),
    };
    const snapshot = JSON.stringify({ accepted, reviews, sourceRefs: document.sources });
    this.db.prepare(
      `INSERT INTO requirement_baselines VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(record.id, analysisId, record.previousBaselineId, record.version, record.prdRevision,
      record.prdFilename, record.prdSha256, input.prdFile, record.approvedBy, record.approvedAt, snapshot);
    return record;
  }

  getRequirementBaseline(id: string): { record: RequirementBaselineRecord; snapshot: unknown; file: Buffer } {
    const row = this.db.prepare(
      `SELECT id, analysis_id AS analysisId, previous_baseline_id AS previousBaselineId,
              version, prd_revision AS prdRevision, prd_filename AS prdFilename,
              prd_sha256 AS prdSha256, prd_file AS file, approved_by AS approvedBy,
              approved_at AS approvedAt, snapshot_json AS snapshotJson
       FROM requirement_baselines WHERE id = ?`,
    ).get(id) as (RequirementBaselineRecord & { file: Buffer; snapshotJson: string }) | undefined;
    if (!row) throw new Error(`需求基线 ${id} 不存在`);
    const { file, snapshotJson, ...record } = row;
    return { record, file, snapshot: JSON.parse(snapshotJson) as unknown };
  }

  listTraceSources(): { requirements: TraceRequirement[]; risks: TraceRisk[]; evidence: TraceEvidence[] } {
    const requirements = this.db
      .prepare(
        `SELECT id, analysis_id AS analysisId, external_id AS externalId, title, description, priority
         FROM requirements ORDER BY rowid DESC`,
      )
      .all() as TraceRequirement[];
    const evidence = this.db
      .prepare(
        `SELECT id, analysis_id AS analysisId, external_id AS externalId, source_name AS sourceName,
                locator_type AS locatorType, locator, excerpt
         FROM evidence ORDER BY rowid DESC`,
      )
      .all() as TraceEvidence[];
    const risks = this.db
      .prepare(
        `SELECT id, analysis_id AS analysisId, external_id AS externalId, title, description,
                severity, mitigation FROM risks ORDER BY rowid DESC`,
      )
      .all() as TraceRisk[];
    return { requirements, risks, evidence };
  }

  listTestDesignAnalyses(): TestDesignAnalysis[] {
    const ids = this.db
      .prepare("SELECT id FROM analyses ORDER BY created_at DESC")
      .all() as Array<{ id: string }>;
    return ids.map(({ id }) => this.getTestDesignAnalysis(id));
  }

  getTestDesignAnalysis(analysisId: string): TestDesignAnalysis {
    const analysis = this.db.prepare(
      `SELECT id, summary, model, created_at AS createdAt, document_json AS documentJson FROM analyses WHERE id = ?`,
    ).get(analysisId) as (Omit<TestDesignAnalysis, "requirements" | "risks" | "evidence" | "analysisFormat"> & { documentJson: string | null }) | undefined;
    if (!analysis) throw new Error(`分析结果 ${analysisId} 不存在`);

    const requirements = this.db.prepare(
      `SELECT id, analysis_id AS analysisId, external_id AS externalId, title, description,
              priority, acceptance_criteria AS acceptanceCriteria
       FROM requirements WHERE analysis_id = ? ORDER BY rowid`,
    ).all(analysisId) as Array<Omit<TestDesignAnalysis["requirements"][number], "acceptanceCriteria" | "evidenceIds"> & {
      acceptanceCriteria: string;
    }>;
    const risks = this.db.prepare(
      `SELECT id, analysis_id AS analysisId, external_id AS externalId, title, description,
              severity, mitigation FROM risks WHERE analysis_id = ? ORDER BY rowid`,
    ).all(analysisId) as Array<Omit<TestDesignAnalysis["risks"][number], "evidenceIds">>;
    const evidence = this.db.prepare(
      `SELECT id, analysis_id AS analysisId, external_id AS externalId, source_name AS sourceName,
              locator_type AS locatorType, locator, excerpt
       FROM evidence WHERE analysis_id = ? ORDER BY rowid`,
    ).all(analysisId) as TraceEvidence[];
    const requirementEvidence = this.db.prepare(
      "SELECT evidence_id AS id FROM requirement_evidence WHERE requirement_id = ?",
    );
    const riskEvidence = this.db.prepare(
      "SELECT evidence_id AS id FROM risk_evidence WHERE risk_id = ?",
    );
    return {
      id: analysis.id,
      summary: analysis.summary,
      model: analysis.model,
      createdAt: analysis.createdAt,
      analysisFormat: analysis.documentJson ? "requirement-analysis" : "legacy",
      requirements: requirements.map((item) => ({
        ...item,
        acceptanceCriteria: JSON.parse(item.acceptanceCriteria) as string[],
        evidenceIds: (requirementEvidence.all(item.id) as Array<{ id: string }>).map((row) => row.id),
      })),
      risks: risks.map((item) => ({
        ...item,
        evidenceIds: (riskEvidence.all(item.id) as Array<{ id: string }>).map((row) => row.id),
      })),
      evidence,
    };
  }

  saveGeneratedTestCases(analysisId: string, cases: GeneratedTestCaseInput[]): TestDesignCaseRecord[] {
    const analysis = this.getTestDesignAnalysis(analysisId);
    const allowedRequirements = new Set(analysis.requirements.map((item) => item.id));
    const allowedRisks = new Set(analysis.risks.map((item) => item.id));
    const allowedEvidence = new Set(analysis.evidence.map((item) => item.id));
    if (cases.length === 0) throw new Error("模型没有返回可保存的测试用例");
    for (const item of cases) {
      if (item.requirementIds.length + item.riskIds.length + item.evidenceIds.length < 1) {
        throw new Error(`测试用例“${item.title}”没有任何需求分析、PRD 或 RAG 证据`);
      }
      if (item.requirementIds.some((id) => !allowedRequirements.has(id))) throw new Error(`测试用例“${item.title}”引用了其他分析的 Requirement`);
      if (item.riskIds.some((id) => !allowedRisks.has(id))) throw new Error(`测试用例“${item.title}”引用了其他分析的 Risk`);
      if (item.evidenceIds.some((id) => !allowedEvidence.has(id))) throw new Error(`测试用例“${item.title}”引用了其他分析的 Evidence`);
    }

    const ids: string[] = [];
    const save = this.db.transaction(() => {
      const insertCase = this.db.prepare(
        `INSERT INTO test_cases
         (id, source, analysis_id, title, summary, test_type, objective, preconditions, steps,
          expected_results, priority, review_status, created_at)
         VALUES (?, 'generated', ?, ?, ?, 'playwright', ?, ?, ?, ?, ?, 'draft', ?)`,
      );
      const linkRequirement = this.db.prepare("INSERT INTO test_case_requirements VALUES (?, ?)");
      const linkRisk = this.db.prepare("INSERT INTO test_case_risks VALUES (?, ?)");
      const linkEvidence = this.db.prepare("INSERT INTO test_case_evidence VALUES (?, ?)");
      for (const item of cases) {
        const id = randomUUID();
        ids.push(id);
        insertCase.run(
          id,
          analysisId,
          item.title,
          item.title,
          item.objective,
          JSON.stringify(item.preconditions),
          JSON.stringify(item.steps),
          JSON.stringify(item.expectedResults),
          item.priority,
          new Date().toISOString(),
        );
        for (const requirementId of item.requirementIds) linkRequirement.run(id, requirementId);
        for (const riskId of item.riskIds) linkRisk.run(id, riskId);
        for (const evidenceId of item.evidenceIds) linkEvidence.run(id, evidenceId);
      }
    });
    save();
    return ids.map((id) => this.getTestDesignCase(id));
  }

  listTestDesignCases(): TestDesignCaseRecord[] {
    const ids = this.db.prepare(
      "SELECT id FROM test_cases WHERE source = 'generated' ORDER BY created_at DESC",
    ).all() as Array<{ id: string }>;
    return ids.map(({ id }) => this.getTestDesignCase(id));
  }

  getTestDesignCase(id: string): TestDesignCaseRecord {
    const row = this.db.prepare(
      `SELECT tc.id, tc.analysis_id AS analysisId, tc.title, tc.test_type AS testType,
              tc.objective, tc.preconditions, tc.steps, tc.expected_results AS expectedResults,
              tc.priority, tc.review_status AS reviewStatus,
              tc.automation_repo_path AS automationRepoPath, tc.automation_file AS automationFile,
              tc.engineering_task_id AS engineeringTaskId, et.status AS engineeringTaskStatus,
              tc.created_at AS createdAt
       FROM test_cases tc LEFT JOIN engineering_tasks et ON et.id = tc.engineering_task_id
       WHERE tc.id = ? AND tc.source = 'generated'`,
    ).get(id) as (Omit<TestDesignCaseRecord, "preconditions" | "steps" | "expectedResults" | "requirementIds" | "riskIds" | "evidenceIds" | "uiRuns"> & {
      preconditions: string;
      steps: string;
      expectedResults: string;
    }) | undefined;
    if (!row) throw new Error(`测试用例 ${id} 不存在`);
    const linkedIds = (table: string, column: string): string[] =>
      (this.db.prepare(`SELECT ${column} AS id FROM ${table} WHERE test_case_id = ?`).all(id) as Array<{ id: string }>).map((item) => item.id);
    const runIds = this.db.prepare(
      "SELECT run_id AS id FROM test_case_ui_runs WHERE test_case_id = ? ORDER BY rowid DESC",
    ).all(id) as Array<{ id: string }>;
    return {
      ...row,
      preconditions: JSON.parse(row.preconditions) as string[],
      steps: JSON.parse(row.steps) as string[],
      expectedResults: JSON.parse(row.expectedResults) as string[],
      requirementIds: linkedIds("test_case_requirements", "requirement_id"),
      riskIds: linkedIds("test_case_risks", "risk_id"),
      evidenceIds: linkedIds("test_case_evidence", "evidence_id"),
      uiRuns: runIds.map(({ id: runId }) => this.getUiTestRun(runId)),
    };
  }

  approveTestDesignCase(id: string): TestDesignCaseRecord {
    this.getTestDesignCase(id);
    this.db.prepare("UPDATE test_cases SET review_status = 'approved' WHERE id = ?").run(id);
    return this.getTestDesignCase(id);
  }

  linkTestCaseAutomation(id: string, repoPath: string, automationFile: string, taskId: string): TestDesignCaseRecord {
    const testCase = this.getTestDesignCase(id);
    if (testCase.reviewStatus !== "approved") throw new Error("测试用例草稿尚未批准，不能生成自动化代码");
    this.getEngineeringTask(taskId);
    this.db.prepare(
      `UPDATE test_cases SET automation_repo_path = ?, automation_file = ?, engineering_task_id = ? WHERE id = ?`,
    ).run(repoPath, automationFile, taskId, id);
    return this.getTestDesignCase(id);
  }

  linkTestCaseUiRun(id: string, runId: string): TestDesignCaseRecord {
    this.getTestDesignCase(id);
    this.getUiTestRun(runId);
    this.db.prepare("INSERT INTO test_case_ui_runs VALUES (?, ?)").run(id, runId);
    return this.getTestDesignCase(id);
  }

  createOpenApiSpec(input: {
    name: string;
    version: string;
    filename: string;
    content: string;
    operations: Array<{ operationId: string; method: string; path: string; summary: string }>;
  }): OpenApiSpecRecord {
    const specId = randomUUID();
    const create = this.db.transaction(() => {
      this.db.prepare("INSERT INTO openapi_specs VALUES (?, ?, ?, ?, ?, ?)").run(
        specId,
        input.name,
        input.version,
        input.filename,
        input.content,
        new Date().toISOString(),
      );
      const insert = this.db.prepare(
        `INSERT INTO test_cases
         (id, source, spec_id, operation_id, method, path, summary, title, test_type,
          objective, review_status, created_at)
         VALUES (?, 'api', ?, ?, ?, ?, ?, ?, 'api', ?, 'approved', ?)`,
      );
      for (const operation of input.operations) {
        insert.run(
          randomUUID(),
          specId,
          operation.operationId,
          operation.method,
          operation.path,
          operation.summary,
          operation.summary,
          operation.summary,
          new Date().toISOString(),
        );
      }
    });
    create();
    return this.getOpenApiSpec(specId);
  }

  getOpenApiSpec(specId: string): OpenApiSpecRecord {
    const spec = this.db
      .prepare("SELECT id, name, version, filename FROM openapi_specs WHERE id = ?")
      .get(specId) as Omit<OpenApiSpecRecord, "testCases"> | undefined;
    if (!spec) throw new Error(`OpenAPI ${specId} 不存在`);
    return { ...spec, testCases: this.listTestCases(specId) };
  }

  getOpenApiContent(specId: string): string {
    const row = this.db.prepare("SELECT content FROM openapi_specs WHERE id = ?").get(specId) as
      | { content: string }
      | undefined;
    if (!row) throw new Error(`OpenAPI ${specId} 不存在`);
    return row.content;
  }

  private listTestCases(specId: string): TestCaseRecord[] {
    const rows = this.db
      .prepare(
        `SELECT id, spec_id AS specId, operation_id AS operationId, method, path, summary
         FROM test_cases WHERE spec_id = ? ORDER BY path, method`,
      )
      .all(specId) as Array<Omit<TestCaseRecord, "requirementIds" | "evidenceIds">>;
    const requirementIds = this.db.prepare(
      "SELECT requirement_id AS id FROM test_case_requirements WHERE test_case_id = ?",
    );
    const evidenceIds = this.db.prepare(
      "SELECT evidence_id AS id FROM test_case_evidence WHERE test_case_id = ?",
    );
    return rows.map((row) => ({
      ...row,
      requirementIds: (requirementIds.all(row.id) as Array<{ id: string }>).map((item) => item.id),
      evidenceIds: (evidenceIds.all(row.id) as Array<{ id: string }>).map((item) => item.id),
    }));
  }

  updateTestCaseLinks(testCaseId: string, requirementIds: string[], evidenceIds: string[]): void {
    const update = this.db.transaction(() => {
      const exists = this.db.prepare("SELECT 1 FROM test_cases WHERE id = ?").get(testCaseId);
      if (!exists) throw new Error(`TestCase ${testCaseId} 不存在`);
      this.db.prepare("DELETE FROM test_case_requirements WHERE test_case_id = ?").run(testCaseId);
      this.db.prepare("DELETE FROM test_case_evidence WHERE test_case_id = ?").run(testCaseId);
      const addRequirement = this.db.prepare("INSERT INTO test_case_requirements VALUES (?, ?)");
      const addEvidence = this.db.prepare("INSERT INTO test_case_evidence VALUES (?, ?)");
      for (const id of requirementIds) addRequirement.run(testCaseId, id);
      for (const id of evidenceIds) addEvidence.run(testCaseId, id);
    });
    update();
  }

  assertSpecTraceable(specId: string): void {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS missing
         FROM test_cases tc
         WHERE tc.spec_id = ? AND (
           NOT EXISTS (SELECT 1 FROM test_case_requirements tcr WHERE tcr.test_case_id = tc.id)
           OR NOT EXISTS (SELECT 1 FROM test_case_evidence tce WHERE tce.test_case_id = tc.id)
         )`,
      )
      .get(specId) as { missing: number };
    if (row.missing > 0) {
      throw new Error(`${row.missing} 个 TestCase 尚未同时关联需求和证据`);
    }
  }

  createTestRun(specId: string, targetBaseUrl: string): string {
    this.getOpenApiSpec(specId);
    const id = randomUUID();
    this.db.prepare(
      `INSERT INTO test_runs
       (id, spec_id, target_base_url, status, started_at)
       VALUES (?, ?, ?, 'running', ?)`,
    ).run(id, specId, targetBaseUrl, new Date().toISOString());
    return id;
  }

  finishTestRun(input: {
    id: string;
    status: "passed" | "failed" | "error";
    generatedExamples: number;
    passed: number;
    failed: number;
    exitCode: number;
    runnerOutput: string;
    items: TestRunItemInput[];
  }): TestRunRecord {
    const save = this.db.transaction(() => {
      this.db.prepare(
        `UPDATE test_runs SET status = ?, finished_at = ?, generated_examples = ?, passed = ?, failed = ?,
         exit_code = ?, runner_output = ? WHERE id = ?`,
      ).run(
        input.status,
        new Date().toISOString(),
        input.generatedExamples,
        input.passed,
        input.failed,
        input.exitCode,
        input.runnerOutput,
        input.id,
      );
      const insert = this.db.prepare(
        `INSERT INTO test_run_items
         (id, run_id, test_case_id, operation, status, duration_ms, failure_type, checks,
          request_text, response_text, reproduction, detail)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const item of input.items) {
        insert.run(
          randomUUID(),
          input.id,
          item.testCaseId,
          item.operation,
          item.status,
          item.durationMs,
          item.failureType,
          JSON.stringify(item.checks),
          item.request,
          item.response,
          item.reproduction,
          item.detail,
        );
      }
    });
    save();
    return this.getTestRun(input.id);
  }

  getTestCaseForOperation(specId: string, operation: string): string | null {
    const match = /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS|TRACE)\s+(.+)$/i.exec(operation.trim());
    if (!match) return null;
    const row = this.db
      .prepare("SELECT id FROM test_cases WHERE spec_id = ? AND method = ? AND path = ?")
      .get(specId, match[1].toUpperCase(), match[2]) as { id: string } | undefined;
    return row?.id ?? null;
  }

  getTestRun(id: string): TestRunRecord {
    const row = this.db
      .prepare(
        `SELECT id, spec_id AS specId, target_base_url AS targetBaseUrl, status,
                started_at AS startedAt, finished_at AS finishedAt,
                generated_examples AS generatedExamples, passed, failed,
                exit_code AS exitCode, runner_output AS runnerOutput
         FROM test_runs WHERE id = ?`,
      )
      .get(id) as Omit<TestRunRecord, "items"> | undefined;
    if (!row) throw new Error(`TestRun ${id} 不存在`);
    const items = this.db
      .prepare(
        `SELECT id, test_case_id AS testCaseId, operation, status, duration_ms AS durationMs,
                failure_type AS failureType, checks, request_text AS request,
                response_text AS response, reproduction, detail
         FROM test_run_items WHERE run_id = ? ORDER BY rowid`,
      )
      .all(id) as Array<Omit<TestRunRecord["items"][number], "checks"> & { checks: string }>;
    return {
      ...row,
      items: items.map((item) => ({ ...item, checks: JSON.parse(item.checks) as string[] })),
    };
  }

  createEngineeringTask(input: {
    repoPath: string;
    instruction: string;
    selectedFiles: string[];
    logContext: string;
    dockerContainerId: string;
    dockerContainerName: string;
    dockerContext: string;
    model: string;
    agentServerImage: string;
    clientVersion: string;
  }): EngineeringTaskRecord {
    const id = randomUUID();
    this.db.prepare(
      `INSERT INTO engineering_tasks
       (id, repo_path, instruction, selected_files, log_context, docker_container_id,
        docker_container_name, docker_context, status, model, agent_server_image,
        client_version, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?, ?)`,
    ).run(
      id,
      input.repoPath,
      input.instruction,
      JSON.stringify(input.selectedFiles),
      input.logContext,
      input.dockerContainerId,
      input.dockerContainerName,
      input.dockerContext,
      input.model,
      input.agentServerImage,
      input.clientVersion,
      new Date().toISOString(),
    );
    return this.getEngineeringTask(id);
  }

  markEngineeringTaskStarted(id: string): void {
    this.db.prepare(
      "UPDATE engineering_tasks SET status = 'starting', started_at = ? WHERE id = ?",
    ).run(new Date().toISOString(), id);
  }

  markEngineeringTaskRunning(id: string, conversationId: string): void {
    this.db.prepare(
      "UPDATE engineering_tasks SET status = 'running', conversation_id = ? WHERE id = ?",
    ).run(conversationId, id);
  }

  addEngineeringEvent(input: {
    taskId: string;
    ordinal: number;
    kind: string;
    source: string;
    timestamp: string;
    payload: unknown;
    terminalOutput: string;
  }): void {
    this.db.prepare(
      `INSERT INTO engineering_task_events
       (id, task_id, ordinal, kind, source, timestamp, payload, terminal_output)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      randomUUID(),
      input.taskId,
      input.ordinal,
      input.kind,
      input.source,
      input.timestamp,
      JSON.stringify(input.payload),
      input.terminalOutput,
    );
  }

  finishEngineeringTask(input: {
    id: string;
    status: "completed" | "failed" | "stopped";
    finalResponse: string;
    terminalOutput: string;
    gitDiff: string;
    tokenUsage: unknown;
    cost: number | null;
    error: string;
  }): EngineeringTaskRecord {
    this.db.prepare(
      `UPDATE engineering_tasks
       SET status = ?, final_response = ?, terminal_output = ?, git_diff = ?, token_usage = ?,
           cost = ?, error = ?, completed_at = ?
       WHERE id = ?`,
    ).run(
      input.status,
      input.finalResponse,
      input.terminalOutput,
      input.gitDiff,
      JSON.stringify(input.tokenUsage),
      input.cost,
      input.error,
      new Date().toISOString(),
      input.id,
    );
    return this.getEngineeringTask(input.id);
  }

  listEngineeringTasks(): EngineeringTaskRecord[] {
    const ids = this.db
      .prepare("SELECT id FROM engineering_tasks ORDER BY created_at DESC LIMIT 20")
      .all() as Array<{ id: string }>;
    return ids.map(({ id }) => this.getEngineeringTask(id));
  }

  getEngineeringTask(id: string): EngineeringTaskRecord {
    const row = this.db.prepare(
      `SELECT id, repo_path AS repoPath, instruction, selected_files AS selectedFiles,
              log_context AS logContext, docker_container_id AS dockerContainerId,
              docker_container_name AS dockerContainerName, docker_context AS dockerContext,
              status, model, agent_server_image AS agentServerImage,
              client_version AS clientVersion, conversation_id AS conversationId,
              final_response AS finalResponse, terminal_output AS terminalOutput,
              git_diff AS gitDiff, token_usage AS tokenUsage, cost, error,
              created_at AS createdAt, started_at AS startedAt, completed_at AS completedAt
       FROM engineering_tasks WHERE id = ?`,
    ).get(id) as
      | (Omit<EngineeringTaskRecord, "selectedFiles" | "tokenUsage" | "events"> & {
          selectedFiles: string;
          tokenUsage: string;
        })
      | undefined;
    if (!row) throw new Error(`工程任务 ${id} 不存在`);
    const events = this.db.prepare(
      `SELECT id, task_id AS taskId, ordinal, kind, source, timestamp, payload,
              terminal_output AS terminalOutput
       FROM engineering_task_events WHERE task_id = ? ORDER BY ordinal`,
    ).all(id) as Array<Omit<EngineeringEventRecord, "payload"> & { payload: string }>;
    return {
      ...row,
      selectedFiles: JSON.parse(row.selectedFiles) as string[],
      tokenUsage: JSON.parse(row.tokenUsage) as unknown,
      events: events.map((event) => ({ ...event, payload: JSON.parse(event.payload) as unknown })),
    };
  }

  createUiTestRun(input: {
    repoPath: string;
    testFile: string;
    playwrightVersion: string;
    image: string;
    containerName: string;
  }): UiTestRunRecord {
    const id = randomUUID();
    this.db.prepare(
      `INSERT INTO ui_test_runs
       (id, repo_path, test_file, status, playwright_version, image, container_name, started_at)
       VALUES (?, ?, ?, 'running', ?, ?, ?, ?)`,
    ).run(
      id,
      input.repoPath,
      input.testFile,
      input.playwrightVersion,
      input.image,
      input.containerName,
      new Date().toISOString(),
    );
    return this.getUiTestRun(id);
  }

  finishUiTestRun(input: {
    id: string;
    status: "passed" | "failed" | "error";
    passed: number;
    failed: number;
    skipped: number;
    exitCode: number;
    runnerOutput: string;
    error: string;
    results: UiTestResultInput[];
    artifacts: Array<{ name: string; kind: "trace"; path: string }>;
  }): UiTestRunRecord {
    const save = this.db.transaction(() => {
      this.db.prepare(
        `UPDATE ui_test_runs SET status = ?, finished_at = ?, passed = ?, failed = ?, skipped = ?,
         exit_code = ?, runner_output = ?, error = ? WHERE id = ?`,
      ).run(
        input.status,
        new Date().toISOString(),
        input.passed,
        input.failed,
        input.skipped,
        input.exitCode,
        input.runnerOutput,
        input.error,
        input.id,
      );
      const insertResult = this.db.prepare(
        `INSERT INTO ui_test_results
         (id, run_id, title, project_name, status, duration_ms, error)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const result of input.results) {
        insertResult.run(
          randomUUID(),
          input.id,
          result.title,
          result.projectName,
          result.status,
          result.durationMs,
          result.error,
        );
      }
      const insertArtifact = this.db.prepare(
        `INSERT INTO ui_test_artifacts (id, run_id, name, kind, path) VALUES (?, ?, ?, ?, ?)`,
      );
      for (const artifact of input.artifacts) {
        insertArtifact.run(randomUUID(), input.id, artifact.name, artifact.kind, artifact.path);
      }
    });
    save();
    return this.getUiTestRun(input.id);
  }

  listUiTestRuns(): UiTestRunRecord[] {
    const ids = this.db
      .prepare("SELECT id FROM ui_test_runs ORDER BY started_at DESC LIMIT 20")
      .all() as Array<{ id: string }>;
    return ids.map(({ id }) => this.getUiTestRun(id));
  }

  getUiTestRun(id: string): UiTestRunRecord {
    const row = this.db.prepare(
      `SELECT id, repo_path AS repoPath, test_file AS testFile, status,
              playwright_version AS playwrightVersion, image, container_name AS containerName,
              started_at AS startedAt, finished_at AS finishedAt, passed, failed, skipped,
              exit_code AS exitCode, runner_output AS runnerOutput, error
       FROM ui_test_runs WHERE id = ?`,
    ).get(id) as Omit<UiTestRunRecord, "results" | "artifacts"> | undefined;
    if (!row) throw new Error(`UI TestRun ${id} 不存在`);
    const results = this.db.prepare(
      `SELECT id, title, project_name AS projectName, status, duration_ms AS durationMs, error
       FROM ui_test_results WHERE run_id = ? ORDER BY rowid`,
    ).all(id) as UiTestRunRecord["results"];
    const artifacts = this.db.prepare(
      `SELECT id, run_id AS runId, name, kind FROM ui_test_artifacts WHERE run_id = ? ORDER BY rowid`,
    ).all(id) as UiTestArtifactRecord[];
    return { ...row, results, artifacts };
  }

  getUiTestArtifact(runId: string, artifactId: string): { name: string; path: string } {
    const row = this.db.prepare(
      "SELECT name, path FROM ui_test_artifacts WHERE id = ? AND run_id = ?",
    ).get(artifactId, runId) as { name: string; path: string } | undefined;
    if (!row) throw new Error("该 Trace Evidence 不存在");
    return row;
  }

  createAndroidTestRun(input: {
    repoPath: string;
    configFile: string;
    testFile: string;
    deviceSerial: string;
    platformVersion: string;
    appiumVersion: string;
    driverVersion: string;
    wdioVersion: string;
  }): AndroidTestRunRecord {
    const id = randomUUID();
    this.db.prepare(
      `INSERT INTO android_test_runs
       (id, repo_path, config_file, test_file, status, device_serial, platform_version,
        appium_version, driver_version, wdio_version, started_at)
       VALUES (?, ?, ?, ?, 'running', ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      input.repoPath,
      input.configFile,
      input.testFile,
      input.deviceSerial,
      input.platformVersion,
      input.appiumVersion,
      input.driverVersion,
      input.wdioVersion,
      new Date().toISOString(),
    );
    return this.getAndroidTestRun(id);
  }

  finishAndroidTestRun(input: {
    id: string;
    status: "passed" | "failed" | "error";
    passed: number;
    failed: number;
    skipped: number;
    exitCode: number;
    runnerOutput: string;
    error: string;
    results: AndroidTestResultInput[];
    artifacts: Array<{
      name: string;
      kind: "screenshot" | "page_source" | "appium_log";
      path: string;
    }>;
  }): AndroidTestRunRecord {
    const save = this.db.transaction(() => {
      this.db.prepare(
        `UPDATE android_test_runs SET status = ?, finished_at = ?, passed = ?, failed = ?, skipped = ?,
         exit_code = ?, runner_output = ?, error = ? WHERE id = ?`,
      ).run(
        input.status,
        new Date().toISOString(),
        input.passed,
        input.failed,
        input.skipped,
        input.exitCode,
        input.runnerOutput,
        input.error,
        input.id,
      );
      const insertResult = this.db.prepare(
        `INSERT INTO android_test_results
         (id, run_id, title, suite, status, duration_ms, error)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const result of input.results) {
        insertResult.run(
          randomUUID(),
          input.id,
          result.title,
          result.suite,
          result.status,
          result.durationMs,
          result.error,
        );
      }
      const insertArtifact = this.db.prepare(
        `INSERT INTO android_test_artifacts (id, run_id, name, kind, path) VALUES (?, ?, ?, ?, ?)`,
      );
      for (const artifact of input.artifacts) {
        insertArtifact.run(randomUUID(), input.id, artifact.name, artifact.kind, artifact.path);
      }
    });
    save();
    return this.getAndroidTestRun(input.id);
  }

  listAndroidTestRuns(): AndroidTestRunRecord[] {
    const ids = this.db
      .prepare("SELECT id FROM android_test_runs ORDER BY started_at DESC LIMIT 20")
      .all() as Array<{ id: string }>;
    return ids.map(({ id }) => this.getAndroidTestRun(id));
  }

  getAndroidTestRun(id: string): AndroidTestRunRecord {
    const row = this.db.prepare(
      `SELECT id, repo_path AS repoPath, config_file AS configFile, test_file AS testFile, status,
              device_serial AS deviceSerial, platform_version AS platformVersion,
              appium_version AS appiumVersion, driver_version AS driverVersion,
              wdio_version AS wdioVersion, started_at AS startedAt, finished_at AS finishedAt,
              passed, failed, skipped, exit_code AS exitCode, runner_output AS runnerOutput, error
       FROM android_test_runs WHERE id = ?`,
    ).get(id) as Omit<AndroidTestRunRecord, "results" | "artifacts"> | undefined;
    if (!row) throw new Error(`Android TestRun ${id} 不存在`);
    const results = this.db.prepare(
      `SELECT id, title, suite, status, duration_ms AS durationMs, error
       FROM android_test_results WHERE run_id = ? ORDER BY rowid`,
    ).all(id) as AndroidTestRunRecord["results"];
    const artifacts = this.db.prepare(
      `SELECT id, run_id AS runId, name, kind
       FROM android_test_artifacts WHERE run_id = ? ORDER BY rowid`,
    ).all(id) as AndroidTestArtifactRecord[];
    return { ...row, results, artifacts };
  }

  getAndroidTestArtifact(runId: string, artifactId: string): { name: string; path: string } {
    const row = this.db.prepare(
      "SELECT name, path FROM android_test_artifacts WHERE id = ? AND run_id = ?",
    ).get(artifactId, runId) as { name: string; path: string } | undefined;
    if (!row) throw new Error("该 Android Evidence 不存在");
    return row;
  }

  createPerformanceTestRun(input: {
    repoPath: string;
    scriptFile: string;
    k6Version: string;
  }): PerformanceTestRunRecord {
    const id = randomUUID();
    this.db.prepare(
      `INSERT INTO performance_test_runs
       (id, repo_path, script_file, status, k6_version, started_at)
       VALUES (?, ?, ?, 'running', ?, ?)`,
    ).run(id, input.repoPath, input.scriptFile, input.k6Version, new Date().toISOString());
    return this.getPerformanceTestRun(id);
  }

  finishPerformanceTestRun(input: {
    id: string;
    status: "passed" | "failed" | "error";
    exitCode: number;
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
    summaryJson: string;
    error: string;
    thresholds: PerformanceThresholdInput[];
    artifacts: Array<{ name: string; kind: "summary" | "terminal_output"; path: string }>;
  }): PerformanceTestRunRecord {
    const save = this.db.transaction(() => {
      this.db.prepare(
        `UPDATE performance_test_runs SET status = ?, finished_at = ?, exit_code = ?,
         http_requests = ?, request_failed_rate = ?, iterations = ?, checks_passed = ?,
         checks_failed = ?, duration_avg_ms = ?, duration_p90_ms = ?, duration_p95_ms = ?,
         duration_max_ms = ?, runner_output = ?, summary_json = ?, error = ? WHERE id = ?`,
      ).run(
        input.status,
        new Date().toISOString(),
        input.exitCode,
        input.httpRequests,
        input.requestFailedRate,
        input.iterations,
        input.checksPassed,
        input.checksFailed,
        input.durationAvgMs,
        input.durationP90Ms,
        input.durationP95Ms,
        input.durationMaxMs,
        input.runnerOutput,
        input.summaryJson,
        input.error,
        input.id,
      );
      const insertThreshold = this.db.prepare(
        `INSERT INTO performance_test_thresholds
         (id, run_id, metric, expression, failed) VALUES (?, ?, ?, ?, ?)`,
      );
      for (const threshold of input.thresholds) {
        insertThreshold.run(
          randomUUID(),
          input.id,
          threshold.metric,
          threshold.expression,
          threshold.failed ? 1 : 0,
        );
      }
      const insertArtifact = this.db.prepare(
        `INSERT INTO performance_test_artifacts
         (id, run_id, name, kind, path) VALUES (?, ?, ?, ?, ?)`,
      );
      for (const artifact of input.artifacts) {
        insertArtifact.run(randomUUID(), input.id, artifact.name, artifact.kind, artifact.path);
      }
    });
    save();
    return this.getPerformanceTestRun(input.id);
  }

  listPerformanceTestRuns(): PerformanceTestRunRecord[] {
    const ids = this.db
      .prepare("SELECT id FROM performance_test_runs ORDER BY started_at DESC LIMIT 20")
      .all() as Array<{ id: string }>;
    return ids.map(({ id }) => this.getPerformanceTestRun(id));
  }

  getPerformanceTestRun(id: string): PerformanceTestRunRecord {
    const row = this.db.prepare(
      `SELECT id, repo_path AS repoPath, script_file AS scriptFile, status,
              k6_version AS k6Version, started_at AS startedAt, finished_at AS finishedAt,
              exit_code AS exitCode, http_requests AS httpRequests,
              request_failed_rate AS requestFailedRate, iterations, checks_passed AS checksPassed,
              checks_failed AS checksFailed, duration_avg_ms AS durationAvgMs,
              duration_p90_ms AS durationP90Ms, duration_p95_ms AS durationP95Ms,
              duration_max_ms AS durationMaxMs, runner_output AS runnerOutput, error
       FROM performance_test_runs WHERE id = ?`,
    ).get(id) as Omit<PerformanceTestRunRecord, "thresholds" | "artifacts"> | undefined;
    if (!row) throw new Error(`性能 TestRun ${id} 不存在`);
    const thresholds = this.db.prepare(
      `SELECT id, metric, expression, failed
       FROM performance_test_thresholds WHERE run_id = ? ORDER BY rowid`,
    ).all(id) as Array<{ id: string; metric: string; expression: string; failed: number }>;
    const artifacts = this.db.prepare(
      `SELECT id, run_id AS runId, name, kind
       FROM performance_test_artifacts WHERE run_id = ? ORDER BY rowid`,
    ).all(id) as PerformanceTestArtifactRecord[];
    return {
      ...row,
      thresholds: thresholds.map((item) => ({ ...item, failed: Boolean(item.failed) })),
      artifacts,
    };
  }

  getPerformanceTestArtifact(runId: string, artifactId: string): { name: string; path: string } {
    const row = this.db.prepare(
      "SELECT name, path FROM performance_test_artifacts WHERE id = ? AND run_id = ?",
    ).get(artifactId, runId) as { name: string; path: string } | undefined;
    if (!row) throw new Error("该性能测试 Evidence 不存在");
    return row;
  }

  createSecurityTestRun(targetUrl: string, zapVersion: string): SecurityTestRunRecord {
    const id = randomUUID();
    this.db.prepare(
      `INSERT INTO security_test_runs
       (id, target_url, status, zap_version, started_at)
       VALUES (?, ?, 'running', ?, ?)`,
    ).run(id, targetUrl, zapVersion, new Date().toISOString());
    return this.getSecurityTestRun(id);
  }

  finishSecurityTestRun(input: {
    id: string;
    status: "completed" | "error";
    exitCode: number;
    high: number;
    medium: number;
    low: number;
    informational: number;
    runnerOutput: string;
    error: string;
    findings: SecurityFindingInput[];
    artifacts: Array<{ name: string; kind: "report" | "terminal_output"; path: string }>;
  }): SecurityTestRunRecord {
    const save = this.db.transaction(() => {
      this.db.prepare(
        `UPDATE security_test_runs SET status = ?, finished_at = ?, exit_code = ?, high = ?,
         medium = ?, low = ?, informational = ?, total_findings = ?, runner_output = ?,
         error = ? WHERE id = ?`,
      ).run(
        input.status,
        new Date().toISOString(),
        input.exitCode,
        input.high,
        input.medium,
        input.low,
        input.informational,
        input.findings.length,
        input.runnerOutput,
        input.error,
        input.id,
      );
      const insertFinding = this.db.prepare(
        `INSERT INTO security_test_findings
         (id, run_id, plugin_id, name, risk, confidence, url, method, parameter,
          evidence, description, solution, reference)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const finding of input.findings) {
        insertFinding.run(
          randomUUID(),
          input.id,
          finding.pluginId,
          finding.name,
          finding.risk,
          finding.confidence,
          finding.url,
          finding.method,
          finding.parameter,
          finding.evidence,
          finding.description,
          finding.solution,
          finding.reference,
        );
      }
      const insertArtifact = this.db.prepare(
        `INSERT INTO security_test_artifacts
         (id, run_id, name, kind, path) VALUES (?, ?, ?, ?, ?)`,
      );
      for (const artifact of input.artifacts) {
        insertArtifact.run(randomUUID(), input.id, artifact.name, artifact.kind, artifact.path);
      }
    });
    save();
    return this.getSecurityTestRun(input.id);
  }

  listSecurityTestRuns(): SecurityTestRunRecord[] {
    const ids = this.db
      .prepare("SELECT id FROM security_test_runs ORDER BY started_at DESC LIMIT 20")
      .all() as Array<{ id: string }>;
    return ids.map(({ id }) => this.getSecurityTestRun(id));
  }

  getSecurityTestRun(id: string): SecurityTestRunRecord {
    const row = this.db.prepare(
      `SELECT id, target_url AS targetUrl, status, zap_version AS zapVersion,
              started_at AS startedAt, finished_at AS finishedAt, exit_code AS exitCode,
              high, medium, low, informational, total_findings AS totalFindings,
              runner_output AS runnerOutput, error
       FROM security_test_runs WHERE id = ?`,
    ).get(id) as Omit<SecurityTestRunRecord, "findings" | "artifacts"> | undefined;
    if (!row) throw new Error(`安全 TestRun ${id} 不存在`);
    const findings = this.db.prepare(
      `SELECT id, plugin_id AS pluginId, name, risk, confidence, url, method,
              parameter, evidence, description, solution, reference
       FROM security_test_findings WHERE run_id = ? ORDER BY rowid`,
    ).all(id) as SecurityTestRunRecord["findings"];
    const artifacts = this.db.prepare(
      `SELECT id, run_id AS runId, name, kind
       FROM security_test_artifacts WHERE run_id = ? ORDER BY rowid`,
    ).all(id) as SecurityTestArtifactRecord[];
    return { ...row, findings, artifacts };
  }

  getSecurityTestArtifact(runId: string, artifactId: string): { name: string; path: string } {
    const row = this.db.prepare(
      "SELECT name, path FROM security_test_artifacts WHERE id = ? AND run_id = ?",
    ).get(artifactId, runId) as { name: string; path: string } | undefined;
    if (!row) throw new Error("该安全测试 Evidence 不存在");
    return row;
  }
}

export function defaultDatabasePath(): string {
  return process.env.TESTMESH_DB_PATH ?? path.resolve("data", "testmesh.db");
}
