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

export interface AiDatasetExportRecord {
  id: string;
  approvedTestCaseVersionId: string;
  datasetName: string;
  datasetId: string;
  datasetVersionId: string;
  contentSha256: string;
  exampleCount: number;
  aiDimensions: string[];
  dataClass: "test-plan-manifest" | "evaluation-dataset";
  exportedBy: string;
  createdAt: string;
}

export interface ApprovedApiScenarioRecord {
  id: string;
  approvedTestCaseVersionId: string;
  approvedTestCaseIds: string[];
  name: string;
  yamlContent: string;
  contentSha256: string;
  approvedBy: string;
  approvedAt: string;
}

export interface AiExperimentRunRecord {
  id: string;
  datasetExportId: string;
  approvedTestCaseVersionId: string;
  datasetId: string;
  datasetVersionId: string;
  experimentId: string;
  projectName: string;
  dataClass: "production-candidate";
  status: "execution-only";
  totalRuns: number;
  successfulRuns: number;
  failedRuns: number;
  evaluatorNames: string[];
  targetVersions: string[];
  gateEligible: false;
  requestedBy: string;
  createdAt: string;
}

export type AiEvaluationSampleStatus = "draft" | "approved" | "rejected";
export type AiEvaluationSampleSetStatus = "draft" | "frozen";

export interface AiEvaluationSampleRecord {
  id: string;
  sampleSetId: string;
  approvedTestCaseId: string;
  aiDimension: string;
  input: Record<string, unknown>;
  expected: Record<string, unknown>;
  metadata: Record<string, unknown>;
  status: AiEvaluationSampleStatus;
  reviewNote: string;
  reviewedBy: string;
  reviewedAt: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface AiEvaluationSampleSetRecord {
  id: string;
  approvedTestCaseVersionId: string;
  name: string;
  status: AiEvaluationSampleSetStatus;
  version: number;
  contentSha256: string;
  frozenBy: string;
  frozenAt: string | null;
  createdBy: string;
  createdAt: string;
  samples: AiEvaluationSampleRecord[];
}

export interface EvaluatorCalibrationRecord {
  id: string;
  evaluatorName: string;
  evaluatorVersion: string;
  evaluatorKind: "code" | "llm_judge";
  targetDimensions: string[];
  evaluationSubjects: Array<"testmesh" | "target_application">;
  evaluationLayers: Array<"agent_decision" | "tool_execution" | "business_outcome" | "final_response">;
  phoenixDatasetId: string;
  phoenixDatasetVersionId: string;
  phoenixExperimentId: string;
  contentSha256: string;
  sampleCount: number;
  metrics: Record<string, unknown>;
  thresholds: Record<string, number>;
  passed: boolean;
  calibratedBy: string;
  calibrationNote: string;
  createdAt: string;
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
      );
      CREATE TABLE IF NOT EXISTS ${this.schema}.ai_dataset_exports (
        id TEXT PRIMARY KEY,
        approved_test_case_version_id TEXT NOT NULL
          REFERENCES ${this.schema}.approved_test_case_versions(id) ON DELETE RESTRICT,
        dataset_name TEXT NOT NULL,
        dataset_id TEXT NOT NULL,
        dataset_version_id TEXT NOT NULL,
        content_sha256 TEXT NOT NULL,
        example_count INTEGER NOT NULL CHECK (example_count > 0),
        ai_dimensions_json JSONB NOT NULL,
        data_class TEXT NOT NULL DEFAULT 'test-plan-manifest'
          CHECK (data_class IN ('test-plan-manifest','evaluation-dataset')),
        exported_by TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (approved_test_case_version_id, content_sha256)
      );
      CREATE INDEX IF NOT EXISTS ai_dataset_exports_version_idx
        ON ${this.schema}.ai_dataset_exports(approved_test_case_version_id, created_at DESC);
      CREATE TABLE IF NOT EXISTS ${this.schema}.ai_experiment_runs (
        id TEXT PRIMARY KEY,
        dataset_export_id TEXT NOT NULL
          REFERENCES ${this.schema}.ai_dataset_exports(id) ON DELETE RESTRICT,
        approved_test_case_version_id TEXT NOT NULL
          REFERENCES ${this.schema}.approved_test_case_versions(id) ON DELETE RESTRICT,
        dataset_id TEXT NOT NULL,
        dataset_version_id TEXT NOT NULL,
        experiment_id TEXT NOT NULL UNIQUE,
        project_name TEXT NOT NULL,
        data_class TEXT NOT NULL CHECK (data_class IN ('production-candidate')),
        status TEXT NOT NULL CHECK (status IN ('execution-only')),
        total_runs INTEGER NOT NULL CHECK (total_runs >= 0),
        successful_runs INTEGER NOT NULL CHECK (successful_runs >= 0),
        failed_runs INTEGER NOT NULL CHECK (failed_runs >= 0),
        evaluator_names_json JSONB NOT NULL,
        target_versions_json JSONB NOT NULL,
        gate_eligible BOOLEAN NOT NULL DEFAULT FALSE CHECK (gate_eligible = FALSE),
        requested_by TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS ai_experiment_runs_dataset_idx
        ON ${this.schema}.ai_experiment_runs(dataset_export_id, created_at DESC);
      CREATE TABLE IF NOT EXISTS ${this.schema}.ai_evaluation_sample_sets (
        id TEXT PRIMARY KEY,
        approved_test_case_version_id TEXT NOT NULL
          REFERENCES ${this.schema}.approved_test_case_versions(id) ON DELETE RESTRICT,
        name TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','frozen')),
        version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
        content_sha256 TEXT NOT NULL DEFAULT '',
        frozen_by TEXT NOT NULL DEFAULT '',
        frozen_at TIMESTAMPTZ,
        created_by TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (approved_test_case_version_id, name, version)
      );
      CREATE TABLE IF NOT EXISTS ${this.schema}.ai_evaluation_samples (
        id TEXT PRIMARY KEY,
        sample_set_id TEXT NOT NULL
          REFERENCES ${this.schema}.ai_evaluation_sample_sets(id) ON DELETE CASCADE,
        approved_test_case_id TEXT NOT NULL,
        ai_dimension TEXT NOT NULL,
        input_json JSONB NOT NULL,
        expected_json JSONB NOT NULL,
        metadata_json JSONB NOT NULL,
        status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','rejected')),
        review_note TEXT NOT NULL DEFAULT '',
        reviewed_by TEXT NOT NULL DEFAULT '',
        reviewed_at TIMESTAMPTZ,
        created_by TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS ai_evaluation_samples_set_idx
        ON ${this.schema}.ai_evaluation_samples(sample_set_id, created_at);
      CREATE TABLE IF NOT EXISTS ${this.schema}.ai_evaluator_calibrations (
        id TEXT PRIMARY KEY,
        evaluator_name TEXT NOT NULL,
        evaluator_version TEXT NOT NULL,
        evaluator_kind TEXT NOT NULL CHECK (evaluator_kind IN ('code','llm_judge')),
        target_dimensions_json JSONB NOT NULL,
        evaluation_subjects_json JSONB NOT NULL,
        evaluation_layers_json JSONB NOT NULL,
        phoenix_dataset_id TEXT NOT NULL,
        phoenix_dataset_version_id TEXT NOT NULL,
        phoenix_experiment_id TEXT NOT NULL,
        content_sha256 TEXT NOT NULL,
        sample_count INTEGER NOT NULL CHECK (sample_count > 0),
        metrics_json JSONB NOT NULL,
        thresholds_json JSONB NOT NULL,
        passed BOOLEAN NOT NULL,
        calibrated_by TEXT NOT NULL,
        calibration_note TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (evaluator_name, evaluator_version, content_sha256)
      );
      CREATE INDEX IF NOT EXISTS ai_evaluator_calibrations_name_idx
        ON ${this.schema}.ai_evaluator_calibrations(evaluator_name, created_at DESC)
    `);
    await this.pool.query(`ALTER TABLE ${this.schema}.ai_dataset_exports ADD COLUMN IF NOT EXISTS data_class TEXT NOT NULL DEFAULT 'test-plan-manifest'`);
    await this.pool.query(`ALTER TABLE ${this.schema}.ai_evaluator_calibrations ADD COLUMN IF NOT EXISTS evaluation_subjects_json JSONB NOT NULL DEFAULT '[]'::jsonb`);
    await this.pool.query(`ALTER TABLE ${this.schema}.ai_evaluator_calibrations ADD COLUMN IF NOT EXISTS evaluation_layers_json JSONB NOT NULL DEFAULT '[]'::jsonb`);
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

  async listDatasetExports(): Promise<AiDatasetExportRecord[]> {
    const result = await this.pool.query(
      `SELECT * FROM ${this.schema}.ai_dataset_exports ORDER BY created_at DESC`,
    );
    return result.rows.map((row) => this.parseDatasetExport(row));
  }

  async getDatasetExport(id: string): Promise<AiDatasetExportRecord> {
    const result = await this.pool.query(
      `SELECT * FROM ${this.schema}.ai_dataset_exports WHERE id = $1`,
      [id],
    );
    if (result.rowCount !== 1) throw new Error(`Phoenix Dataset 映射 ${id} 不存在`);
    return this.parseDatasetExport(result.rows[0]);
  }

  async listApprovedApiScenarios(approvedVersionId: string): Promise<ApprovedApiScenarioRecord[]> {
    const result = await this.pool.query(
      `SELECT id, approved_version_id, approved_test_case_ids, name, yaml_content,
              content_sha256, approved_by, approved_at
       FROM ${this.schema}.api_yaml_scenarios
       WHERE approved_version_id = $1 AND status = 'approved'
       ORDER BY approved_at DESC`,
      [approvedVersionId],
    );
    return result.rows.map((row) => ({
      id: String(row.id),
      approvedTestCaseVersionId: String(row.approved_version_id),
      approvedTestCaseIds: row.approved_test_case_ids as string[],
      name: String(row.name),
      yamlContent: String(row.yaml_content),
      contentSha256: String(row.content_sha256),
      approvedBy: String(row.approved_by),
      approvedAt: this.iso(row.approved_at),
    }));
  }

  async findDatasetExport(approvedVersionId: string, contentSha256: string): Promise<AiDatasetExportRecord | null> {
    const result = await this.pool.query(
      `SELECT * FROM ${this.schema}.ai_dataset_exports
       WHERE approved_test_case_version_id = $1 AND content_sha256 = $2`,
      [approvedVersionId, contentSha256],
    );
    return result.rowCount ? this.parseDatasetExport(result.rows[0]) : null;
  }

  async saveDatasetExport(input: Omit<AiDatasetExportRecord, "createdAt">): Promise<AiDatasetExportRecord> {
    const result = await this.pool.query(
      `INSERT INTO ${this.schema}.ai_dataset_exports
       (id, approved_test_case_version_id, dataset_name, dataset_id, dataset_version_id,
        content_sha256, example_count, ai_dimensions_json, data_class, exported_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (approved_test_case_version_id, content_sha256)
       DO UPDATE SET dataset_id = EXCLUDED.dataset_id,
                     dataset_version_id = EXCLUDED.dataset_version_id
       RETURNING *`,
      [input.id, input.approvedTestCaseVersionId, input.datasetName, input.datasetId,
        input.datasetVersionId, input.contentSha256, input.exampleCount,
        JSON.stringify(input.aiDimensions), input.dataClass, input.exportedBy],
    );
    return this.parseDatasetExport(result.rows[0]);
  }

  async listExperimentRuns(): Promise<AiExperimentRunRecord[]> {
    const result = await this.pool.query(
      `SELECT * FROM ${this.schema}.ai_experiment_runs ORDER BY created_at DESC`,
    );
    return result.rows.map((row) => this.parseExperimentRun(row));
  }

  async saveExperimentRun(input: Omit<AiExperimentRunRecord, "createdAt">): Promise<AiExperimentRunRecord> {
    const result = await this.pool.query(
      `INSERT INTO ${this.schema}.ai_experiment_runs
       (id, dataset_export_id, approved_test_case_version_id, dataset_id, dataset_version_id,
        experiment_id, project_name, data_class, status, total_runs, successful_runs,
        failed_runs, evaluator_names_json, target_versions_json, gate_eligible, requested_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14::jsonb,FALSE,$15)
       RETURNING *`,
      [input.id, input.datasetExportId, input.approvedTestCaseVersionId, input.datasetId,
        input.datasetVersionId, input.experimentId, input.projectName, input.dataClass,
        input.status, input.totalRuns, input.successfulRuns, input.failedRuns,
        JSON.stringify(input.evaluatorNames), JSON.stringify(input.targetVersions), input.requestedBy],
    );
    return this.parseExperimentRun(result.rows[0]);
  }

  async listEvaluationSampleSets(approvedVersionId?: string): Promise<AiEvaluationSampleSetRecord[]> {
    const result = await this.pool.query(
      `SELECT * FROM ${this.schema}.ai_evaluation_sample_sets
       WHERE ($1::text IS NULL OR approved_test_case_version_id = $1)
       ORDER BY created_at DESC`,
      [approvedVersionId ?? null],
    );
    return Promise.all(result.rows.map((row) => this.parseEvaluationSampleSet(row)));
  }

  async getEvaluationSampleSet(id: string): Promise<AiEvaluationSampleSetRecord> {
    const result = await this.pool.query(
      `SELECT * FROM ${this.schema}.ai_evaluation_sample_sets WHERE id = $1`, [id],
    );
    if (result.rowCount !== 1) throw new Error(`AI 评测样本集 ${id} 不存在`);
    return this.parseEvaluationSampleSet(result.rows[0]);
  }

  async createEvaluationSampleSet(input: {
    id: string; approvedTestCaseVersionId: string; name: string; createdBy: string;
  }): Promise<AiEvaluationSampleSetRecord> {
    const result = await this.pool.query(
      `INSERT INTO ${this.schema}.ai_evaluation_sample_sets
       (id, approved_test_case_version_id, name, created_by)
       VALUES ($1,$2,$3,$4) RETURNING *`,
      [input.id, input.approvedTestCaseVersionId, input.name, input.createdBy],
    );
    return this.parseEvaluationSampleSet(result.rows[0]);
  }

  async saveEvaluationSample(input: Omit<AiEvaluationSampleRecord, "createdAt" | "updatedAt" | "reviewedAt">): Promise<AiEvaluationSampleRecord> {
    const result = await this.pool.query(
      `INSERT INTO ${this.schema}.ai_evaluation_samples
       (id, sample_set_id, approved_test_case_id, ai_dimension, input_json, expected_json,
        metadata_json, status, review_note, reviewed_by, reviewed_at, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
               CASE WHEN $8 = 'draft' THEN NULL ELSE NOW() END,$11)
       ON CONFLICT (id) DO UPDATE SET
         approved_test_case_id = EXCLUDED.approved_test_case_id,
         ai_dimension = EXCLUDED.ai_dimension,
         input_json = EXCLUDED.input_json,
         expected_json = EXCLUDED.expected_json,
         metadata_json = EXCLUDED.metadata_json,
         status = EXCLUDED.status,
         review_note = EXCLUDED.review_note,
         reviewed_by = EXCLUDED.reviewed_by,
         reviewed_at = EXCLUDED.reviewed_at,
         updated_at = NOW()
       RETURNING *`,
      [input.id, input.sampleSetId, input.approvedTestCaseId, input.aiDimension,
        input.input, input.expected, input.metadata, input.status, input.reviewNote,
        input.reviewedBy, input.createdBy],
    );
    return this.parseEvaluationSample(result.rows[0]);
  }

  async freezeEvaluationSampleSet(id: string, contentSha256: string, frozenBy: string): Promise<AiEvaluationSampleSetRecord> {
    const result = await this.pool.query(
      `UPDATE ${this.schema}.ai_evaluation_sample_sets
       SET status = 'frozen', content_sha256 = $2, frozen_by = $3, frozen_at = NOW()
       WHERE id = $1 AND status = 'draft' RETURNING *`,
      [id, contentSha256, frozenBy],
    );
    if (result.rowCount !== 1) throw new Error("样本集不存在或已经冻结");
    return this.parseEvaluationSampleSet(result.rows[0]);
  }

  async listEvaluatorCalibrations(): Promise<EvaluatorCalibrationRecord[]> {
    const result = await this.pool.query(
      `SELECT * FROM ${this.schema}.ai_evaluator_calibrations ORDER BY created_at DESC`,
    );
    return result.rows.map((row) => this.parseEvaluatorCalibration(row));
  }

  async saveEvaluatorCalibration(input: Omit<EvaluatorCalibrationRecord, "createdAt">): Promise<EvaluatorCalibrationRecord> {
    const result = await this.pool.query(
      `INSERT INTO ${this.schema}.ai_evaluator_calibrations
       (id, evaluator_name, evaluator_version, evaluator_kind, target_dimensions_json, evaluation_subjects_json, evaluation_layers_json,
        phoenix_dataset_id, phoenix_dataset_version_id, phoenix_experiment_id, content_sha256,
        sample_count, metrics_json, thresholds_json, passed, calibrated_by, calibration_note)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
       ON CONFLICT (evaluator_name, evaluator_version, content_sha256)
       DO UPDATE SET phoenix_experiment_id = EXCLUDED.phoenix_experiment_id
       RETURNING *`,
      [input.id, input.evaluatorName, input.evaluatorVersion, input.evaluatorKind,
        input.targetDimensions, input.evaluationSubjects, input.evaluationLayers,
        input.phoenixDatasetId, input.phoenixDatasetVersionId,
        input.phoenixExperimentId, input.contentSha256, input.sampleCount, input.metrics,
        input.thresholds, input.passed, input.calibratedBy, input.calibrationNote],
    );
    return this.parseEvaluatorCalibration(result.rows[0]);
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

  private parseDatasetExport(row: Record<string, unknown>): AiDatasetExportRecord {
    return {
      id: String(row.id),
      approvedTestCaseVersionId: String(row.approved_test_case_version_id),
      datasetName: String(row.dataset_name),
      datasetId: String(row.dataset_id),
      datasetVersionId: String(row.dataset_version_id),
      contentSha256: String(row.content_sha256),
      exampleCount: Number(row.example_count),
      aiDimensions: row.ai_dimensions_json as string[],
      dataClass: row.data_class === "evaluation-dataset" ? "evaluation-dataset" : "test-plan-manifest",
      exportedBy: String(row.exported_by),
      createdAt: this.iso(row.created_at),
    };
  }

  private parseExperimentRun(row: Record<string, unknown>): AiExperimentRunRecord {
    return {
      id: String(row.id),
      datasetExportId: String(row.dataset_export_id),
      approvedTestCaseVersionId: String(row.approved_test_case_version_id),
      datasetId: String(row.dataset_id),
      datasetVersionId: String(row.dataset_version_id),
      experimentId: String(row.experiment_id),
      projectName: String(row.project_name),
      dataClass: "production-candidate",
      status: "execution-only",
      totalRuns: Number(row.total_runs),
      successfulRuns: Number(row.successful_runs),
      failedRuns: Number(row.failed_runs),
      evaluatorNames: row.evaluator_names_json as string[],
      targetVersions: row.target_versions_json as string[],
      gateEligible: false,
      requestedBy: String(row.requested_by),
      createdAt: this.iso(row.created_at),
    };
  }

  private parseEvaluationSample(row: Record<string, unknown>): AiEvaluationSampleRecord {
    return {
      id: String(row.id), sampleSetId: String(row.sample_set_id),
      approvedTestCaseId: String(row.approved_test_case_id), aiDimension: String(row.ai_dimension),
      input: row.input_json as Record<string, unknown>, expected: row.expected_json as Record<string, unknown>,
      metadata: row.metadata_json as Record<string, unknown>, status: row.status as AiEvaluationSampleStatus,
      reviewNote: String(row.review_note), reviewedBy: String(row.reviewed_by),
      reviewedAt: row.reviewed_at ? this.iso(row.reviewed_at) : null,
      createdBy: String(row.created_by), createdAt: this.iso(row.created_at), updatedAt: this.iso(row.updated_at),
    };
  }

  private async parseEvaluationSampleSet(row: Record<string, unknown>): Promise<AiEvaluationSampleSetRecord> {
    const samples = await this.pool.query(
      `SELECT * FROM ${this.schema}.ai_evaluation_samples WHERE sample_set_id = $1 ORDER BY created_at`,
      [row.id],
    );
    return {
      id: String(row.id), approvedTestCaseVersionId: String(row.approved_test_case_version_id),
      name: String(row.name), status: row.status as AiEvaluationSampleSetStatus,
      version: Number(row.version), contentSha256: String(row.content_sha256),
      frozenBy: String(row.frozen_by), frozenAt: row.frozen_at ? this.iso(row.frozen_at) : null,
      createdBy: String(row.created_by), createdAt: this.iso(row.created_at),
      samples: samples.rows.map((item) => this.parseEvaluationSample(item)),
    };
  }

  private parseEvaluatorCalibration(row: Record<string, unknown>): EvaluatorCalibrationRecord {
    return {
      id: String(row.id), evaluatorName: String(row.evaluator_name),
      evaluatorVersion: String(row.evaluator_version), evaluatorKind: row.evaluator_kind as "code" | "llm_judge",
      targetDimensions: row.target_dimensions_json as string[],
      evaluationSubjects: row.evaluation_subjects_json as Array<"testmesh" | "target_application">,
      evaluationLayers: row.evaluation_layers_json as Array<"agent_decision" | "tool_execution" | "business_outcome" | "final_response">,
      phoenixDatasetId: String(row.phoenix_dataset_id),
      phoenixDatasetVersionId: String(row.phoenix_dataset_version_id), phoenixExperimentId: String(row.phoenix_experiment_id),
      contentSha256: String(row.content_sha256), sampleCount: Number(row.sample_count),
      metrics: row.metrics_json as Record<string, unknown>, thresholds: row.thresholds_json as Record<string, number>,
      passed: Boolean(row.passed), calibratedBy: String(row.calibrated_by),
      calibrationNote: String(row.calibration_note), createdAt: this.iso(row.created_at),
    };
  }

  private iso(value: unknown): string {
    return value instanceof Date ? value.toISOString() : String(value);
  }
}
