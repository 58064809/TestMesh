import { randomUUID } from "node:crypto";
import { Command, isInterrupted } from "@langchain/langgraph";
import pg from "pg";
import { AIMessage } from "@langchain/core/messages";
import { fakeModel } from "@langchain/core/testing";
import { runRequirementAnalysisAgent } from "../server/requirement-analysis/agent.js";
import { validateRequirementAnalysis } from "../server/requirement-analysis/validation.js";
import { migrateDeepAgents } from "../scripts/migrate-deepagents.js";
import { RequirementAnalysisService } from "../server/requirement-analysis/service.js";
import { createSources } from "../server/requirement-analysis/sources.js";
import { createRequirementReview } from "../server/requirement-analysis/review.js";
import { createAnalysisPostgresResources, readAnalysisPostgresConfig } from "../server/requirement-analysis/postgres.js";
import { PENDING_PRD_REVISION } from "../server/requirement-analysis/postgres-store.js";

const suffix = randomUUID().replaceAll("-", "").slice(0, 10);
const schemas = {
  checkpoint: `ra_checkpoint_${suffix}`,
  legacyCheckpoint: `old_checkpoint_${suffix}`,
  legacyRuntime: `old_runtime_${suffix}`,
  business: `ra_business_${suffix}`,
};
const environment = {
  ...process.env,
  TESTMESH_CHECKPOINT_SCHEMA: schemas.checkpoint,
  TESTMESH_LEGACY_CHECKPOINT_SCHEMA: schemas.legacyCheckpoint,
  TESTMESH_LEGACY_RUNTIME_SCHEMA: schemas.legacyRuntime,
  TESTMESH_BUSINESS_SCHEMA: schemas.business,
};
const config = readAnalysisPostgresConfig(environment);
const cleanupPool = new pg.Pool({
  host: config.host,
  port: config.port,
  user: config.user,
  password: config.password,
  database: config.database,
  application_name: "testmesh-ra-integration-cleanup",
});

const sources = createSources([{
  originalname: "approved-prd.md",
  mimetype: "text/markdown",
  buffer: Buffer.from("订单 30 分钟未支付自动关闭。\n\n补充说明写订单 15 分钟未支付自动关闭。"),
}], []);
const document = {
  summary: {
    id: "SUM-1",
    description: "订单关闭需求",
    origin: "explicit" as const,
    source_refs: ["SRC-1"],
    confidence: 1,
  },
  requirements: [],
  actors: [],
  business_rules: [],
  flows: [],
  states: [],
  constraints: [],
  exceptions: [],
  open_questions: [{
    id: "OQ-1",
    description: "订单关闭时间存在冲突",
    origin: "explicit" as const,
    source_refs: ["SRC-1", "SRC-2"],
    confidence: 1,
    issue_type: "conflict" as const,
  }],
  sources: [{
    id: "SRC-1",
    description: "关闭时间规则一",
    origin: "explicit" as const,
    source_refs: [],
    confidence: 1,
    source_file_id: "ATT-1",
    source_file_name: "approved-prd.md",
    locator_type: "paragraph" as const,
    locator: "段落 1",
    excerpt: "订单 30 分钟未支付自动关闭。",
  }, {
    id: "SRC-2",
    description: "关闭时间规则二",
    origin: "explicit" as const,
    source_refs: [],
    confidence: 1,
    source_file_id: "ATT-1",
    source_file_name: "approved-prd.md",
    locator_type: "paragraph" as const,
    locator: "段落 2",
    excerpt: "补充说明写订单 15 分钟未支付自动关闭。",
  }],
};

let resources: Awaited<ReturnType<typeof createAnalysisPostgresResources>> | undefined;
try {
  resources = await createAnalysisPostgresResources(environment);
  const taskId = `ra-task-${suffix}`;
  const artifactId = `ra-artifact-${suffix}`;
  const analysisId = `ra-analysis-${suffix}`;
  validateRequirementAnalysis(document, sources);

  await resources.requirementAnalysisStore.saveAnalysis({
    id: analysisId,
    taskId,
    artifactId,
    document,
    model: "integration-fake-model",
    sources,
    trace: {
      provider: "phoenix",
      projectName: "testmesh-requirement-analysis",
      traceId: "0123456789abcdef0123456789abcdef",
    },
  });
  let graph = createRequirementReview(resources.checkpointer, resources.requirementAnalysisStore);
  const graphConfig = { configurable: { thread_id: taskId } };
  const paused = await graph.invoke(analysisId, graphConfig);
  if (!isInterrupted(paused)) throw new Error("没有停在人工评审恢复点");
  await resources.close();
  resources = await createAnalysisPostgresResources(environment);
  graph = createRequirementReview(resources.checkpointer, resources.requirementAnalysisStore);

  await resources.requirementAnalysisStore.recordReview(analysisId, "SUM-1", {
    status: "accepted", reviewer: "", reason: "", issueType: "", mergeInto: "",
    decision: "", decisionBy: "", prdRevision: "",
  });
  await resources.requirementAnalysisStore.recordReview(analysisId, "OQ-1", {
    status: "accepted", reviewer: "", reason: "评审确认采用 30 分钟", issueType: "conflict",
    mergeInto: "", decision: "订单 30 分钟未支付自动关闭", decisionBy: "产品负责人",
    prdRevision: PENDING_PRD_REVISION,
  });
  const baseline = await resources.requirementAnalysisStore.createBaseline(analysisId, {
    prdRevision: "RA-PG-1",
    approvedBy: "产品负责人",
    previousBaselineId: null,
    prdFilename: "approved-prd.md",
    prdFile: Buffer.from("订单 30 分钟未支付自动关闭。"),
  });
  const completed = await graph.invoke(
    new Command({ resume: baseline.id }),
    graphConfig,
  );
  if (isInterrupted(completed) || completed.id !== baseline.id) throw new Error("需求分析工作流恢复后没有完成");

  const persisted = await resources.requirementAnalysisStore.getAnalysis(analysisId);
  const loadedBaseline = await resources.requirementAnalysisStore.getBaseline(baseline.id);
  if (persisted.record.status !== "baselined") throw new Error("分析业务状态没有冻结为基线");
  if (persisted.record.traceId !== "0123456789abcdef0123456789abcdef") {
    throw new Error("Phoenix Trace 业务映射没有正确持久化");
  }
  if (!loadedBaseline.file.equals(Buffer.from("订单 30 分钟未支付自动关闭。"))) {
    throw new Error("获批 PRD 字节没有正确持久化");
  }
  const snapshot = loadedBaseline.snapshot as { reviews: Array<{ itemId: string; prdRevision: string }> };
  if (snapshot.reviews.find((review) => review.itemId === "OQ-1")?.prdRevision !== "RA-PG-1") {
    throw new Error("待建立版本没有在冻结快照中解析为正式 PRD 版本");
  }
  // Exercise offline migration on a real database and verify business data remains intact.
  await cleanupPool.query(`CREATE SCHEMA ${schemas.legacyCheckpoint}`);
  await cleanupPool.query(`CREATE SCHEMA ${schemas.legacyRuntime}`);
  await cleanupPool.query(`CREATE TABLE ${schemas.legacyRuntime}.runs (id text)`);
  const databaseSnapshot = async () => {
    const result = [];
    for (const table of ["requirement_analyses", "analysis_source_files", "analysis_review_events", "requirement_baselines"]) {
      result.push((await cleanupPool.query(`SELECT md5(string_agg(row_to_json(t)::text, '' ORDER BY row_to_json(t)::text)) AS hash FROM ${schemas.business}.${table} t`)).rows[0].hash);
    }
    return JSON.stringify(result);
  };
  const before = await databaseSnapshot();
  const pendingId = `pending-${suffix}`;
  const pendingTask = `pending-task-${suffix}`;
  await resources.requirementAnalysisStore.saveAnalysis({
    id: pendingId, taskId: pendingTask, artifactId: `pending-artifact-${suffix}`,
    document, model: "integration-fake-model", sources,
  });
  const beforeMigration = await databaseSnapshot();
  await resources.checkpointer.deleteThread(taskId);
  const migration = await migrateDeepAgents(environment);
  await migrateDeepAgents(environment); // Idempotent rerun.
  if (beforeMigration !== await databaseSnapshot() || before === beforeMigration) throw new Error("迁移改动了原始业务数据或测试缺少待评审报告");
  const pendingState = await graph.getState({ configurable: { thread_id: pendingTask } });
  if (!pendingState.tasks.some((item) => item.interrupts?.length)) throw new Error("未批准分析没有保持人工评审暂停状态");
  for (const schema of [schemas.legacyCheckpoint, schemas.legacyRuntime]) {
    if ((await cleanupPool.query("SELECT 1 FROM pg_namespace WHERE nspname=$1", [schema])).rowCount) throw new Error("旧 Harness Schema 未删除");
  }
  const service = new RequirementAnalysisService(resources);
  const retry = await service.createBaselineAndResume(analysisId, {
    prdRevision: "RA-PG-1", approvedBy: "产品负责人", previousBaselineId: null,
    prdFilename: "approved-prd.md", prdFile: Buffer.from("订单 30 分钟未支付自动关闭。"),
  });
  if (retry.id !== baseline.id) throw new Error("重复提交生成了第二份基线");
  const modelDocument = {
    ...document,
    sources: document.sources.map((source) => Object.fromEntries(
      Object.entries(source).filter(([key]) => key !== "source_file_name"),
    )),
  };
  const model = Object.assign(fakeModel().respond(new AIMessage(JSON.stringify(modelDocument))), {
    getName: () => "ChatOpenAI", modelName: "gpt-5.6-luna",
  });
  const generated = await runRequirementAnalysisAgent({
    taskId: `agent-${suffix}`, message: "分析需求", sources, model, checkpointer: resources.checkpointer,
  });
  if (!generated.result.summary) throw new Error("官方 Deep Agents 未生成结构化候选");
  const checkpoint = await resources.checkpointer.getTuple({ configurable: { thread_id: `agent-${suffix}:analysis` } });
  // structuredResponse is an ephemeral output channel in the official agent.
  // Durable messages are framework-owned; the validated document is business data.
  if (!Array.isArray(checkpoint?.checkpoint.channel_values.messages)
    || checkpoint.checkpoint.channel_values.messages.length < 2) {
    throw new Error("官方 Agent 检查点未持久化消息记录");
  }
  process.stdout.write(JSON.stringify({
    migration,
    taskId,
    analysisId,
    artifactId,
    baselineId: baseline.id,
    status: "completed",
    reviewEvents: (await resources.requirementAnalysisStore.listReviews(analysisId)).length,
    sourceFiles: (await resources.requirementAnalysisStore.listSourceFiles(analysisId)).length,
  }, null, 2));
} finally {
  await resources?.close();
  for (const schema of [schemas.business, schemas.legacyRuntime, schemas.legacyCheckpoint, schemas.checkpoint]) {
    await cleanupPool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  }
  await cleanupPool.end();
}
