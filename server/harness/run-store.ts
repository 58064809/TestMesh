import type pg from "pg";
import { z } from "zod";
import { HarnessRunStatusSchema, StageIdSchema } from "./contracts.js";

const VersionSchema = z.string().regex(/^\d+\.\d+\.\d+$/);
const IdSchema = z.string().trim().min(1);

export const HarnessRunRecordSchema = z.object({
  run_id: IdSchema,
  task_id: IdSchema,
  stage: StageIdSchema,
  status: HarnessRunStatusSchema,
  stage_profile_version: VersionSchema,
  output_schema_name: IdSchema,
  output_schema_version: VersionSchema,
  checkpoint_thread_id: IdSchema,
  artifact_id: z.string().nullable(),
  failure_stage: z.string().nullable(),
  failure_reason: z.string().nullable(),
  created_at: z.iso.datetime(),
  updated_at: z.iso.datetime(),
}).strict();

export const CreateHarnessRunSchema = HarnessRunRecordSchema.pick({
  run_id: true,
  task_id: true,
  stage: true,
  stage_profile_version: true,
  output_schema_name: true,
  output_schema_version: true,
  checkpoint_thread_id: true,
});

export const UpdateHarnessRunSchema = z.object({
  status: HarnessRunStatusSchema,
  artifact_id: z.string().trim().min(1).nullable().optional(),
  failure_stage: z.string().trim().min(1).nullable().optional(),
  failure_reason: z.string().trim().min(1).nullable().optional(),
}).strict();

export type HarnessRunRecord = z.infer<typeof HarnessRunRecordSchema>;
export type CreateHarnessRun = z.infer<typeof CreateHarnessRunSchema>;
export type UpdateHarnessRun = z.infer<typeof UpdateHarnessRunSchema>;

export const HarnessTraceEventSchema = z.object({
  kind: z.enum([
    "node_started",
    "node_completed",
    "node_interrupted",
    "tool_started",
    "tool_completed",
    "tool_failed",
    "run_failed",
  ]),
  name: IdSchema,
  message: z.string().nullable().default(null),
}).strict();

export const PersistedHarnessTraceEventSchema = HarnessTraceEventSchema.extend({
  sequence: z.number().int().positive(),
  run_id: IdSchema,
  created_at: z.iso.datetime(),
}).strict();

export type HarnessTraceEvent = z.infer<typeof HarnessTraceEventSchema>;
export type PersistedHarnessTraceEvent = z.infer<typeof PersistedHarnessTraceEventSchema>;

export class HarnessRunStore {
  private readonly schema: string;

  constructor(private readonly pool: pg.Pool, schema: string) {
    if (!/^[a-z][a-z0-9_]*$/.test(schema)) {
      throw new Error(`PostgreSQL Schema 名称不合法：${schema}`);
    }
    this.schema = schema;
  }

  async setup(): Promise<void> {
    await this.pool.query(`CREATE SCHEMA IF NOT EXISTS ${this.schema}`);
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS ${this.schema}.runs (
        run_id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        stage TEXT NOT NULL,
        status TEXT NOT NULL,
        stage_profile_version TEXT NOT NULL,
        output_schema_name TEXT NOT NULL,
        output_schema_version TEXT NOT NULL,
        checkpoint_thread_id TEXT NOT NULL UNIQUE,
        artifact_id TEXT,
        failure_stage TEXT,
        failure_reason TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS ${this.schema}.trace_events (
        sequence SERIAL PRIMARY KEY,
        run_id TEXT NOT NULL REFERENCES ${this.schema}.runs(run_id) ON DELETE CASCADE,
        kind TEXT NOT NULL,
        name TEXT NOT NULL,
        message TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
  }

  async create(input: CreateHarnessRun): Promise<HarnessRunRecord> {
    const value = CreateHarnessRunSchema.parse(input);
    const result = await this.pool.query(
      `INSERT INTO ${this.schema}.runs (
        run_id, task_id, stage, status, stage_profile_version,
        output_schema_name, output_schema_version, checkpoint_thread_id
      ) VALUES ($1, $2, $3, 'created', $4, $5, $6, $7)
      RETURNING *`,
      [
        value.run_id,
        value.task_id,
        value.stage,
        value.stage_profile_version,
        value.output_schema_name,
        value.output_schema_version,
        value.checkpoint_thread_id,
      ],
    );
    return this.parseRow(result.rows[0]);
  }

  async update(runId: string, input: UpdateHarnessRun): Promise<HarnessRunRecord> {
    const value = UpdateHarnessRunSchema.parse(input);
    const result = await this.pool.query(
      `UPDATE ${this.schema}.runs
       SET status = $2,
           artifact_id = COALESCE($3, artifact_id),
           failure_stage = $4,
           failure_reason = $5,
           updated_at = NOW()
       WHERE run_id = $1
       RETURNING *`,
      [
        runId,
        value.status,
        value.artifact_id ?? null,
        value.failure_stage ?? null,
        value.failure_reason ?? null,
      ],
    );
    if (result.rowCount !== 1) throw new Error(`Harness Run 不存在：${runId}`);
    return this.parseRow(result.rows[0]);
  }

  async get(runId: string): Promise<HarnessRunRecord | null> {
    const result = await this.pool.query(
      `SELECT * FROM ${this.schema}.runs WHERE run_id = $1`,
      [runId],
    );
    return result.rowCount === 1 ? this.parseRow(result.rows[0]) : null;
  }

  async getByTaskId(taskId: string): Promise<HarnessRunRecord | null> {
    const result = await this.pool.query(
      `SELECT * FROM ${this.schema}.runs WHERE task_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [taskId],
    );
    return result.rowCount === 1 ? this.parseRow(result.rows[0]) : null;
  }

  async appendTraceEvent(runId: string, input: HarnessTraceEvent): Promise<PersistedHarnessTraceEvent> {
    const event = HarnessTraceEventSchema.parse(input);
    const result = await this.pool.query(
      `INSERT INTO ${this.schema}.trace_events (run_id, kind, name, message)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [runId, event.kind, event.name, event.message],
    );
    return this.parseTraceEvent(result.rows[0]);
  }

  async listTraceEvents(runId: string): Promise<PersistedHarnessTraceEvent[]> {
    const result = await this.pool.query(
      `SELECT * FROM ${this.schema}.trace_events WHERE run_id = $1 ORDER BY sequence`,
      [runId],
    );
    return result.rows.map((row) => this.parseTraceEvent(row));
  }

  private parseRow(row: Record<string, unknown>): HarnessRunRecord {
    return HarnessRunRecordSchema.parse({
      ...row,
      created_at: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
      updated_at: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
    });
  }

  private parseTraceEvent(row: Record<string, unknown>): PersistedHarnessTraceEvent {
    return PersistedHarnessTraceEventSchema.parse({
      ...row,
      created_at: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    });
  }
}
