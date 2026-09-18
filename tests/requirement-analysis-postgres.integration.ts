import { randomUUID } from "node:crypto";
import { isInterrupted } from "@langchain/langgraph";
import pg from "pg";
import { evaluateRequirementAnalysisCompletion } from "../server/requirement-analysis/completion-gate.js";
import { createSources } from "../server/requirement-analysis/sources.js";
import {
  createRequirementAnalysisWorkflow,
  resumeRequirementAnalysisWithBaseline,
} from "../server/requirement-analysis/workflow.js";
import { createHarnessPostgresResources, readHarnessPostgresConfig } from "../server/harness/postgres.js";

const suffix = randomUUID().replaceAll("-", "").slice(0, 10);
const schemas = {
  checkpoint: `ra_checkpoint_${suffix}`,
  runtime: `ra_runtime_${suffix}`,
  business: `ra_business_${suffix}`,
};
const environment = {
  ...process.env,
  TESTMESH_CHECKPOINT_SCHEMA: schemas.checkpoint,
  TESTMESH_RUNTIME_SCHEMA: schemas.runtime,
  TESTMESH_BUSINESS_SCHEMA: schemas.business,
};
const config = readHarnessPostgresConfig(environment);
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

let resources: Awaited<ReturnType<typeof createHarnessPostgresResources>> | undefined;
try {
  resources = await createHarnessPostgresResources(environment);
  const taskId = `ra-task-${suffix}`;
  const artifactId = `ra-artifact-${suffix}`;
  const analysisId = `ra-analysis-${suffix}`;
  const task = {
    task_id: taskId,
    stage: "requirement_analysis" as const,
    stage_profile_version: "1.0.0",
    input_refs: [{ slot: "current_sources", kind: "source" as const, id: "ATT-1", required: true }],
    requested_by: "postgres-integration",
    created_at: new Date().toISOString(),
  };
  const gate = evaluateRequirementAnalysisCompletion({ task, candidate: document, sources, artifactId });
  if (!gate.report.accepted) throw new Error(`候选分析未通过 Gate：${gate.report.failed_at}`);

  await resources.requirementAnalysisStore.saveAnalysis({
    id: analysisId,
    taskId,
    artifactId,
    document,
    model: "integration-fake-model",
    sources,
  });
  const graph = createRequirementAnalysisWorkflow(resources.checkpointer);
  const graphConfig = { configurable: { thread_id: `ra-thread-${suffix}` } };
  const paused = await graph.invoke({
    taskId,
    analysisId,
    artifactId,
    completionAccepted: true,
    status: "candidate" as const,
    baselineId: null,
    failureReason: null,
  }, graphConfig);
  if (!isInterrupted(paused)) throw new Error("需求分析工作流没有停在人工评审恢复点");

  await resources.requirementAnalysisStore.recordReview(analysisId, "SUM-1", {
    status: "accepted", reviewer: "", reason: "", issueType: "", mergeInto: "",
    decision: "", decisionBy: "", prdRevision: "",
  });
  await resources.requirementAnalysisStore.recordReview(analysisId, "OQ-1", {
    status: "accepted", reviewer: "", reason: "评审确认采用 30 分钟", issueType: "conflict",
    mergeInto: "", decision: "订单 30 分钟未支付自动关闭", decisionBy: "产品负责人",
    prdRevision: "RA-PG-1",
  });
  const baseline = await resources.requirementAnalysisStore.createBaseline(analysisId, {
    prdRevision: "RA-PG-1",
    approvedBy: "产品负责人",
    previousBaselineId: null,
    prdFilename: "approved-prd.md",
    prdFile: Buffer.from("订单 30 分钟未支付自动关闭。"),
  });
  const completed = await graph.invoke(
    resumeRequirementAnalysisWithBaseline(analysisId, baseline.id),
    graphConfig,
  );
  if (completed.status !== "completed") throw new Error("需求分析工作流恢复后没有完成");

  const persisted = await resources.requirementAnalysisStore.getAnalysis(analysisId);
  const loadedBaseline = await resources.requirementAnalysisStore.getBaseline(baseline.id);
  if (persisted.record.status !== "baselined") throw new Error("分析业务状态没有冻结为基线");
  if (!loadedBaseline.file.equals(Buffer.from("订单 30 分钟未支付自动关闭。"))) {
    throw new Error("获批 PRD 字节没有正确持久化");
  }
  process.stdout.write(JSON.stringify({
    taskId,
    analysisId,
    artifactId,
    baselineId: baseline.id,
    status: completed.status,
    reviewEvents: (await resources.requirementAnalysisStore.listReviews(analysisId)).length,
    sourceFiles: (await resources.requirementAnalysisStore.listSourceFiles(analysisId)).length,
  }, null, 2));
} finally {
  await resources?.close();
  for (const schema of [schemas.business, schemas.runtime, schemas.checkpoint]) {
    await cleanupPool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  }
  await cleanupPool.end();
}
