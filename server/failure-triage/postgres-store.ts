import { randomUUID } from "node:crypto";
import type pg from "pg";
import {
  FailureDiagnosisContextSchema,
  FailureEvidenceSchema,
  FailureTriageSchema,
  type FailureDiagnosisContext,
  type FailureEvidence,
  type FailureTriage,
  type FailureTriageRecord,
} from "./schema.js";

export class FailureTriagePostgresStore {
  private readonly schema: string;

  constructor(private readonly pool: pg.Pool, schema = "testmesh_business") {
    if (!/^[a-z][a-z0-9_]*$/.test(schema)) throw new Error(`PostgreSQL Schema 名称不合法：${schema}`);
    this.schema = schema;
  }

  async setup(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS ${this.schema}.failure_triages (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL UNIQUE,
        project_id TEXT NOT NULL REFERENCES ${this.schema}.projects(id) ON DELETE RESTRICT,
        environment_id TEXT NOT NULL REFERENCES ${this.schema}.project_environments(id) ON DELETE RESTRICT,
        run_kind TEXT NOT NULL CHECK (run_kind IN ('api_schema', 'api_scenario', 'ui')),
        run_id TEXT NOT NULL,
        input_json JSONB NOT NULL,
        evidence_json JSONB NOT NULL,
        result_json JSONB NOT NULL,
        model TEXT NOT NULL,
        trace_provider TEXT NOT NULL DEFAULT '',
        trace_project_name TEXT NOT NULL DEFAULT '',
        trace_id TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await this.pool.query(`
      CREATE INDEX IF NOT EXISTS failure_triages_run
      ON ${this.schema}.failure_triages (run_kind, run_id, created_at DESC)
    `);
  }

  async create(input: {
    taskId: string;
    context: FailureDiagnosisContext;
    evidence: FailureEvidence[];
    result: FailureTriage;
    model: string;
    trace?: { provider: string; projectName: string; traceId: string };
  }): Promise<FailureTriageRecord> {
    const id = randomUUID();
    const inserted = await this.pool.query(
      `INSERT INTO ${this.schema}.failure_triages
        (id, task_id, project_id, environment_id, run_kind, run_id, input_json, evidence_json,
         result_json, model, trace_provider, trace_project_name, trace_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9::jsonb, $10, $11, $12, $13)
       RETURNING *`,
      [id, input.taskId, input.context.projectId, input.context.environmentId, input.context.runKind,
        input.context.runId, JSON.stringify(input.context), JSON.stringify(input.evidence), JSON.stringify(input.result),
        input.model, input.trace?.provider ?? "", input.trace?.projectName ?? "", input.trace?.traceId ?? ""],
    );
    return this.parse(inserted.rows[0]);
  }

  async list(): Promise<FailureTriageRecord[]> {
    const result = await this.pool.query(`SELECT * FROM ${this.schema}.failure_triages ORDER BY created_at DESC LIMIT 50`);
    return result.rows.map((row) => this.parse(row));
  }

  async get(id: string): Promise<FailureTriageRecord> {
    const result = await this.pool.query(`SELECT * FROM ${this.schema}.failure_triages WHERE id = $1`, [id]);
    if (result.rowCount !== 1) throw new Error(`缺陷定位记录 ${id} 不存在`);
    return this.parse(result.rows[0]);
  }

  private parse(row: Record<string, unknown>): FailureTriageRecord {
    return {
      id: String(row.id),
      taskId: String(row.task_id),
      input: FailureDiagnosisContextSchema.parse(row.input_json),
      evidence: FailureEvidenceSchema.array().parse(row.evidence_json),
      result: FailureTriageSchema.parse(row.result_json),
      model: String(row.model),
      traceProvider: String(row.trace_provider ?? ""),
      traceProjectName: String(row.trace_project_name ?? ""),
      traceId: String(row.trace_id ?? ""),
      createdAt: new Date(String(row.created_at)).toISOString(),
    };
  }
}
