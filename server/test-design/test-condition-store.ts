import { randomUUID } from "node:crypto";
import type pg from "pg";
import { TestConditionSetDocumentSchema, type TestConditionSetDocument } from "./asset-contracts.js";

export interface TestConditionSetRecord {
  id: string;
  baselineId: string;
  approvedTestModelVersionId: string;
  version: number;
  status: "draft" | "approved";
  document: TestConditionSetDocument;
  createdAt: string;
  approvedBy: string;
  approvedAt: string | null;
}

export interface ApprovedTestConditionVersionRecord {
  id: string;
  testConditionSetId: string;
  baselineId: string;
  approvedTestModelVersionId: string;
  version: number;
  approvedBy: string;
  approvedAt: string;
}

export class TestConditionPostgresStore {
  constructor(private readonly pool: pg.Pool, private readonly schema = "testmesh_business") {}

  async setup(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS ${this.schema}.test_condition_sets (
        id TEXT PRIMARY KEY,
        baseline_id TEXT NOT NULL REFERENCES ${this.schema}.requirement_baselines(id) ON DELETE RESTRICT,
        approved_test_model_version_id TEXT NOT NULL REFERENCES ${this.schema}.approved_test_model_versions(id) ON DELETE RESTRICT,
        version INTEGER NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('draft', 'approved')),
        document_json JSONB NOT NULL,
        approved_by TEXT NOT NULL DEFAULT '',
        approved_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (baseline_id, version)
      );
      CREATE TABLE IF NOT EXISTS ${this.schema}.approved_test_condition_versions (
        id TEXT PRIMARY KEY,
        test_condition_set_id TEXT NOT NULL UNIQUE REFERENCES ${this.schema}.test_condition_sets(id) ON DELETE RESTRICT,
        baseline_id TEXT NOT NULL REFERENCES ${this.schema}.requirement_baselines(id) ON DELETE RESTRICT,
        approved_test_model_version_id TEXT NOT NULL REFERENCES ${this.schema}.approved_test_model_versions(id) ON DELETE RESTRICT,
        version INTEGER NOT NULL,
        approved_by TEXT NOT NULL,
        snapshot_json JSONB NOT NULL,
        approved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (baseline_id, version)
      );
      CREATE INDEX IF NOT EXISTS test_condition_sets_baseline_idx
      ON ${this.schema}.test_condition_sets (baseline_id, version DESC);
    `);
  }

  async create(input: { baselineId: string; approvedTestModelVersionId: string; document: TestConditionSetDocument }): Promise<TestConditionSetRecord> {
    const document = TestConditionSetDocumentSchema.parse(input.document);
    if (document.baselineId !== input.baselineId || document.approvedTestModelVersionId !== input.approvedTestModelVersionId) {
      throw new Error("TestCondition 文档与来源版本不一致");
    }
    const existing = await this.findLatest(input.baselineId);
    if (existing?.approvedTestModelVersionId === input.approvedTestModelVersionId) return existing;
    const result = await this.pool.query(
      `INSERT INTO ${this.schema}.test_condition_sets
       (id, baseline_id, approved_test_model_version_id, version, status, document_json)
       SELECT $1, $2, $3, COALESCE(MAX(version), 0) + 1, 'draft', $4
       FROM ${this.schema}.test_condition_sets WHERE baseline_id = $2 RETURNING *`,
      [randomUUID(), input.baselineId, input.approvedTestModelVersionId, document],
    );
    return this.parse(result.rows[0]);
  }

  async list(baselineId?: string): Promise<TestConditionSetRecord[]> {
    const result = await this.pool.query(
      `SELECT * FROM ${this.schema}.test_condition_sets WHERE ($1::text IS NULL OR baseline_id = $1) ORDER BY created_at DESC`,
      [baselineId ?? null],
    );
    return result.rows.map((row) => this.parse(row));
  }

  async get(id: string): Promise<TestConditionSetRecord> {
    const result = await this.pool.query(`SELECT * FROM ${this.schema}.test_condition_sets WHERE id = $1`, [id]);
    if (result.rowCount !== 1) throw new Error(`测试条件集 ${id} 不存在`);
    return this.parse(result.rows[0]);
  }

  async findLatest(baselineId: string): Promise<TestConditionSetRecord | null> {
    const result = await this.pool.query(`SELECT * FROM ${this.schema}.test_condition_sets WHERE baseline_id = $1 ORDER BY version DESC LIMIT 1`, [baselineId]);
    return result.rowCount ? this.parse(result.rows[0]) : null;
  }

  async approve(id: string, approvedBy: string): Promise<ApprovedTestConditionVersionRecord> {
    if (!approvedBy.trim()) throw new Error("请填写测试条件批准人");
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query(`SELECT * FROM ${this.schema}.test_condition_sets WHERE id = $1 FOR UPDATE`, [id]);
      if (result.rowCount !== 1) throw new Error(`测试条件集 ${id} 不存在`);
      const record = this.parse(result.rows[0]);
      const existing = await client.query(`SELECT * FROM ${this.schema}.approved_test_condition_versions WHERE test_condition_set_id = $1`, [id]);
      if (existing.rowCount) {
        await client.query("COMMIT");
        return this.parseApproved(existing.rows[0]);
      }
      const inserted = await client.query(
        `INSERT INTO ${this.schema}.approved_test_condition_versions
         (id, test_condition_set_id, baseline_id, approved_test_model_version_id, version, approved_by, snapshot_json)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [randomUUID(), id, record.baselineId, record.approvedTestModelVersionId, record.version, approvedBy.trim(), record.document],
      );
      await client.query(`UPDATE ${this.schema}.test_condition_sets SET status='approved', approved_by=$2, approved_at=NOW() WHERE id=$1`, [id, approvedBy.trim()]);
      await client.query("COMMIT");
      return this.parseApproved(inserted.rows[0]);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  }

  async listApprovedVersions(baselineId?: string): Promise<Array<{ record: ApprovedTestConditionVersionRecord; snapshot: TestConditionSetDocument }>> {
    const result = await this.pool.query(
      `SELECT * FROM ${this.schema}.approved_test_condition_versions WHERE ($1::text IS NULL OR baseline_id=$1) ORDER BY approved_at DESC`,
      [baselineId ?? null],
    );
    return result.rows.map((row) => ({ record: this.parseApproved(row), snapshot: TestConditionSetDocumentSchema.parse(row.snapshot_json) }));
  }

  async getApprovedVersion(id: string): Promise<{ record: ApprovedTestConditionVersionRecord; snapshot: TestConditionSetDocument }> {
    const result = await this.pool.query(`SELECT * FROM ${this.schema}.approved_test_condition_versions WHERE id=$1`, [id]);
    if (result.rowCount !== 1) throw new Error(`Approved TestCondition 版本 ${id} 不存在`);
    return { record: this.parseApproved(result.rows[0]), snapshot: TestConditionSetDocumentSchema.parse(result.rows[0].snapshot_json) };
  }

  private parse(row: Record<string, unknown>): TestConditionSetRecord {
    return { id: String(row.id), baselineId: String(row.baseline_id), approvedTestModelVersionId: String(row.approved_test_model_version_id), version: Number(row.version), status: row.status as TestConditionSetRecord["status"], document: TestConditionSetDocumentSchema.parse(row.document_json), createdAt: this.iso(row.created_at), approvedBy: String(row.approved_by ?? ""), approvedAt: row.approved_at ? this.iso(row.approved_at) : null };
  }

  private parseApproved(row: Record<string, unknown>): ApprovedTestConditionVersionRecord {
    return { id: String(row.id), testConditionSetId: String(row.test_condition_set_id), baselineId: String(row.baseline_id), approvedTestModelVersionId: String(row.approved_test_model_version_id), version: Number(row.version), approvedBy: String(row.approved_by), approvedAt: this.iso(row.approved_at) };
  }

  private iso(value: unknown): string { return value instanceof Date ? value.toISOString() : String(value); }
}

