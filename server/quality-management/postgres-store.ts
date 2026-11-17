import { createHash, randomUUID } from "node:crypto";
import type pg from "pg";
import { QualityPlanInputSchema, type ImprovementActionInput, type ImprovementActionUpdate, type QualityPlanInput, type RiskAcceptanceInput } from "./schema.js";

export type QualityPlanStatus = "draft" | "approved" | "closed";

export interface QualityPlanRecord extends QualityPlanInput {
  id: string;
  version: number;
  status: QualityPlanStatus;
  approvedBy: string;
  approvalNote: string;
  approvedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ReleaseGateRecord {
  id: string;
  planId: string;
  projectId: string;
  policyVersion: string;
  opaVersion: string;
  status: "allow" | "review" | "deny";
  facts: unknown;
  result: unknown;
  riskAcceptance: { acceptedBy: string; reason: string; expiresAt: string | null; acceptedAt: string } | null;
  evaluatedAt: string;
}

export interface ImprovementActionRecord extends ImprovementActionInput {
  id: string;
  planId: string;
  projectId: string;
  status: "open" | "in_progress" | "verified" | "closed";
  verificationEvidence: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface QualityReportRecord {
  id: string;
  planId: string;
  projectId: string;
  contentSha256: string;
  snapshot: unknown;
  markdown: string;
  generatedAt: string;
}

export interface ApiYamlRunSummary {
  id: string;
  projectId: string;
  approvedVersionId: string;
  status: "passed" | "failed" | "error";
  passed: number;
  failed: number;
  approvedTestCaseIds: string[];
  engine: "fastapi_yaml";
}

export class QualityManagementPostgresStore {
  constructor(private readonly pool: pg.Pool, private readonly schema: string) {}

  async setup(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS ${this.schema}.quality_plans (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES ${this.schema}.projects(id) ON DELETE CASCADE,
        version INTEGER NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('draft', 'approved', 'closed')),
        document_json JSONB NOT NULL,
        approved_by TEXT NOT NULL DEFAULT '',
        approval_note TEXT NOT NULL DEFAULT '',
        approved_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(project_id, version)
      );
      CREATE TABLE IF NOT EXISTS ${this.schema}.release_gate_evaluations (
        id TEXT PRIMARY KEY,
        plan_id TEXT NOT NULL REFERENCES ${this.schema}.quality_plans(id) ON DELETE RESTRICT,
        project_id TEXT NOT NULL REFERENCES ${this.schema}.projects(id) ON DELETE CASCADE,
        policy_version TEXT NOT NULL,
        opa_version TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('allow', 'review', 'deny')),
        facts_json JSONB NOT NULL,
        result_json JSONB NOT NULL,
        risk_acceptance_json JSONB,
        evaluated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS ${this.schema}.quality_improvement_actions (
        id TEXT PRIMARY KEY,
        plan_id TEXT NOT NULL REFERENCES ${this.schema}.quality_plans(id) ON DELETE RESTRICT,
        project_id TEXT NOT NULL REFERENCES ${this.schema}.projects(id) ON DELETE CASCADE,
        source_type TEXT NOT NULL,
        source_id TEXT NOT NULL DEFAULT '',
        title TEXT NOT NULL,
        root_cause_category TEXT NOT NULL,
        action TEXT NOT NULL,
        owner TEXT NOT NULL,
        due_date DATE,
        status TEXT NOT NULL CHECK (status IN ('open', 'in_progress', 'verified', 'closed')),
        verification_evidence TEXT NOT NULL DEFAULT '',
        updated_by TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS ${this.schema}.quality_reports (
        id TEXT PRIMARY KEY,
        plan_id TEXT NOT NULL REFERENCES ${this.schema}.quality_plans(id) ON DELETE RESTRICT,
        project_id TEXT NOT NULL REFERENCES ${this.schema}.projects(id) ON DELETE CASCADE,
        content_sha256 TEXT NOT NULL,
        snapshot_json JSONB NOT NULL,
        markdown TEXT NOT NULL,
        generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS quality_plans_project_idx ON ${this.schema}.quality_plans(project_id, version DESC);
      CREATE INDEX IF NOT EXISTS release_gate_project_idx ON ${this.schema}.release_gate_evaluations(project_id, evaluated_at DESC);
      CREATE INDEX IF NOT EXISTS improvement_project_idx ON ${this.schema}.quality_improvement_actions(project_id, status, created_at DESC);
      CREATE INDEX IF NOT EXISTS quality_reports_plan_idx ON ${this.schema}.quality_reports(plan_id, generated_at DESC);
    `);
  }

  async listPlans(projectId?: string): Promise<QualityPlanRecord[]> {
    const result = await this.pool.query(
      `SELECT * FROM ${this.schema}.quality_plans WHERE ($1::text IS NULL OR project_id = $1) ORDER BY project_id, version DESC`,
      [projectId ?? null],
    );
    return result.rows.map((row) => this.plan(row));
  }

  async getPlan(id: string): Promise<QualityPlanRecord> {
    const result = await this.pool.query(`SELECT * FROM ${this.schema}.quality_plans WHERE id = $1`, [id]);
    if (result.rowCount !== 1) throw new Error(`质量计划 ${id} 不存在`);
    return this.plan(result.rows[0]);
  }

  async createPlan(input: QualityPlanInput): Promise<QualityPlanRecord> {
    const parsed = QualityPlanInputSchema.parse(input);
    const versionResult = await this.pool.query(
      `SELECT COALESCE(MAX(version), 0) + 1 AS version FROM ${this.schema}.quality_plans WHERE project_id = $1`,
      [parsed.projectId],
    );
    const id = randomUUID();
    await this.pool.query(
      `INSERT INTO ${this.schema}.quality_plans (id, project_id, version, status, document_json)
       VALUES ($1, $2, $3, 'draft', $4::jsonb)`,
      [id, parsed.projectId, Number(versionResult.rows[0].version), JSON.stringify(parsed)],
    );
    return this.getPlan(id);
  }

  async updatePlan(id: string, input: QualityPlanInput): Promise<QualityPlanRecord> {
    const current = await this.getPlan(id);
    if (current.status !== "draft") throw new Error("已批准或已关闭的质量计划不可覆盖，请创建新版本");
    if (current.projectId !== input.projectId) throw new Error("质量计划不能迁移到其他项目");
    const parsed = QualityPlanInputSchema.parse(input);
    await this.pool.query(
      `UPDATE ${this.schema}.quality_plans SET document_json = $2::jsonb, updated_at = NOW() WHERE id = $1`,
      [id, JSON.stringify(parsed)],
    );
    return this.getPlan(id);
  }

  async approvePlan(id: string, approvedBy: string, note: string): Promise<QualityPlanRecord> {
    const result = await this.pool.query(
      `UPDATE ${this.schema}.quality_plans
       SET status = 'approved', approved_by = $2, approval_note = $3, approved_at = NOW(), updated_at = NOW()
       WHERE id = $1 AND status = 'draft' RETURNING *`,
      [id, approvedBy.trim(), note.trim()],
    );
    if (result.rowCount !== 1) throw new Error("质量计划不存在或已冻结，不能重复批准");
    return this.plan(result.rows[0]);
  }

  async saveGate(input: Omit<ReleaseGateRecord, "id" | "evaluatedAt" | "riskAcceptance">): Promise<ReleaseGateRecord> {
    const id = randomUUID();
    const result = await this.pool.query(
      `INSERT INTO ${this.schema}.release_gate_evaluations
       (id, plan_id, project_id, policy_version, opa_version, status, facts_json, result_json)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb) RETURNING *`,
      [id, input.planId, input.projectId, input.policyVersion, input.opaVersion, input.status,
        JSON.stringify(input.facts), JSON.stringify(input.result)],
    );
    return this.gate(result.rows[0]);
  }

  async listGates(projectId: string): Promise<ReleaseGateRecord[]> {
    const result = await this.pool.query(
      `SELECT * FROM ${this.schema}.release_gate_evaluations WHERE project_id = $1 ORDER BY evaluated_at DESC`, [projectId],
    );
    return result.rows.map((row) => this.gate(row));
  }

  async acceptGateRisk(id: string, input: RiskAcceptanceInput): Promise<ReleaseGateRecord> {
    const current = await this.pool.query(`SELECT * FROM ${this.schema}.release_gate_evaluations WHERE id = $1`, [id]);
    if (current.rowCount !== 1) throw new Error(`准入评估 ${id} 不存在`);
    if (current.rows[0].status !== "review") throw new Error("只有 review 结果可以进行人工风险接受，deny 必须修复后重新评估");
    if (current.rows[0].risk_acceptance_json) throw new Error("该准入评估已经完成风险接受");
    const acceptance = { ...input, acceptedAt: new Date().toISOString() };
    const result = await this.pool.query(
      `UPDATE ${this.schema}.release_gate_evaluations SET risk_acceptance_json = $2::jsonb WHERE id = $1 RETURNING *`,
      [id, JSON.stringify(acceptance)],
    );
    return this.gate(result.rows[0]);
  }

  async createImprovement(plan: QualityPlanRecord, input: ImprovementActionInput): Promise<ImprovementActionRecord> {
    const id = randomUUID();
    const result = await this.pool.query(
      `INSERT INTO ${this.schema}.quality_improvement_actions
       (id, plan_id, project_id, source_type, source_id, title, root_cause_category, action, owner, due_date, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'open') RETURNING *`,
      [id, plan.id, plan.projectId, input.sourceType, input.sourceId, input.title, input.rootCauseCategory,
        input.action, input.owner, input.dueDate || null],
    );
    return this.improvement(result.rows[0]);
  }

  async listImprovements(projectId: string): Promise<ImprovementActionRecord[]> {
    const result = await this.pool.query(
      `SELECT * FROM ${this.schema}.quality_improvement_actions WHERE project_id = $1 ORDER BY created_at DESC`, [projectId],
    );
    return result.rows.map((row) => this.improvement(row));
  }

  async updateImprovement(id: string, input: ImprovementActionUpdate): Promise<ImprovementActionRecord> {
    const result = await this.pool.query(
      `UPDATE ${this.schema}.quality_improvement_actions
       SET status = $2, verification_evidence = $3, updated_by = $4, updated_at = NOW()
       WHERE id = $1 RETURNING *`,
      [id, input.status, input.verificationEvidence, input.updatedBy],
    );
    if (result.rowCount !== 1) throw new Error(`改进项 ${id} 不存在`);
    return this.improvement(result.rows[0]);
  }

  async saveReport(plan: QualityPlanRecord, snapshot: unknown, markdown: string): Promise<QualityReportRecord> {
    const id = randomUUID();
    const contentSha256 = createHash("sha256").update(markdown, "utf8").digest("hex");
    const result = await this.pool.query(
      `INSERT INTO ${this.schema}.quality_reports
       (id, plan_id, project_id, content_sha256, snapshot_json, markdown)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6) RETURNING *`,
      [id, plan.id, plan.projectId, contentSha256, JSON.stringify(snapshot), markdown],
    );
    return this.report(result.rows[0]);
  }

  async listReports(planId: string): Promise<QualityReportRecord[]> {
    const result = await this.pool.query(
      `SELECT * FROM ${this.schema}.quality_reports WHERE plan_id = $1 ORDER BY generated_at DESC`, [planId],
    );
    return result.rows.map((row) => this.report(row));
  }

  async getReport(id: string): Promise<QualityReportRecord> {
    const result = await this.pool.query(`SELECT * FROM ${this.schema}.quality_reports WHERE id = $1`, [id]);
    if (result.rowCount !== 1) throw new Error(`质量报告 ${id} 不存在`);
    return this.report(result.rows[0]);
  }

  async listApiYamlRuns(projectId: string, approvedVersionId = ""): Promise<ApiYamlRunSummary[]> {
    try {
      const result = await this.pool.query(
        `SELECT id, project_id, approved_version_id, approved_test_case_ids, status, passed, failed
         FROM ${this.schema}.api_yaml_runs
         WHERE project_id = $1 AND ($2 = '' OR approved_version_id = $2)
         ORDER BY started_at DESC`, [projectId, approvedVersionId],
      );
      return result.rows.map((row) => ({ id: String(row.id), projectId: String(row.project_id),
        approvedVersionId: String(row.approved_version_id), status: row.status as ApiYamlRunSummary["status"],
        passed: Number(row.passed), failed: Number(row.failed),
        approvedTestCaseIds: Array.isArray(row.approved_test_case_ids) ? row.approved_test_case_ids.map(String) : [],
        engine: "fastapi_yaml" }));
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "42P01") return [];
      throw error;
    }
  }

  private plan(row: Record<string, unknown>): QualityPlanRecord {
    const document = QualityPlanInputSchema.parse(row.document_json);
    return { ...document, id: String(row.id), version: Number(row.version), status: row.status as QualityPlanStatus,
      approvedBy: String(row.approved_by), approvalNote: String(row.approval_note),
      approvedAt: row.approved_at ? this.iso(row.approved_at) : null,
      createdAt: this.iso(row.created_at), updatedAt: this.iso(row.updated_at) };
  }

  private gate(row: Record<string, unknown>): ReleaseGateRecord {
    return { id: String(row.id), planId: String(row.plan_id), projectId: String(row.project_id),
      policyVersion: String(row.policy_version), opaVersion: String(row.opa_version), status: row.status as ReleaseGateRecord["status"],
      facts: row.facts_json, result: row.result_json,
      riskAcceptance: row.risk_acceptance_json as ReleaseGateRecord["riskAcceptance"], evaluatedAt: this.iso(row.evaluated_at) };
  }

  private improvement(row: Record<string, unknown>): ImprovementActionRecord {
    return { id: String(row.id), planId: String(row.plan_id), projectId: String(row.project_id),
      sourceType: row.source_type as ImprovementActionRecord["sourceType"], sourceId: String(row.source_id), title: String(row.title),
      rootCauseCategory: row.root_cause_category as ImprovementActionRecord["rootCauseCategory"], action: String(row.action),
      owner: String(row.owner), dueDate: row.due_date ? String(row.due_date).slice(0, 10) : "", status: row.status as ImprovementActionRecord["status"],
      verificationEvidence: String(row.verification_evidence), updatedBy: String(row.updated_by),
      createdAt: this.iso(row.created_at), updatedAt: this.iso(row.updated_at) };
  }

  private report(row: Record<string, unknown>): QualityReportRecord {
    return { id: String(row.id), planId: String(row.plan_id), projectId: String(row.project_id),
      contentSha256: String(row.content_sha256), snapshot: row.snapshot_json, markdown: String(row.markdown),
      generatedAt: this.iso(row.generated_at) };
  }

  private iso(value: unknown): string { return value instanceof Date ? value.toISOString() : String(value); }
}
