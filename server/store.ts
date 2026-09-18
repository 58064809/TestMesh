import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { AnalysisResult } from "./analysis.js";

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
  created_at TEXT NOT NULL
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
  spec_id TEXT NOT NULL REFERENCES openapi_specs(id) ON DELETE CASCADE,
  operation_id TEXT NOT NULL,
  method TEXT NOT NULL,
  path TEXT NOT NULL,
  summary TEXT NOT NULL,
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
    this.removeDeprecatedAgentData();
  }

  private removeDeprecatedAgentData(): void {
    const columns = this.db.pragma("table_info(test_cases)") as Array<{ name: string }>;
    if (!columns.some((column) => column.name === "source")) {
      this.db.exec(`
        DROP TABLE IF EXISTS test_case_risks;
        DROP TABLE IF EXISTS test_case_ui_runs;
        DROP TABLE IF EXISTS engineering_task_events;
        DROP TABLE IF EXISTS engineering_tasks;
      `);
      return;
    }

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
          spec_id TEXT NOT NULL REFERENCES openapi_specs(id) ON DELETE CASCADE,
          operation_id TEXT NOT NULL,
          method TEXT NOT NULL,
          path TEXT NOT NULL,
          summary TEXT NOT NULL,
          UNIQUE(spec_id, method, path)
        );
        INSERT INTO test_cases (id, spec_id, operation_id, method, path, summary)
        SELECT id, spec_id, operation_id, method, path, summary
        FROM test_cases_legacy WHERE source = 'api' AND spec_id IS NOT NULL;
        CREATE TABLE test_case_requirements (
          test_case_id TEXT NOT NULL REFERENCES test_cases(id) ON DELETE CASCADE,
          requirement_id TEXT NOT NULL REFERENCES requirements(id) ON DELETE CASCADE,
          PRIMARY KEY (test_case_id, requirement_id)
        );
        INSERT INTO test_case_requirements
        SELECT legacy.* FROM test_case_requirements_legacy legacy
        JOIN test_cases current_case ON current_case.id = legacy.test_case_id;
        CREATE TABLE test_case_evidence (
          test_case_id TEXT NOT NULL REFERENCES test_cases(id) ON DELETE CASCADE,
          evidence_id TEXT NOT NULL REFERENCES evidence(id) ON DELETE CASCADE,
          PRIMARY KEY (test_case_id, evidence_id)
        );
        INSERT INTO test_case_evidence
        SELECT legacy.* FROM test_case_evidence_legacy legacy
        JOIN test_cases current_case ON current_case.id = legacy.test_case_id;
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
        INSERT INTO test_run_items
        SELECT id, run_id,
               CASE WHEN test_case_id IN (SELECT id FROM test_cases) THEN test_case_id ELSE NULL END,
               operation, status, duration_ms, failure_type, checks, request_text,
               response_text, reproduction, detail
        FROM test_run_items_legacy;
        DROP TABLE test_case_requirements_legacy;
        DROP TABLE test_case_evidence_legacy;
        DROP TABLE test_run_items_legacy;
        DROP TABLE test_cases_legacy;
        DROP TABLE IF EXISTS engineering_task_events;
        DROP TABLE IF EXISTS engineering_tasks;
        COMMIT;
      `);
    } catch (error) {
      if (this.db.inTransaction) this.db.exec("ROLLBACK");
      throw error;
    } finally {
      this.db.pragma("foreign_keys = ON");
    }
    const violations = this.db.pragma("foreign_key_check") as unknown[];
    if (violations.length > 0) throw new Error("废弃 Agent 数据清理后外键校验失败");
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
        "INSERT INTO test_cases (id, spec_id, operation_id, method, path, summary) VALUES (?, ?, ?, ?, ?, ?)",
      );
      for (const operation of input.operations) {
        insert.run(
          randomUUID(),
          specId,
          operation.operationId,
          operation.method,
          operation.path,
          operation.summary,
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
