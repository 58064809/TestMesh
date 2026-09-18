import { createHash, randomUUID } from "node:crypto";
import type pg from "pg";
import { RequirementAnalysisSchema, type RequirementAnalysis } from "./schema.js";
import type { SourceFile } from "./sources.js";

export type AnalysisReviewStatus = "accepted" | "rejected" | "merged" | "clarify";
export type AnalysisIssueType = "missing" | "ambiguity" | "conflict";

export interface AnalysisReviewInput {
  status: AnalysisReviewStatus;
  reviewer: string;
  reason: string;
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

export interface RequirementAnalysisRecord {
  id: string;
  taskId: string;
  artifactId: string;
  summary: string;
  model: string;
  status: "candidate" | "reviewing" | "baselined";
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

type Queryable = Pick<pg.Pool, "query"> | Pick<pg.PoolClient, "query">;

export class RequirementAnalysisPostgresStore {
  private readonly schema: string;

  constructor(private readonly pool: pg.Pool, schema = "testmesh_business") {
    if (!/^[a-z][a-z0-9_]*$/.test(schema)) {
      throw new Error(`PostgreSQL Schema 名称不合法：${schema}`);
    }
    this.schema = schema;
  }

  async setup(): Promise<void> {
    await this.pool.query(`CREATE SCHEMA IF NOT EXISTS ${this.schema}`);
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS ${this.schema}.requirement_analyses (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL UNIQUE,
        artifact_id TEXT NOT NULL UNIQUE,
        summary TEXT NOT NULL,
        model TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('candidate', 'reviewing', 'baselined')),
        document_json JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS ${this.schema}.analysis_source_files (
        analysis_id TEXT NOT NULL REFERENCES ${this.schema}.requirement_analyses(id) ON DELETE CASCADE,
        source_file_id TEXT NOT NULL,
        filename TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        sha256 TEXT NOT NULL,
        provenance TEXT NOT NULL,
        file_bytes BYTEA NOT NULL,
        stored_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (analysis_id, source_file_id)
      )
    `);
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS ${this.schema}.analysis_review_events (
        sequence BIGSERIAL PRIMARY KEY,
        id TEXT NOT NULL UNIQUE,
        analysis_id TEXT NOT NULL REFERENCES ${this.schema}.requirement_analyses(id) ON DELETE CASCADE,
        item_id TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('accepted', 'rejected', 'merged', 'clarify')),
        reviewer TEXT NOT NULL,
        reason TEXT NOT NULL,
        issue_type TEXT NOT NULL,
        merge_into TEXT NOT NULL,
        decision TEXT NOT NULL,
        decision_by TEXT NOT NULL,
        prd_revision TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await this.pool.query(`
      CREATE INDEX IF NOT EXISTS analysis_review_events_latest
      ON ${this.schema}.analysis_review_events (analysis_id, item_id, sequence DESC)
    `);
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS ${this.schema}.requirement_baselines (
        id TEXT PRIMARY KEY,
        analysis_id TEXT NOT NULL UNIQUE REFERENCES ${this.schema}.requirement_analyses(id) ON DELETE RESTRICT,
        previous_baseline_id TEXT UNIQUE REFERENCES ${this.schema}.requirement_baselines(id) ON DELETE RESTRICT,
        version INTEGER NOT NULL CHECK (version > 0),
        prd_revision TEXT NOT NULL,
        prd_filename TEXT NOT NULL,
        prd_sha256 TEXT NOT NULL,
        prd_file BYTEA NOT NULL,
        approved_by TEXT NOT NULL,
        approved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        snapshot_json JSONB NOT NULL
      )
    `);
  }

  async saveAnalysis(input: {
    id?: string;
    taskId: string;
    artifactId: string;
    document: RequirementAnalysis;
    model: string;
    sources: SourceFile[];
  }): Promise<RequirementAnalysisRecord> {
    const document = RequirementAnalysisSchema.parse(input.document);
    const sourceIds = new Set(input.sources.map((source) => source.id));
    if (sourceIds.size !== input.sources.length) throw new Error("来源文件 ID 不能重复");
    for (const source of document.sources) {
      if (!sourceIds.has(source.source_file_id)) {
        throw new Error(`分析引用了未保存的来源文件 ${source.source_file_id}`);
      }
    }
    const id = input.id ?? randomUUID();
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const inserted = await client.query(
        `INSERT INTO ${this.schema}.requirement_analyses
          (id, task_id, artifact_id, summary, model, status, document_json)
         VALUES ($1, $2, $3, $4, $5, 'candidate', $6)
         RETURNING *`,
        [id, input.taskId, input.artifactId, document.summary?.description ?? "", input.model, document],
      );
      for (const source of input.sources) {
        await client.query(
          `INSERT INTO ${this.schema}.analysis_source_files
            (analysis_id, source_file_id, filename, mime_type, sha256, provenance, file_bytes)
           VALUES ($1, $2, $3, $4, $5, 'at_analysis', $6)`,
          [
            id,
            source.id,
            source.name,
            source.mimeType,
            createHash("sha256").update(source.buffer).digest("hex"),
            source.buffer,
          ],
        );
      }
      await client.query("COMMIT");
      return this.parseAnalysisRow(inserted.rows[0]);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async getAnalysis(id: string): Promise<{
    record: RequirementAnalysisRecord;
    document: RequirementAnalysis;
  }> {
    const result = await this.pool.query(
      `SELECT * FROM ${this.schema}.requirement_analyses WHERE id = $1`,
      [id],
    );
    if (result.rowCount !== 1) throw new Error(`分析结果 ${id} 不存在`);
    return {
      record: this.parseAnalysisRow(result.rows[0]),
      document: RequirementAnalysisSchema.parse(result.rows[0].document_json),
    };
  }

  async listAnalyses(): Promise<RequirementAnalysisRecord[]> {
    const result = await this.pool.query(
      `SELECT * FROM ${this.schema}.requirement_analyses ORDER BY created_at DESC`,
    );
    return result.rows.map((row) => this.parseAnalysisRow(row));
  }

  async listSourceFiles(analysisId: string): Promise<Array<{
    sourceFileId: string;
    filename: string;
    mimeType: string;
    sha256: string;
    provenance: string;
    storedAt: string;
  }>> {
    await this.getAnalysis(analysisId);
    const result = await this.pool.query(
      `SELECT source_file_id, filename, mime_type, sha256, provenance, stored_at
       FROM ${this.schema}.analysis_source_files
       WHERE analysis_id = $1 ORDER BY stored_at, source_file_id`,
      [analysisId],
    );
    return result.rows.map((row) => ({
      sourceFileId: String(row.source_file_id),
      filename: String(row.filename),
      mimeType: String(row.mime_type),
      sha256: String(row.sha256),
      provenance: String(row.provenance),
      storedAt: this.iso(row.stored_at),
    }));
  }

  async getSourceFile(analysisId: string, sourceFileId: string): Promise<{
    filename: string;
    mimeType: string;
    file: Buffer;
    sha256: string;
    provenance: string;
  }> {
    const result = await this.pool.query(
      `SELECT filename, mime_type, file_bytes, sha256, provenance
       FROM ${this.schema}.analysis_source_files
       WHERE analysis_id = $1 AND source_file_id = $2`,
      [analysisId, sourceFileId],
    );
    if (result.rowCount !== 1) throw new Error("原始来源文件不存在");
    const row = result.rows[0];
    return {
      filename: String(row.filename),
      mimeType: String(row.mime_type),
      file: Buffer.from(row.file_bytes),
      sha256: String(row.sha256),
      provenance: String(row.provenance),
    };
  }

  async listReviews(analysisId: string): Promise<AnalysisReviewRecord[]> {
    await this.getAnalysis(analysisId);
    const result = await this.pool.query(
      `SELECT DISTINCT ON (item_id) *
       FROM ${this.schema}.analysis_review_events
       WHERE analysis_id = $1
       ORDER BY item_id, sequence DESC`,
      [analysisId],
    );
    return result.rows.map((row) => this.parseReviewRow(row));
  }

  async listReviewHistory(analysisId: string, itemId: string): Promise<AnalysisReviewRecord[]> {
    const { document } = await this.getAnalysis(analysisId);
    if (!this.reviewSections(document).some(({ item }) => item.id === itemId)) {
      throw new Error("分析条目不存在，不能读取评审历史");
    }
    const result = await this.pool.query(
      `SELECT * FROM ${this.schema}.analysis_review_events
       WHERE analysis_id = $1 AND item_id = $2 ORDER BY sequence DESC`,
      [analysisId, itemId],
    );
    return result.rows.map((row) => this.parseReviewRow(row));
  }

  async recordReview(
    analysisId: string,
    itemId: string,
    input: AnalysisReviewInput,
  ): Promise<AnalysisReviewRecord> {
    const { record, document } = await this.getAnalysis(analysisId);
    if (record.status === "baselined") {
      throw new Error("此分析已建立基线，评审记录已冻结；变更请基于新 PRD 创建新的需求分析");
    }
    const items = this.reviewSections(document);
    const current = items.find(({ item }) => item.id === itemId);
    if (!current) throw new Error(`分析条目 ${itemId} 不存在`);
    const normalized: AnalysisReviewInput = input.status === "accepted"
      ? { ...input }
      : { ...input, decision: "", decisionBy: "", prdRevision: "" };
    if (normalized.status === "merged") {
      const target = items.find(({ item }) => item.id === normalized.mergeInto);
      if (!target || target.item.id === itemId || target.section !== current.section) {
        throw new Error("合并目标需为同类的其他分析条目");
      }
    } else if (normalized.mergeInto) {
      throw new Error("只有合并条目才能填写目标");
    }
    if (current.section === "open_questions") {
      if (normalized.status === "accepted" && !normalized.issueType) {
        throw new Error("请明确待确认问题是缺失、歧义还是冲突");
      }
      if (normalized.decision && (!normalized.decisionBy.trim() || !normalized.prdRevision.trim())) {
        throw new Error("评审决策需要决策人和 PRD 修订标识");
      }
    } else if (normalized.issueType || normalized.decision || normalized.decisionBy || normalized.prdRevision) {
      throw new Error("问题类型与会议决策只填写在待确认问题上");
    }
    const values = {
      ...normalized,
      reviewer: normalized.reviewer.trim(),
      reason: normalized.reason.trim(),
      decision: normalized.decision.trim(),
      decisionBy: normalized.decisionBy.trim(),
      prdRevision: normalized.prdRevision.trim(),
    };
    const result = await this.pool.query(
      `INSERT INTO ${this.schema}.analysis_review_events
        (id, analysis_id, item_id, status, reviewer, reason, issue_type,
         merge_into, decision, decision_by, prd_revision)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING *`,
      [
        randomUUID(), analysisId, itemId, values.status, values.reviewer, values.reason,
        values.issueType, values.mergeInto, values.decision, values.decisionBy, values.prdRevision,
      ],
    );
    await this.pool.query(
      `UPDATE ${this.schema}.requirement_analyses SET status = 'reviewing'
       WHERE id = $1 AND status = 'candidate'`,
      [analysisId],
    );
    return this.parseReviewRow(result.rows[0]);
  }

  async listBaselines(): Promise<RequirementBaselineRecord[]> {
    const result = await this.pool.query(
      `SELECT * FROM ${this.schema}.requirement_baselines ORDER BY approved_at DESC`,
    );
    return result.rows.map((row) => this.parseBaselineRow(row));
  }

  async createBaseline(analysisId: string, input: {
    prdRevision: string;
    approvedBy: string;
    previousBaselineId: string | null;
    prdFilename: string;
    prdFile: Buffer;
  }): Promise<RequirementBaselineRecord> {
    if (!input.prdRevision.trim() || !input.approvedBy.trim() || !input.prdFile.length) {
      throw new Error("建立基线需要 PRD 修订标识、批准人和评审后的 PRD 文件");
    }
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const analysisResult = await client.query(
        `SELECT * FROM ${this.schema}.requirement_analyses WHERE id = $1 FOR UPDATE`,
        [analysisId],
      );
      if (analysisResult.rowCount !== 1) throw new Error(`分析结果 ${analysisId} 不存在`);
      if (analysisResult.rows[0].status === "baselined") {
        throw new Error("此分析已建立基线；需求变化请重新分析新 PRD，不能覆盖旧基线");
      }
      const document = RequirementAnalysisSchema.parse(analysisResult.rows[0].document_json);
      let previousVersion = 0;
      if (input.previousBaselineId) {
        const previous = await client.query(
          `SELECT version FROM ${this.schema}.requirement_baselines WHERE id = $1`,
          [input.previousBaselineId],
        );
        if (previous.rowCount !== 1) throw new Error("前一需求基线不存在");
        previousVersion = Number(previous.rows[0].version);
      }
      const reviews = await this.latestReviews(client, analysisId);
      const items = this.reviewSections(document);
      const byId = new Map(reviews.map((review) => [review.itemId, review]));
      const unfinished = items.filter(({ item }) => !byId.has(item.id) || byId.get(item.id)?.status === "clarify");
      if (unfinished.length) {
        throw new Error(`仍有 ${unfinished.length} 条未完成评审，不能建立基线：${unfinished.map(({ item }) => item.id).join("、")}`);
      }
      const unresolved = items.filter(({ section, item }) => {
        const review = byId.get(item.id)!;
        return section === "open_questions" && review.status === "accepted"
          && (!review.decision || !review.decisionBy || !review.prdRevision);
      });
      if (unresolved.length) {
        throw new Error(`以下待确认问题尚未回写完整评审决策：${unresolved.map(({ item }) => item.id).join("、")}`);
      }
      for (const { section, item } of items) {
        const review = byId.get(item.id)!;
        if (section === "open_questions" && review.status === "accepted"
          && review.prdRevision !== input.prdRevision.trim()) {
          throw new Error(`待确认问题 ${item.id} 的决策登记在 PRD ${review.prdRevision}，与上传的获批版本 ${input.prdRevision.trim()} 不一致`);
        }
        if (review.status === "merged" && byId.get(review.mergeInto)?.status !== "accepted") {
          throw new Error(`合并目标 ${review.mergeInto} 尚未接受`);
        }
      }
      const accepted = items
        .filter(({ item }) => byId.get(item.id)?.status === "accepted")
        .map(({ section, item }) => {
          const merged = items.filter(({ section: otherSection, item: otherItem }) =>
            otherSection === section
            && byId.get(otherItem.id)?.status === "merged"
            && byId.get(otherItem.id)?.mergeInto === item.id);
          return {
            section,
            item: {
              ...item,
              source_refs: [...new Set([
                ...item.source_refs,
                ...merged.flatMap(({ item: mergedItem }) => mergedItem.source_refs),
              ])],
            },
            mergedFrom: merged.map(({ item: mergedItem }) => mergedItem.id),
            review: byId.get(item.id),
          };
        });
      const record = {
        id: randomUUID(),
        analysisId,
        previousBaselineId: input.previousBaselineId,
        version: previousVersion + 1,
        prdRevision: input.prdRevision.trim(),
        prdFilename: input.prdFilename,
        prdSha256: createHash("sha256").update(input.prdFile).digest("hex"),
        approvedBy: input.approvedBy.trim(),
      };
      const inserted = await client.query(
        `INSERT INTO ${this.schema}.requirement_baselines
          (id, analysis_id, previous_baseline_id, version, prd_revision, prd_filename,
           prd_sha256, prd_file, approved_by, snapshot_json)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING *`,
        [
          record.id, analysisId, record.previousBaselineId, record.version,
          record.prdRevision, record.prdFilename, record.prdSha256, input.prdFile,
          record.approvedBy, { accepted, reviews, sourceRefs: document.sources },
        ],
      );
      await client.query(
        `UPDATE ${this.schema}.requirement_analyses SET status = 'baselined' WHERE id = $1`,
        [analysisId],
      );
      await client.query("COMMIT");
      return this.parseBaselineRow(inserted.rows[0]);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async getBaseline(id: string): Promise<{
    record: RequirementBaselineRecord;
    snapshot: unknown;
    file: Buffer;
  }> {
    const result = await this.pool.query(
      `SELECT * FROM ${this.schema}.requirement_baselines WHERE id = $1`,
      [id],
    );
    if (result.rowCount !== 1) throw new Error(`需求基线 ${id} 不存在`);
    const row = result.rows[0];
    return {
      record: this.parseBaselineRow(row),
      snapshot: row.snapshot_json,
      file: Buffer.from(row.prd_file),
    };
  }

  private async latestReviews(client: Queryable, analysisId: string): Promise<AnalysisReviewRecord[]> {
    const result = await client.query(
      `SELECT DISTINCT ON (item_id) *
       FROM ${this.schema}.analysis_review_events
       WHERE analysis_id = $1
       ORDER BY item_id, sequence DESC`,
      [analysisId],
    );
    return result.rows.map((row) => this.parseReviewRow(row));
  }

  private reviewSections(document: RequirementAnalysis): Array<{
    section: string;
    item: RequirementAnalysis["actors"][number];
  }> {
    const sections = [
      "requirements", "actors", "business_rules", "flows", "states",
      "constraints", "exceptions", "open_questions",
    ] as const;
    return [
      ...(document.summary ? [{ section: "summary", item: document.summary }] : []),
      ...sections.flatMap((section) => document[section].map((item) => ({ section, item }))),
    ];
  }

  private parseAnalysisRow(row: Record<string, unknown>): RequirementAnalysisRecord {
    return {
      id: String(row.id),
      taskId: String(row.task_id),
      artifactId: String(row.artifact_id),
      summary: String(row.summary),
      model: String(row.model),
      status: row.status as RequirementAnalysisRecord["status"],
      createdAt: this.iso(row.created_at),
    };
  }

  private parseReviewRow(row: Record<string, unknown>): AnalysisReviewRecord {
    return {
      id: String(row.id),
      analysisId: String(row.analysis_id),
      itemId: String(row.item_id),
      status: row.status as AnalysisReviewStatus,
      reviewer: String(row.reviewer),
      reason: String(row.reason),
      issueType: row.issue_type as AnalysisIssueType | "",
      mergeInto: String(row.merge_into),
      decision: String(row.decision),
      decisionBy: String(row.decision_by),
      prdRevision: String(row.prd_revision),
      createdAt: this.iso(row.created_at),
    };
  }

  private parseBaselineRow(row: Record<string, unknown>): RequirementBaselineRecord {
    return {
      id: String(row.id),
      analysisId: String(row.analysis_id),
      previousBaselineId: row.previous_baseline_id ? String(row.previous_baseline_id) : null,
      version: Number(row.version),
      prdRevision: String(row.prd_revision),
      prdFilename: String(row.prd_filename),
      prdSha256: String(row.prd_sha256),
      approvedBy: String(row.approved_by),
      approvedAt: this.iso(row.approved_at),
    };
  }

  private iso(value: unknown): string {
    return value instanceof Date ? value.toISOString() : String(value);
  }
}
