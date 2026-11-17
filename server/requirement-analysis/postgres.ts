import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import pg from "pg";
import { RequirementAnalysisPostgresStore } from "../requirement-analysis/postgres-store.js";
import { AiQualityPostgresStore } from "../ai-quality/postgres-store.js";
import { TestDesignPostgresStore } from "../test-design/postgres-store.js";
import { KnowledgePostgresStore } from "../knowledge/postgres-store.js";
import { ProjectConfigPostgresStore } from "../project-config/postgres-store.js";
import { FailureTriagePostgresStore } from "../failure-triage/postgres-store.js";
import { QualityManagementPostgresStore } from "../quality-management/postgres-store.js";
import { TestModelPostgresStore } from "../test-design/test-model-store.js";
import { TestConditionPostgresStore } from "../test-design/test-condition-store.js";

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
  aiQualityStore: AiQualityPostgresStore;
  testDesignStore: TestDesignPostgresStore;
  testModelStore: TestModelPostgresStore;
  testConditionStore: TestConditionPostgresStore;
  knowledgeStore: KnowledgePostgresStore;
  projectConfigStore: ProjectConfigPostgresStore;
  failureTriageStore: FailureTriagePostgresStore;
  qualityManagementStore: QualityManagementPostgresStore;
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
  const aiQualityStore = new AiQualityPostgresStore(pool, config.businessSchema);
  const testDesignStore = new TestDesignPostgresStore(pool, config.businessSchema);
  const testModelStore = new TestModelPostgresStore(pool, config.businessSchema);
  const testConditionStore = new TestConditionPostgresStore(pool, config.businessSchema);
  const knowledgeStore = new KnowledgePostgresStore(pool, config.businessSchema);
  const projectConfigStore = new ProjectConfigPostgresStore(pool, config.businessSchema);
  const failureTriageStore = new FailureTriagePostgresStore(pool, config.businessSchema);
  const qualityManagementStore = new QualityManagementPostgresStore(pool, config.businessSchema);
  try {
    await checkpointer.setup();
    await requirementAnalysisStore.setup();
    await testModelStore.setup();
    await testConditionStore.setup();
    await testDesignStore.setup();
    await aiQualityStore.setup();
    await knowledgeStore.setup();
    await projectConfigStore.setup();
    await failureTriageStore.setup();
    await qualityManagementStore.setup();
  } catch (error) {
    await pool.end();
    throw error;
  }

  return {
    checkpointer,
    requirementAnalysisStore,
    aiQualityStore,
    testDesignStore,
    testModelStore,
    testConditionStore,
    knowledgeStore,
    projectConfigStore,
    failureTriageStore,
    qualityManagementStore,
    close: () => checkpointer.end(),
  };
}
