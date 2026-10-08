import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import pg from "pg";
import { RequirementAnalysisPostgresStore } from "../requirement-analysis/postgres-store.js";

const DEFAULT_CHECKPOINT_SCHEMA = "deepagents_checkpoint";
const DEFAULT_BUSINESS_SCHEMA = "testmesh_business";

export interface AnalysisPostgresConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  checkpointSchema: string;
  businessSchema: string;
}

export interface AnalysisPostgresResources {
  checkpointer: PostgresSaver;
  requirementAnalysisStore: RequirementAnalysisPostgresStore;
  close(): Promise<void>;
}

function readSchemaName(value: string | undefined, fallback: string): string {
  const schema = value?.trim() || fallback;
  if (!/^[a-z][a-z0-9_]*$/.test(schema)) {
    throw new Error(`PostgreSQL Schema 名称不合法：${schema}`);
  }
  return schema;
}

export function readAnalysisPostgresConfig(
  environment: NodeJS.ProcessEnv = process.env,
): AnalysisPostgresConfig {
  const password = environment.PG_LOCAL_PASSWORD;
  if (!password) {
    throw new Error("缺少 PG_LOCAL_PASSWORD，无法连接 TestMesh PostgreSQL");
  }

  const port = Number(environment.PGPORT || "5432");
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`PGPORT 不合法：${environment.PGPORT}`);
  }

  return {
    host: environment.PGHOST?.trim() || "127.0.0.1",
    port,
    user: environment.PGUSER?.trim() || "postgres",
    password,
    database: environment.PGDATABASE?.trim() || "testmesh",
    checkpointSchema: readSchemaName(
      environment.TESTMESH_CHECKPOINT_SCHEMA,
      DEFAULT_CHECKPOINT_SCHEMA,
    ),
    businessSchema: readSchemaName(
      environment.TESTMESH_BUSINESS_SCHEMA,
      DEFAULT_BUSINESS_SCHEMA,
    ),
  };
}

export async function createAnalysisPostgresResources(
  environment: NodeJS.ProcessEnv = process.env,
): Promise<AnalysisPostgresResources> {
  const config = readAnalysisPostgresConfig(environment);
  const pool = new pg.Pool({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: config.database,
    application_name: "testmesh-deepagents",
  });
  const checkpointer = new PostgresSaver(pool, undefined, {
    schema: config.checkpointSchema,
  });
  const requirementAnalysisStore = new RequirementAnalysisPostgresStore(
    pool,
    config.businessSchema,
  );
  try {
    await checkpointer.setup();
    await requirementAnalysisStore.setup();
  } catch (error) {
    await pool.end();
    throw error;
  }

  return {
    checkpointer,
    requirementAnalysisStore,
    close: () => checkpointer.end(),
  };
}
