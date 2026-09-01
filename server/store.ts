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
  }

  close(): void {
    this.db.close();
  }

  saveAnalysis(result: AnalysisResult, model: string): string {
    const analysisId = randomUUID();
    const save = this.db.transaction(() => {
      this.db.prepare("INSERT INTO analyses VALUES (?, ?, ?, ?)").run(
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

  listTraceSources(): { requirements: TraceRequirement[]; evidence: TraceEvidence[] } {
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
    return { requirements, evidence };
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
      const insert = this.db.prepare("INSERT INTO test_cases VALUES (?, ?, ?, ?, ?, ?)");
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
}

export function defaultDatabasePath(): string {
  return process.env.TESTMESH_DB_PATH ?? path.resolve("data", "testmesh.db");
}
