import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import pg from "pg";
import { Command, isInterrupted } from "@langchain/langgraph";
import { createAnalysisPostgresResources, readAnalysisPostgresConfig } from "../server/requirement-analysis/postgres.js";
import { createRequirementReview } from "../server/requirement-analysis/review.js";

// Offline, one-time cutover. No legacy runtime is imported or executed.
export async function migrateDeepAgents(environment: NodeJS.ProcessEnv = process.env) {
  const config = readAnalysisPostgresConfig(environment);
  const legacy = [environment.TESTMESH_LEGACY_CHECKPOINT_SCHEMA ?? "harness_checkpoint",
    environment.TESTMESH_LEGACY_RUNTIME_SCHEMA ?? "harness_runtime"];
  for (const schema of legacy) {
    if (!/^[a-z][a-z0-9_]*$/.test(schema) || [config.checkpointSchema, config.businessSchema, "public"].includes(schema)) {
      throw new Error("旧 Harness Schema 不合法或与当前数据重叠，迁移停止");
    }
  }
  const pool = new pg.Pool(config);
  const connection = await pool.connect();
  let resources: Awaited<ReturnType<typeof createAnalysisPostgresResources>> | undefined;
  try {
    await connection.query("SELECT pg_advisory_lock(hashtext('testmesh-deepagents-migration'))");
    // Do not silently create an empty business schema on a mistyped database.
    const exists = await connection.query("SELECT to_regclass($1) AS name", [`${config.businessSchema}.requirement_analyses`]);
    if (!exists.rows[0].name) throw new Error("没有找到既有需求业务表，请确认数据库；新空库不需要数据迁移");
    resources = await createAnalysisPostgresResources(environment);
    const store = resources.requirementAnalysisStore;
    const analyses = await store.listAnalyses();
    const baselines = await store.listBaselines();
    const review = createRequirementReview(resources.checkpointer, store);
    for (const analysis of analyses) {
      const runConfig = { configurable: { thread_id: analysis.taskId } };
      let state = await review.getState(runConfig);
      if (!state.createdAt) {
        const paused = await review.invoke(analysis.id, runConfig);
        if (!isInterrupted(paused)) throw new Error(`分析 ${analysis.id} 未建立官方评审恢复点`);
        state = await review.getState(runConfig);
      }
      const baseline = baselines.find((item) => item.analysisId === analysis.id);
      if ((analysis.status === "baselined") !== Boolean(baseline)) throw new Error(`分析 ${analysis.id} 的业务状态与基线不一致`);
      if (baseline && state.next.length > 0) {
        const completed = await review.invoke(new Command({ resume: baseline.id }), runConfig);
        if (isInterrupted(completed) || completed.id !== baseline.id) throw new Error(`分析 ${analysis.id} 基线恢复失败`);
      } else if (!baseline && state.next.length === 0) {
        throw new Error(`分析 ${analysis.id} 尚未批准，但官方检查点已经结束`);
      }
    }
    // The business tables are never rewritten. Only retired framework state is removed.
    await connection.query("BEGIN");
    for (const schema of legacy) await connection.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await connection.query("COMMIT");
    return { analyses: analyses.length, baselines: baselines.length, retiredSchemas: legacy };
  } catch (error) {
    await connection.query("ROLLBACK");
    throw error;
  } finally {
    await resources?.close();
    await connection.query("SELECT pg_advisory_unlock(hashtext('testmesh-deepagents-migration'))");
    connection.release();
    await pool.end();
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  process.stdout.write(`${JSON.stringify(await migrateDeepAgents(), null, 2)}\n`);
}
