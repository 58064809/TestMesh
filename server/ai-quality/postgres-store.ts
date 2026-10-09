import type pg from "pg";
import type { AiQualityCriteria, AiQualityProfile, PhoenixEvidence } from "./profile.js";

export interface AiQualityProfileSeed {
  id: string;
  name: string;
  version: string;
  targetName: string;
  targetVersion: string;
  environment: string;
  sourceAnalysisId: string;
  sourceFilename: string;
  sourceSha256: string;
  criteria: AiQualityCriteria;
  phoenix: PhoenixEvidence;
}

export class AiQualityPostgresStore {
  constructor(private readonly pool: pg.Pool, private readonly schema = "testmesh_business") {
    if (!/^[a-z][a-z0-9_]*$/.test(schema)) throw new Error(`PostgreSQL Schema 名称不合法：${schema}`);
  }

  async setup(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS ${this.schema}.ai_quality_profiles (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        version TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'retired')),
        target_name TEXT NOT NULL,
        target_version TEXT NOT NULL,
        environment TEXT NOT NULL,
        source_analysis_id TEXT NOT NULL,
        source_filename TEXT NOT NULL,
        source_sha256 TEXT NOT NULL,
        criteria_json JSONB NOT NULL,
        phoenix_json JSONB NOT NULL,
        approved_by TEXT NOT NULL DEFAULT '',
        approval_note TEXT NOT NULL DEFAULT '',
        approved_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (name, version)
      )
    `);
  }

  async seed(seed: AiQualityProfileSeed): Promise<void> {
    await this.pool.query(
      `INSERT INTO ${this.schema}.ai_quality_profiles
        (id, name, version, status, target_name, target_version, environment,
         source_analysis_id, source_filename, source_sha256, criteria_json, phoenix_json)
       VALUES ($1, $2, $3, 'pending', $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT (id) DO NOTHING`,
      [seed.id, seed.name, seed.version, seed.targetName, seed.targetVersion, seed.environment,
        seed.sourceAnalysisId, seed.sourceFilename, seed.sourceSha256, seed.criteria, seed.phoenix],
    );
  }

  async list(): Promise<AiQualityProfile[]> {
    const result = await this.pool.query(`SELECT * FROM ${this.schema}.ai_quality_profiles ORDER BY created_at DESC`);
    return result.rows.map((row) => this.parse(row));
  }

  async get(id: string): Promise<AiQualityProfile> {
    const result = await this.pool.query(`SELECT * FROM ${this.schema}.ai_quality_profiles WHERE id = $1`, [id]);
    if (result.rowCount !== 1) throw new Error(`AI 质量评测配置 ${id} 不存在`);
    return this.parse(result.rows[0]);
  }

  async approve(id: string, approvedBy: string, approvalNote: string): Promise<AiQualityProfile> {
    const reviewer = approvedBy.trim();
    if (!reviewer) throw new Error("请填写批准人");
    const result = await this.pool.query(
      `UPDATE ${this.schema}.ai_quality_profiles
       SET status = 'approved', approved_by = $2, approval_note = $3, approved_at = NOW()
       WHERE id = $1 AND status = 'pending' RETURNING *`,
      [id, reviewer, approvalNote.trim()],
    );
    if (result.rowCount !== 1) throw new Error("该评测配置不存在或已完成审批，不能重复批准");
    return this.parse(result.rows[0]);
  }

  private parse(row: Record<string, unknown>): AiQualityProfile {
    return {
      id: String(row.id), name: String(row.name), version: String(row.version),
      status: row.status as AiQualityProfile["status"], targetName: String(row.target_name),
      targetVersion: String(row.target_version), environment: String(row.environment),
      sourceAnalysisId: String(row.source_analysis_id), sourceFilename: String(row.source_filename),
      sourceSha256: String(row.source_sha256), criteria: row.criteria_json as AiQualityCriteria,
      phoenix: row.phoenix_json as PhoenixEvidence, approvedBy: String(row.approved_by),
      approvalNote: String(row.approval_note), approvedAt: row.approved_at ? this.iso(row.approved_at) : null,
      createdAt: this.iso(row.created_at),
    };
  }

  private iso(value: unknown): string {
    return value instanceof Date ? value.toISOString() : String(value);
  }
}
