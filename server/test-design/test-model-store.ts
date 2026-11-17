import { randomUUID } from "node:crypto";
import type pg from "pg";
import {
  BaselineSnapshotSchema,
  TestModelDocumentSchema,
  type ApprovedTestModelVersionRecord,
  type TestModelDocument,
  type TestModelRecord,
} from "./schema.js";
import { validateTestModel } from "./validation.js";

export class TestModelPostgresStore {
  constructor(private readonly pool: pg.Pool, private readonly schema = "testmesh_business") {}

  async setup(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS ${this.schema}.test_models (
        id TEXT PRIMARY KEY,
        baseline_id TEXT NOT NULL REFERENCES ${this.schema}.requirement_baselines(id) ON DELETE RESTRICT,
        version INTEGER NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('draft', 'approved')),
        model TEXT NOT NULL,
        document_json JSONB NOT NULL,
        trace_provider TEXT NOT NULL DEFAULT '',
        trace_project_name TEXT NOT NULL DEFAULT '',
        trace_id TEXT NOT NULL DEFAULT '',
        approved_by TEXT NOT NULL DEFAULT '',
        approved_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (baseline_id, version)
      );
      CREATE TABLE IF NOT EXISTS ${this.schema}.test_model_amendment_events (
        sequence BIGSERIAL PRIMARY KEY,
        id TEXT NOT NULL UNIQUE,
        test_model_id TEXT NOT NULL REFERENCES ${this.schema}.test_models(id) ON DELETE CASCADE,
        editor TEXT NOT NULL,
        reason TEXT NOT NULL,
        before_json JSONB NOT NULL,
        after_json JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS ${this.schema}.approved_test_model_versions (
        id TEXT PRIMARY KEY,
        test_model_id TEXT NOT NULL UNIQUE REFERENCES ${this.schema}.test_models(id) ON DELETE RESTRICT,
        baseline_id TEXT NOT NULL REFERENCES ${this.schema}.requirement_baselines(id) ON DELETE RESTRICT,
        version INTEGER NOT NULL,
        approved_by TEXT NOT NULL,
        snapshot_json JSONB NOT NULL,
        approved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (baseline_id, version)
      );
      CREATE INDEX IF NOT EXISTS test_models_baseline_idx ON ${this.schema}.test_models (baseline_id, version DESC);
    `);
  }

  async create(input: {
    baselineId: string;
    model: string;
    document: TestModelDocument;
    trace?: { provider: string; projectName: string; traceId: string };
  }): Promise<TestModelRecord> {
    const id = randomUUID();
    const result = await this.pool.query(
      `INSERT INTO ${this.schema}.test_models
       (id, baseline_id, version, status, model, document_json, trace_provider, trace_project_name, trace_id)
       SELECT $1, $2, COALESCE(MAX(version), 0) + 1, 'draft', $3, $4, $5, $6, $7
       FROM ${this.schema}.test_models WHERE baseline_id = $2 RETURNING *`,
      [id, input.baselineId, input.model, input.document, input.trace?.provider ?? "", input.trace?.projectName ?? "", input.trace?.traceId ?? ""],
    );
    return this.parse(result.rows[0]);
  }

  async list(baselineId?: string): Promise<TestModelRecord[]> {
    const result = await this.pool.query(
      `SELECT * FROM ${this.schema}.test_models WHERE ($1::text IS NULL OR baseline_id = $1) ORDER BY created_at DESC`,
      [baselineId ?? null],
    );
    return result.rows.map((row) => this.parse(row));
  }

  async get(id: string): Promise<TestModelRecord> {
    const result = await this.pool.query(`SELECT * FROM ${this.schema}.test_models WHERE id = $1`, [id]);
    if (result.rowCount !== 1) throw new Error(`测试模型 ${id} 不存在`);
    return this.parse(result.rows[0]);
  }

  async amend(id: string, input: { document: unknown; editor: string; reason: string }): Promise<TestModelRecord> {
    if (!input.editor.trim()) throw new Error("请填写模型修正人");
    if (!input.reason.trim()) throw new Error("请填写模型修正理由");
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query(
        `SELECT model.*, baseline.snapshot_json AS baseline_snapshot
         FROM ${this.schema}.test_models model
         JOIN ${this.schema}.requirement_baselines baseline ON baseline.id = model.baseline_id
         WHERE model.id = $1 FOR UPDATE OF model`, [id],
      );
      if (result.rowCount !== 1) throw new Error(`测试模型 ${id} 不存在`);
      const current = this.parse(result.rows[0]);
      if (current.status !== "draft") throw new Error("已批准测试模型不可覆盖");
      const next = TestModelDocumentSchema.parse(input.document);
      validateTestModel(next, BaselineSnapshotSchema.parse(result.rows[0].baseline_snapshot));
      await client.query(`UPDATE ${this.schema}.test_models SET document_json = $2 WHERE id = $1`, [id, next]);
      await client.query(
        `INSERT INTO ${this.schema}.test_model_amendment_events
         (id, test_model_id, editor, reason, before_json, after_json) VALUES ($1,$2,$3,$4,$5,$6)`,
        [randomUUID(), id, input.editor.trim(), input.reason.trim(), current.document, next],
      );
      await client.query("COMMIT");
      return this.get(id);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async approve(id: string, approvedBy: string): Promise<ApprovedTestModelVersionRecord> {
    if (!approvedBy.trim()) throw new Error("请填写测试模型批准人");
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query(
        `SELECT model.*, baseline.snapshot_json AS baseline_snapshot
         FROM ${this.schema}.test_models model
         JOIN ${this.schema}.requirement_baselines baseline ON baseline.id = model.baseline_id
         WHERE model.id = $1 FOR UPDATE OF model`, [id],
      );
      if (result.rowCount !== 1) throw new Error(`测试模型 ${id} 不存在`);
      const model = this.parse(result.rows[0]);
      validateTestModel(model.document, BaselineSnapshotSchema.parse(result.rows[0].baseline_snapshot));
      const existing = await client.query(`SELECT * FROM ${this.schema}.approved_test_model_versions WHERE test_model_id = $1`, [id]);
      if (existing.rowCount) {
        await client.query("COMMIT");
        return this.parseApproved(existing.rows[0]);
      }
      const versionResult = await client.query(
        `SELECT COALESCE(MAX(version), 0) + 1 AS version FROM ${this.schema}.approved_test_model_versions WHERE baseline_id = $1`,
        [model.baselineId],
      );
      const approved = await client.query(
        `INSERT INTO ${this.schema}.approved_test_model_versions
         (id, test_model_id, baseline_id, version, approved_by, snapshot_json)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
        [randomUUID(), id, model.baselineId, Number(versionResult.rows[0].version), approvedBy.trim(), model.document],
      );
      await client.query(
        `UPDATE ${this.schema}.test_models SET status = 'approved', approved_by = $2, approved_at = NOW() WHERE id = $1`,
        [id, approvedBy.trim()],
      );
      await client.query("COMMIT");
      return this.parseApproved(approved.rows[0]);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async getApprovedVersion(id: string): Promise<{ record: ApprovedTestModelVersionRecord; snapshot: TestModelDocument }> {
    const result = await this.pool.query(`SELECT * FROM ${this.schema}.approved_test_model_versions WHERE id = $1`, [id]);
    if (result.rowCount !== 1) throw new Error(`Approved Test Model 版本 ${id} 不存在`);
    return { record: this.parseApproved(result.rows[0]), snapshot: TestModelDocumentSchema.parse(result.rows[0].snapshot_json) };
  }

  async listApprovedVersions(baselineId?: string): Promise<Array<{ record: ApprovedTestModelVersionRecord; snapshot: TestModelDocument }>> {
    const result = await this.pool.query(
      `SELECT * FROM ${this.schema}.approved_test_model_versions WHERE ($1::text IS NULL OR baseline_id = $1) ORDER BY approved_at DESC`,
      [baselineId ?? null],
    );
    return result.rows.map((row) => ({ record: this.parseApproved(row), snapshot: TestModelDocumentSchema.parse(row.snapshot_json) }));
  }

  async clearAll(): Promise<void> {
    await this.pool.query(`TRUNCATE TABLE ${this.schema}.approved_test_model_versions, ${this.schema}.test_model_amendment_events, ${this.schema}.test_models RESTART IDENTITY CASCADE`);
  }

  private parse(row: Record<string, unknown>): TestModelRecord {
    return {
      id: String(row.id), baselineId: String(row.baseline_id), version: Number(row.version),
      status: row.status as TestModelRecord["status"], model: String(row.model),
      document: TestModelDocumentSchema.parse(row.document_json), traceProvider: String(row.trace_provider ?? ""),
      traceProjectName: String(row.trace_project_name ?? ""), traceId: String(row.trace_id ?? ""),
      createdAt: this.iso(row.created_at), approvedBy: String(row.approved_by ?? ""),
      approvedAt: row.approved_at ? this.iso(row.approved_at) : null,
    };
  }

  private parseApproved(row: Record<string, unknown>): ApprovedTestModelVersionRecord {
    return {
      id: String(row.id), testModelId: String(row.test_model_id), baselineId: String(row.baseline_id),
      version: Number(row.version), approvedBy: String(row.approved_by), approvedAt: this.iso(row.approved_at),
    };
  }

  private iso(value: unknown): string { return value instanceof Date ? value.toISOString() : String(value); }
}
