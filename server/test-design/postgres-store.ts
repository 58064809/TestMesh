import { randomUUID } from "node:crypto";
import type pg from "pg";
import {
  TestDesignSchema,
  type ApprovedTestCaseVersionRecord,
  type TestCaseReviewRecord,
  type TestCaseReviewStatus,
  type TestDesign,
  type TestDesignRecord,
} from "./schema.js";

export class TestDesignPostgresStore {
  private readonly schema: string;

  constructor(private readonly pool: pg.Pool, schema = "testmesh_business") {
    if (!/^[a-z][a-z0-9_]*$/.test(schema)) throw new Error(`PostgreSQL Schema 名称不合法：${schema}`);
    this.schema = schema;
  }

  async setup(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS ${this.schema}.test_designs (
        id TEXT PRIMARY KEY,
        baseline_id TEXT NOT NULL UNIQUE REFERENCES ${this.schema}.requirement_baselines(id) ON DELETE RESTRICT,
        status TEXT NOT NULL CHECK (status IN ('draft', 'approved')),
        model TEXT NOT NULL,
        document_json JSONB NOT NULL,
        trace_provider TEXT NOT NULL DEFAULT '',
        trace_project_name TEXT NOT NULL DEFAULT '',
        trace_id TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS ${this.schema}.test_case_review_events (
        sequence BIGSERIAL PRIMARY KEY,
        id TEXT NOT NULL UNIQUE,
        design_id TEXT NOT NULL REFERENCES ${this.schema}.test_designs(id) ON DELETE CASCADE,
        test_case_id TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('accepted', 'rejected')),
        reviewer TEXT NOT NULL,
        reason TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await this.pool.query(`
      CREATE INDEX IF NOT EXISTS test_case_review_events_latest
      ON ${this.schema}.test_case_review_events (design_id, test_case_id, sequence DESC)
    `);
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS ${this.schema}.approved_test_case_versions (
        id TEXT PRIMARY KEY,
        design_id TEXT NOT NULL UNIQUE REFERENCES ${this.schema}.test_designs(id) ON DELETE RESTRICT,
        version INTEGER NOT NULL,
        approved_by TEXT NOT NULL,
        snapshot_json JSONB NOT NULL,
        approved_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
  }

  async createDesign(input: {
    baselineId: string;
    model: string;
    document: TestDesign;
    trace?: { provider: string; projectName: string; traceId: string };
  }): Promise<TestDesignRecord> {
    const id = randomUUID();
    const result = await this.pool.query(
      `INSERT INTO ${this.schema}.test_designs
        (id, baseline_id, status, model, document_json, trace_provider, trace_project_name, trace_id)
       VALUES ($1, $2, 'draft', $3, $4, $5, $6, $7) RETURNING *`,
      [id, input.baselineId, input.model, input.document, input.trace?.provider ?? "", input.trace?.projectName ?? "", input.trace?.traceId ?? ""],
    );
    return this.parseDesign(result.rows[0]);
  }

  async replaceDraft(id: string, input: {
    model: string;
    document: TestDesign;
    trace?: { provider: string; projectName: string; traceId: string };
  }): Promise<TestDesignRecord> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const current = await client.query(
        `SELECT * FROM ${this.schema}.test_designs WHERE id = $1 FOR UPDATE`,
        [id],
      );
      if (current.rowCount !== 1) throw new Error(`测试设计 ${id} 不存在`);
      if (current.rows[0].status !== "draft") throw new Error("已批准的 TestCase 版本不可重新生成");
      const reviews = await client.query(
        `SELECT 1 FROM ${this.schema}.test_case_review_events WHERE design_id = $1 LIMIT 1`,
        [id],
      );
      if (reviews.rowCount) throw new Error("已有人工评审的草稿不可重新生成，请先建立新的需求基线");
      const updated = await client.query(
        `UPDATE ${this.schema}.test_designs
         SET model = $2, document_json = $3, trace_provider = $4,
             trace_project_name = $5, trace_id = $6, created_at = NOW()
         WHERE id = $1 RETURNING *`,
        [id, input.model, input.document, input.trace?.provider ?? "", input.trace?.projectName ?? "", input.trace?.traceId ?? ""],
      );
      await client.query("COMMIT");
      return this.parseDesign(updated.rows[0]);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async listDesigns(): Promise<TestDesignRecord[]> {
    const result = await this.pool.query(`SELECT * FROM ${this.schema}.test_designs ORDER BY created_at DESC`);
    return result.rows.map((row) => this.parseDesign(row));
  }

  async findByBaseline(baselineId: string): Promise<TestDesignRecord | null> {
    const result = await this.pool.query(`SELECT * FROM ${this.schema}.test_designs WHERE baseline_id = $1`, [baselineId]);
    return result.rowCount ? this.parseDesign(result.rows[0]) : null;
  }

  async getDesign(id: string): Promise<TestDesignRecord> {
    const result = await this.pool.query(`SELECT * FROM ${this.schema}.test_designs WHERE id = $1`, [id]);
    if (result.rowCount !== 1) throw new Error(`测试设计 ${id} 不存在`);
    return this.parseDesign(result.rows[0]);
  }

  async listReviews(designId: string): Promise<TestCaseReviewRecord[]> {
    await this.getDesign(designId);
    const result = await this.pool.query(
      `SELECT DISTINCT ON (test_case_id) * FROM ${this.schema}.test_case_review_events
       WHERE design_id = $1 ORDER BY test_case_id, sequence DESC`,
      [designId],
    );
    return result.rows.map((row) => this.parseReview(row));
  }

  async recordReview(designId: string, testCaseId: string, input: {
    status: TestCaseReviewStatus;
    reviewer: string;
    reason: string;
  }): Promise<TestCaseReviewRecord> {
    const design = await this.getDesign(designId);
    if (design.status === "approved") throw new Error("已批准的 TestCase 版本不可覆盖");
    if (!design.document.test_cases.some((item) => item.id === testCaseId)) throw new Error(`TestCase ${testCaseId} 不存在`);
    if (!input.reviewer.trim()) throw new Error("请填写评审人");
    const result = await this.pool.query(
      `INSERT INTO ${this.schema}.test_case_review_events
        (id, design_id, test_case_id, status, reviewer, reason)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [randomUUID(), designId, testCaseId, input.status, input.reviewer.trim(), input.reason.trim()],
    );
    return this.parseReview(result.rows[0]);
  }

  async approve(designId: string, approvedBy: string): Promise<ApprovedTestCaseVersionRecord> {
    if (!approvedBy.trim()) throw new Error("请填写批准人");
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const designResult = await client.query(`SELECT * FROM ${this.schema}.test_designs WHERE id = $1 FOR UPDATE`, [designId]);
      if (designResult.rowCount !== 1) throw new Error(`测试设计 ${designId} 不存在`);
      const design = this.parseDesign(designResult.rows[0]);
      const existing = await client.query(`SELECT * FROM ${this.schema}.approved_test_case_versions WHERE design_id = $1`, [designId]);
      if (existing.rowCount) {
        await client.query("COMMIT");
        return this.parseVersion(existing.rows[0]);
      }
      const reviewResult = await client.query(
        `SELECT DISTINCT ON (test_case_id) * FROM ${this.schema}.test_case_review_events
         WHERE design_id = $1 ORDER BY test_case_id, sequence DESC`,
        [designId],
      );
      const reviews = reviewResult.rows.map((row) => this.parseReview(row));
      const byCase = new Map(reviews.map((review) => [review.testCaseId, review]));
      const pending = design.document.test_cases.filter((testCase) => !byCase.has(testCase.id));
      if (pending.length) throw new Error(`仍有 ${pending.length} 条 TestCase 未评审：${pending.map((item) => item.id).join("、")}`);
      const acceptedCases = design.document.test_cases.filter((testCase) => byCase.get(testCase.id)?.status === "accepted");
      if (!acceptedCases.length) throw new Error("至少需要接受一条 TestCase 才能批准版本");
      const id = randomUUID();
      const inserted = await client.query(
        `INSERT INTO ${this.schema}.approved_test_case_versions
          (id, design_id, version, approved_by, snapshot_json)
         VALUES ($1, $2, 1, $3, $4) RETURNING *`,
        [id, designId, approvedBy.trim(), { ...design.document, test_cases: acceptedCases, reviews }],
      );
      await client.query(`UPDATE ${this.schema}.test_designs SET status = 'approved' WHERE id = $1`, [designId]);
      await client.query("COMMIT");
      return this.parseVersion(inserted.rows[0]);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async getApprovedVersion(designId: string): Promise<{ record: ApprovedTestCaseVersionRecord; snapshot: unknown } | null> {
    const result = await this.pool.query(`SELECT * FROM ${this.schema}.approved_test_case_versions WHERE design_id = $1`, [designId]);
    if (!result.rowCount) return null;
    return { record: this.parseVersion(result.rows[0]), snapshot: result.rows[0].snapshot_json };
  }

  private parseDesign(row: Record<string, unknown>): TestDesignRecord {
    return {
      id: String(row.id),
      baselineId: String(row.baseline_id),
      status: row.status as TestDesignRecord["status"],
      model: String(row.model),
      document: TestDesignSchema.parse(row.document_json),
      traceProvider: String(row.trace_provider ?? ""),
      traceProjectName: String(row.trace_project_name ?? ""),
      traceId: String(row.trace_id ?? ""),
      createdAt: new Date(String(row.created_at)).toISOString(),
    };
  }

  private parseReview(row: Record<string, unknown>): TestCaseReviewRecord {
    return {
      id: String(row.id),
      designId: String(row.design_id),
      testCaseId: String(row.test_case_id),
      status: row.status as TestCaseReviewStatus,
      reviewer: String(row.reviewer),
      reason: String(row.reason),
      createdAt: new Date(String(row.created_at)).toISOString(),
    };
  }

  private parseVersion(row: Record<string, unknown>): ApprovedTestCaseVersionRecord {
    return {
      id: String(row.id),
      designId: String(row.design_id),
      version: Number(row.version),
      approvedBy: String(row.approved_by),
      approvedAt: new Date(String(row.approved_at)).toISOString(),
    };
  }
}
