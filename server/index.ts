import express, { type ErrorRequestHandler } from "express";
import multer from "multer";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer as createViteServer } from "vite";
import {
  MAX_FILE_BYTES,
  MAX_FILES,
  MODEL,
  RequirementAnalysisValidationError,
  createSources,
  isAcceptedFilename,
  normalizeUploadFilename,
} from "./analysis.js";
import { MAX_OPENAPI_BYTES, parseHeaderLines, parseOpenApi, validateTargetBaseUrl } from "./openapi.js";
import { SCHEMATHESIS_VERSION, runSchemathesis, type RunnerAuth } from "./schemathesis.js";
import { HURL_VERSION, runHurlScenario } from "./hurl.js";
import { API_YAML_FORMAT, compileApiYamlScenario } from "./api-automation/yaml-scenario.js";
import { inspectRepository } from "./repository.js";
import { PLAYWRIGHT_VERSION, inspectPlaywrightProject, runPlaywrightTest } from "./playwright.js";
import {
  APPIUM_VERSION,
  UIAUTOMATOR2_VERSION,
  WDIO_VERSION,
  runAndroidTest,
} from "./android.js";
import { K6_VERSION, runK6Test } from "./k6.js";
import { ZAP_VERSION, runZapBaseline } from "./zap.js";
import { DomainStore, defaultDatabasePath } from "./store.js";
import { createAnalysisPostgresResources } from "./requirement-analysis/postgres.js";
import {
  RequirementAnalysisService,
} from "./requirement-analysis/service.js";
import { REQUIREMENT_ANALYSIS_TASK } from "./requirement-analysis/prompt.js";
import { createDoclingClientFromEnvironment } from "./document-parsing/docling.js";
import { parseAnalysisSources } from "./document-parsing/parse-sources.js";
import { z } from "zod";
import { initializePhoenixTracing, resolvePhoenixTraceUrl } from "./observability/phoenix.js";
import {
  assessControlledBenchmarkReadiness,
  assessProfileReadiness,
  assessQuality,
  type AiQualityProfile,
} from "./ai-quality/profile.js";
import { TestDesignService } from "./test-design/service.js";
import { BaselineSnapshotSchema, TestCaseSchema, TestModelDocumentSchema } from "./test-design/schema.js";
import { TestModelService } from "./test-design/test-model-service.js";
import { KnowledgeService } from "./knowledge/service.js";
import { QdrantKnowledgeIndex } from "./knowledge/qdrant.js";
import { ProjectAutomationConfigInputSchema, ProjectEnvironmentInputSchema, ProjectInputSchema, ProjectKnowledgeBindingInputSchema } from "./project-config/schema.js";
import { FailureDiagnosisRequestSchema } from "./failure-triage/schema.js";
import { FailureTriageService } from "./failure-triage/service.js";
import {
  ImprovementActionInputSchema,
  ImprovementActionUpdateSchema,
  QualityPlanApprovalSchema,
  QualityPlanInputSchema,
  RiskAcceptanceSchema,
} from "./quality-management/schema.js";
import { QualityManagementService } from "./quality-management/service.js";
import { renderQualityReport } from "./quality-management/report.js";
import { AiDatasetExportInputSchema, AiDatasetExportService } from "./ai-quality/dataset-export.js";
import { AiExperimentReadinessService } from "./ai-quality/experiment-readiness.js";
import { AiExperimentRunInputSchema, AiExperimentRunService } from "./ai-quality/experiment-run.js";
import { ProjectContractReadinessService } from "./ai-quality/project-contracts.js";
import {
  EvaluationDatasetExportSchema,
  EvaluationSampleFreezeSchema,
  EvaluationSamplePayloadSchema,
  EvaluationSampleReviewSchema,
  EvaluationSampleService,
  EvaluationSampleSetInputSchema,
} from "./ai-quality/evaluation-samples.js";
import { EvaluatorCalibrationInputSchema, EvaluatorCalibrationService } from "./ai-quality/evaluator-calibration.js";
import { ASSET_SCHEMA_VERSIONS, PROMPT_VERSIONS, TestConditionSetDocumentSchema } from "./test-design/asset-contracts.js";
import { TEST_DESIGN_PROMPT_REGISTRY } from "./test-design/prompt-registry.js";
import { runTestConditionAgent } from "./test-design/test-condition-agent.js";
import { createOpenAITestDesignModel } from "./test-design/agent.js";

initializePhoenixTracing();

const app = express();
const port = Number(process.env.PORT ?? 3000);
const isProduction = process.env.NODE_ENV === "production";
const store = new DomainStore(defaultDatabasePath());
const analysisResources = await createAnalysisPostgresResources();
const requirementAnalysisStore = analysisResources.requirementAnalysisStore;
const aiQualityStore = analysisResources.aiQualityStore;
const testDesignStore = analysisResources.testDesignStore;
const testModelStore = analysisResources.testModelStore;
const testConditionStore = analysisResources.testConditionStore;
const knowledgeStore = analysisResources.knowledgeStore;
const projectConfigStore = analysisResources.projectConfigStore;
const failureTriageStore = analysisResources.failureTriageStore;
const qualityManagementStore = analysisResources.qualityManagementStore;
const requirementAnalysisService = new RequirementAnalysisService(analysisResources);
const documentParser = createDoclingClientFromEnvironment();
const knowledgeService = new KnowledgeService(knowledgeStore, documentParser, new QdrantKnowledgeIndex());
const testModelService = new TestModelService(requirementAnalysisStore, testModelStore, documentParser, knowledgeService, projectConfigStore);
const testDesignService = new TestDesignService(requirementAnalysisStore, testDesignStore, documentParser, testModelStore, testConditionStore);
const aiDatasetExportService = new AiDatasetExportService(testDesignStore, aiQualityStore);
const aiExperimentReadinessService = new AiExperimentReadinessService(testDesignStore, aiQualityStore);
const aiExperimentRunService = new AiExperimentRunService(aiExperimentReadinessService, aiQualityStore);
const projectContractReadinessService = new ProjectContractReadinessService(projectConfigStore, knowledgeStore);
const evaluationSampleService = new EvaluationSampleService(testDesignStore, aiQualityStore);
const evaluatorCalibrationService = new EvaluatorCalibrationService(aiQualityStore);
const failureTriageService = new FailureTriageService(store, failureTriageStore, testDesignStore);
const qualityManagementService = new QualityManagementService(
  qualityManagementStore,
  projectConfigStore,
  requirementAnalysisStore,
  testDesignStore,
  testModelStore,
  aiQualityStore,
  failureTriageStore,
  store,
);

app.use(express.json({ limit: "768kb" }));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_FILE_BYTES,
    files: MAX_FILES,
  },
  fileFilter: (_request, file, callback) => {
    if (!isAcceptedFilename(file.originalname)) {
      callback(new Error(`不支持的文件格式：${file.originalname}`));
      return;
    }
    callback(null, true);
  },
});

const openApiUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_OPENAPI_BYTES, files: 1 },
  fileFilter: (_request, file, callback) => {
    if (!/\.(json|ya?ml)$/i.test(file.originalname)) {
      callback(new Error(`OpenAPI 只支持 JSON/YAML：${file.originalname}`));
      return;
    }
    callback(null, true);
  },
});

const baselineUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_BYTES, files: 1 },
  fileFilter: (_request, file, callback) => {
    if (!/\.(pdf|docx?|rtf|odt|md|txt|html?)$/i.test(file.originalname)) {
      callback(new Error(`获批 PRD 只接受 PDF、Word、RTF、ODT、Markdown、TXT 或 HTML：${file.originalname}`));
      return;
    }
    callback(null, true);
  },
});

const knowledgeUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_BYTES, files: 1 },
  fileFilter: (_request, file, callback) => {
    if (!isAcceptedFilename(file.originalname)) {
      callback(new Error(`知识库不支持该文件格式：${file.originalname}`));
      return;
    }
    callback(null, true);
  },
});

const AnalysisReviewInputSchema = z.object({
  status: z.enum(["accepted", "rejected", "merged", "clarify"]),
  reviewer: z.string().default(""),
  reason: z.string().default(""),
  issueType: z.union([z.enum(["missing", "ambiguity", "conflict"]), z.literal("")]).default(""),
  mergeInto: z.string().default(""),
  decision: z.string().default(""),
  decisionBy: z.string().default(""),
  prdRevision: z.string().default(""),
  amendment: z.object({
    description: z.string().trim().min(1),
    sourceRefs: z.array(z.string().min(1)),
  }).strict().optional(),
}).strict();

const AiQualityApprovalSchema = z.object({
  approvedBy: z.string().trim().min(1),
  approvalNote: z.string().trim().default(""),
}).strict();

const TestDesignRequestSchema = z.object({
  baselineId: z.string().trim().min(1),
  approvedTestModelVersionId: z.string().trim().min(1),
  approvedTestConditionVersionId: z.string().trim().min(1),
  regenerate: z.boolean().default(false),
}).strict();

const TestModelRequestSchema = z.object({
  baselineId: z.string().trim().min(1),
  projectId: z.string().trim().optional(),
  requestedBy: z.string().trim().default(""),
}).strict();

const TestModelAmendmentSchema = z.object({
  document: TestModelDocumentSchema,
  editor: z.string().trim().min(1),
  reason: z.string().trim().min(1),
}).strict();

const TestModelApprovalSchema = z.object({ approvedBy: z.string().trim().min(1) }).strict();
const TestConditionCreateSchema = z.object({ baselineId: z.string().trim().min(1), approvedTestModelVersionId: z.string().trim().min(1) }).strict();
const TestConditionApprovalSchema = z.object({ approvedBy: z.string().trim().min(1) }).strict();

const KnowledgeSearchSchema = z.object({
  projectId: z.string().trim().min(1),
  query: z.string().trim().min(2),
  limit: z.number().int().min(1).max(10).default(6),
}).strict();

const TestCaseReviewInputSchema = z.object({
  status: z.enum(["accepted", "rejected"]),
  reviewer: z.string().trim().min(1),
  reason: z.string().default(""),
  amendedTestCase: TestCaseSchema.optional(),
}).strict();

const TestCaseApprovalSchema = z.object({
  approvedBy: z.string().trim().min(1),
}).strict();

await aiQualityStore.seed({
  id: "ai-after-sales-prd-candidate-v1",
  name: "AI 售后系统 PRD 需求问题验收",
  version: "candidate-v1",
  targetName: "TestMesh AI 需求分析 Agent",
  targetVersion: "0.1.0",
  environment: "local",
  sourceAnalysisId: "e37d8907-00ee-4f31-a033-6775cccdc154",
  sourceFilename: "《AI售后系统产品方案 + PRD文档》.pdf",
  sourceSha256: "b3dd9367494d11cc39d1bfd80d1ae4c5e125814741d141442a11d648605b95e0",
  criteria: {
    minimumOpenQuestions: 8,
    requiredIssueTypes: ["missing", "ambiguity"],
    requiredTopicGroups: [["退款", "退货"], ["物流", "快递"], ["发票", "开票"], ["售后", "转人工", "人工客服"]],
    maximumAgentLatencyMs: 600_000,
    maximumTotalTokens: 300_000,
  },
  phoenix: {
    endpoint: process.env.PHOENIX_ENDPOINT ?? "http://127.0.0.1:6006",
    projectName: process.env.PHOENIX_PROJECT_NAME ?? "testmesh-requirement-analysis",
    datasetId: "RGF0YXNldDox",
    experimentId: "RXhwZXJpbWVudDo1",
    traceId: "87115e87a7c2160638b8d430ca5482aa",
  },
});

await aiQualityStore.seed({
  id: "ai-after-sales-prd-candidate-v2",
  name: "AI 售后系统 PRD 需求问题验收",
  version: "candidate-v2",
  targetName: "TestMesh AI 需求分析 Agent",
  targetVersion: "0.1.0",
  environment: "local",
  sourceAnalysisId: "e37d8907-00ee-4f31-a033-6775cccdc154",
  sourceFilename: "《AI售后系统产品方案 + PRD文档》.pdf",
  sourceSha256: "b3dd9367494d11cc39d1bfd80d1ae4c5e125814741d141442a11d648605b95e0",
  criteria: {
    minimumOpenQuestions: 8,
    requiredIssueTypes: ["missing", "ambiguity"],
    requiredTopicGroups: [["退款", "退货"], ["物流", "快递"], ["发票", "开票"], ["售后", "转人工", "人工客服"]],
    maximumAgentLatencyMs: 600_000,
    maximumTotalTokens: 300_000,
    minimumControlledRecall: 0.9,
    minimumControlledRunSuccess: 1,
    maximumOverreportingReviewRate: 0.5,
  },
  phoenix: {
    endpoint: process.env.PHOENIX_ENDPOINT ?? "http://127.0.0.1:6006",
    projectName: "Experiment-bec92a320e0f4bad27ab47ff",
    datasetId: "RGF0YXNldDox",
    experimentId: "RXhwZXJpbWVudDo1",
    traceId: "87115e87a7c2160638b8d430ca5482aa",
    controlledBenchmark: {
      datasetId: "RGF0YXNldDoy",
      datasetVersionId: "RGF0YXNldFZlcnNpb246Mg==",
      experimentId: "RXhwZXJpbWVudDo3",
      benchmarkVersion: "controlled-v0",
      dataClass: "controlled-synthetic",
      totalRuns: 20,
      successfulRuns: 19,
      detectedRuns: 19,
      overreportingReviewRuns: 12,
      averageOpenQuestions: 3.79,
      latencyP50Ms: 15_171,
      latencyP95Ms: 23_074,
      totalTokens: 182_449,
    },
  },
});

async function qualityProfileView(profile: AiQualityProfile) {
  const endpoint = profile.phoenix.endpoint.replace(/\/$/, "");
  try {
    const { document } = await requirementAnalysisStore.getAnalysis(profile.sourceAnalysisId);
    const reviews = await requirementAnalysisStore.listReviews(profile.sourceAnalysisId);
    const reviewReadiness = assessProfileReadiness(document, reviews);
    const benchmarkBlockers = assessControlledBenchmarkReadiness(profile.criteria, profile.phoenix.controlledBenchmark);
    return {
      ...profile,
      readiness: {
        ...reviewReadiness,
        ready: reviewReadiness.ready && benchmarkBlockers.length === 0,
        blockers: [...reviewReadiness.blockers, ...benchmarkBlockers],
      },
      assessment: assessQuality(document, reviews, profile.phoenix.controlledBenchmark),
      phoenixLinks: {
        home: endpoint,
        datasets: `${endpoint}/datasets`,
        projects: `${endpoint}/projects`,
      },
    };
  } catch {
    return {
      ...profile,
      readiness: {
        ready: false,
        totalOpenQuestions: 0,
        reviewedOpenQuestions: 0,
        blockers: ["关联的真实需求分析不存在，请先完成验收样本分析"],
      },
      assessment: null,
      phoenixLinks: { home: endpoint, datasets: `${endpoint}/datasets`, projects: `${endpoint}/projects` },
    };
  }
}

app.get("/api/health", (_request, response) => {
  response.json({
    ok: true,
    phase: "AT02 UI Automation",
    model: MODEL,
    schemathesisVersion: SCHEMATHESIS_VERSION,
    hurlVersion: HURL_VERSION,
    playwrightVersion: PLAYWRIGHT_VERSION,
    playwrightRunner: "local Node subprocess",
    appiumVersion: APPIUM_VERSION,
    uiautomator2Version: UIAUTOMATOR2_VERSION,
    webdriverioVersion: WDIO_VERSION,
    k6Version: K6_VERSION,
    zapVersion: ZAP_VERSION,
    openaiConfigured: Boolean(process.env.OPENAI_API_KEY),
    documentParser: "Docling Serve v1",
    testDesignHarness: "Deep Agents createDeepAgent",
    testCaseFormat: "Cucumber Gherkin 42.0.1 (zh-CN)",
    doclingServeUrl: process.env.DOCLING_SERVE_URL ?? "http://127.0.0.1:5001",
    phoenixEnabled: process.env.PHOENIX_ENABLED === "true",
    phoenixEndpoint: process.env.PHOENIX_ENDPOINT ?? "http://127.0.0.1:6006",
    knowledgeIndex: "Qdrant 1.19.2",
    knowledgeChunker: "Docling HybridChunker",
    knowledgeEmbedding: "text-embedding-3-small",
  });
});

app.get("/api/projects", async (_request, response) => {
  try {
    response.json(await projectConfigStore.listProjects());
  } catch (error) {
    response.status(500).json({ error: error instanceof Error ? error.message : "无法读取项目配置" });
  }
});

app.post("/api/projects", async (request, response) => {
  const parsed = ProjectInputSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ error: parsed.error.issues[0]?.message ?? "项目配置不合法" });
    return;
  }
  try {
    response.status(201).json(await projectConfigStore.createProject(parsed.data));
  } catch (error) {
    response.status(409).json({ error: error instanceof Error ? error.message : "无法创建项目" });
  }
});

app.put("/api/projects/:id", async (request, response) => {
  const parsed = ProjectInputSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ error: parsed.error.issues[0]?.message ?? "项目配置不合法" });
    return;
  }
  try {
    response.json(await projectConfigStore.updateProject(request.params.id, parsed.data));
  } catch (error) {
    response.status(409).json({ error: error instanceof Error ? error.message : "无法更新项目" });
  }
});

app.put("/api/projects/:id/automation-config", async (request, response) => {
  const parsed = ProjectAutomationConfigInputSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ error: parsed.error.issues[0]?.message ?? "自动化配置不合法" });
    return;
  }
  try {
    if (parsed.data.uiRepositoryPath) await inspectPlaywrightProject(parsed.data.uiRepositoryPath);
    response.json(await projectConfigStore.updateAutomationConfig(request.params.id, parsed.data));
  } catch (error) {
    response.status(409).json({ error: error instanceof Error ? error.message : "无法更新自动化配置" });
  }
});

app.post("/api/projects/:id/environments", async (request, response) => {
  const parsed = ProjectEnvironmentInputSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ error: parsed.error.issues[0]?.message ?? "环境配置不合法" });
    return;
  }
  try {
    response.status(201).json(await projectConfigStore.createEnvironment(request.params.id, parsed.data));
  } catch (error) {
    response.status(409).json({ error: error instanceof Error ? error.message : "无法创建环境" });
  }
});

app.put("/api/projects/:projectId/environments/:id", async (request, response) => {
  const parsed = ProjectEnvironmentInputSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ error: parsed.error.issues[0]?.message ?? "环境配置不合法" });
    return;
  }
  try {
    response.json(await projectConfigStore.updateEnvironment(request.params.projectId, request.params.id, parsed.data));
  } catch (error) {
    response.status(409).json({ error: error instanceof Error ? error.message : "无法更新环境" });
  }
});

app.get("/api/projects/:id/knowledge-bindings", async (request, response) => {
  try {
    response.json(await projectConfigStore.listKnowledgeBindings(request.params.id));
  } catch (error) {
    response.status(404).json({ error: error instanceof Error ? error.message : "无法读取项目知识绑定" });
  }
});

app.post("/api/projects/:id/knowledge-bindings", async (request, response) => {
  const parsed = ProjectKnowledgeBindingInputSchema.safeParse(request.body);
  if (!parsed.success) { response.status(400).json({ error: parsed.error.issues[0]?.message ?? "知识绑定参数不合法" }); return; }
  try {
    response.status(201).json(await projectConfigStore.bindKnowledge(request.params.id, parsed.data));
  } catch (error) {
    response.status(409).json({ error: error instanceof Error ? error.message : "知识绑定失败" });
  }
});

app.delete("/api/projects/:projectId/knowledge-bindings/:bindingId", async (request, response) => {
  try {
    await projectConfigStore.unbindKnowledge(request.params.projectId, request.params.bindingId);
    response.status(204).end();
  } catch (error) {
    response.status(404).json({ error: error instanceof Error ? error.message : "解除知识绑定失败" });
  }
});

app.get("/api/projects/:id/ai-contract-readiness", async (request, response) => {
  try {
    response.json(await projectContractReadinessService.inspect(request.params.id));
  } catch (error) {
    response.status(404).json({ error: error instanceof Error ? error.message : "无法检查项目 AI 契约" });
  }
});

app.get("/api/quality-management/plans", async (request, response) => {
  try {
    response.json(await qualityManagementStore.listPlans(typeof request.query.projectId === "string" ? request.query.projectId : undefined));
  } catch (error) {
    response.status(500).json({ error: error instanceof Error ? error.message : "无法读取质量计划" });
  }
});

app.post("/api/quality-management/plans", async (request, response) => {
  const parsed = QualityPlanInputSchema.safeParse(request.body);
  if (!parsed.success) { response.status(400).json({ error: parsed.error.issues[0]?.message ?? "质量计划不合法" }); return; }
  try {
    await qualityManagementService.validatePlanAssets(parsed.data);
    response.status(201).json(await qualityManagementStore.createPlan(parsed.data));
  } catch (error) {
    response.status(409).json({ error: error instanceof Error ? error.message : "无法创建质量计划" });
  }
});

app.put("/api/quality-management/plans/:id", async (request, response) => {
  const parsed = QualityPlanInputSchema.safeParse(request.body);
  if (!parsed.success) { response.status(400).json({ error: parsed.error.issues[0]?.message ?? "质量计划不合法" }); return; }
  try {
    await qualityManagementService.validatePlanAssets(parsed.data);
    response.json(await qualityManagementStore.updatePlan(request.params.id, parsed.data));
  } catch (error) {
    response.status(409).json({ error: error instanceof Error ? error.message : "无法更新质量计划" });
  }
});

app.post("/api/quality-management/plans/:id/approve", async (request, response) => {
  const parsed = QualityPlanApprovalSchema.safeParse(request.body);
  if (!parsed.success) { response.status(400).json({ error: parsed.error.issues[0]?.message ?? "批准信息不合法" }); return; }
  try {
    const plan = await qualityManagementStore.getPlan(request.params.id);
    await qualityManagementService.validatePlanAssets(plan);
    response.json(await qualityManagementStore.approvePlan(plan.id, parsed.data.approvedBy, parsed.data.note));
  } catch (error) {
    response.status(409).json({ error: error instanceof Error ? error.message : "无法批准质量计划" });
  }
});

app.get("/api/quality-management/plans/:id/snapshot", async (request, response) => {
  try {
    response.json(await qualityManagementService.snapshot(await qualityManagementStore.getPlan(request.params.id)));
  } catch (error) {
    response.status(404).json({ error: error instanceof Error ? error.message : "无法生成质量快照" });
  }
});

app.get("/api/quality-management/plans/:id/report.md", async (request, response) => {
  try {
    const plan = await qualityManagementStore.getPlan(request.params.id);
    const snapshot = await qualityManagementService.snapshot(plan);
    const report = renderQualityReport(snapshot);
    const archived = await qualityManagementStore.saveReport(plan, snapshot, report);
    response.type("text/markdown; charset=utf-8");
    response.setHeader("ETag", `"${archived.contentSha256}"`);
    response.setHeader("X-TestMesh-Report-Id", archived.id);
    response.setHeader("Content-Disposition", `attachment; filename=quality-report-${request.params.id}.md`);
    response.send(report);
  } catch (error) {
    response.status(404).json({ error: error instanceof Error ? error.message : "质量报告生成失败" });
  }
});

app.get("/api/quality-management/plans/:id/reports", async (request, response) => {
  try {
    const reports = await qualityManagementStore.listReports(request.params.id);
    response.json(reports.map((report) => ({
      id: report.id,
      planId: report.planId,
      projectId: report.projectId,
      contentSha256: report.contentSha256,
      generatedAt: report.generatedAt,
    })));
  } catch (error) {
    response.status(404).json({ error: error instanceof Error ? error.message : "质量报告记录读取失败" });
  }
});

app.get("/api/quality-management/reports/:id/report.md", async (request, response) => {
  try {
    const report = await qualityManagementStore.getReport(request.params.id);
    response.type("text/markdown; charset=utf-8");
    response.setHeader("ETag", `"${report.contentSha256}"`);
    response.setHeader("Content-Disposition", `attachment; filename=quality-report-${report.id}.md`);
    response.send(report.markdown);
  } catch (error) {
    response.status(404).json({ error: error instanceof Error ? error.message : "归档质量报告不存在" });
  }
});

app.post("/api/quality-management/plans/:id/release-gates", async (request, response) => {
  try {
    response.status(201).json(await qualityManagementService.evaluate(request.params.id));
  } catch (error) {
    response.status(409).json({ error: error instanceof Error ? error.message : "发布准入评估失败" });
  }
});

app.get("/api/quality-management/release-gates", async (request, response) => {
  const projectId = typeof request.query.projectId === "string" ? request.query.projectId : "";
  if (!projectId) { response.status(400).json({ error: "缺少 projectId" }); return; }
  try { response.json(await qualityManagementStore.listGates(projectId)); }
  catch (error) { response.status(500).json({ error: error instanceof Error ? error.message : "无法读取准入记录" }); }
});

app.post("/api/quality-management/release-gates/:id/risk-acceptance", async (request, response) => {
  const parsed = RiskAcceptanceSchema.safeParse(request.body);
  if (!parsed.success) { response.status(400).json({ error: parsed.error.issues[0]?.message ?? "风险接受信息不合法" }); return; }
  try { response.json(await qualityManagementStore.acceptGateRisk(request.params.id, parsed.data)); }
  catch (error) { response.status(409).json({ error: error instanceof Error ? error.message : "无法接受风险" }); }
});

app.get("/api/quality-management/improvements", async (request, response) => {
  const projectId = typeof request.query.projectId === "string" ? request.query.projectId : "";
  if (!projectId) { response.status(400).json({ error: "缺少 projectId" }); return; }
  try { response.json(await qualityManagementStore.listImprovements(projectId)); }
  catch (error) { response.status(500).json({ error: error instanceof Error ? error.message : "无法读取改进项" }); }
});

app.post("/api/quality-management/plans/:id/improvements", async (request, response) => {
  const parsed = ImprovementActionInputSchema.safeParse(request.body);
  if (!parsed.success) { response.status(400).json({ error: parsed.error.issues[0]?.message ?? "改进项不合法" }); return; }
  try { response.status(201).json(await qualityManagementStore.createImprovement(await qualityManagementStore.getPlan(request.params.id), parsed.data)); }
  catch (error) { response.status(409).json({ error: error instanceof Error ? error.message : "无法创建改进项" }); }
});

app.put("/api/quality-management/improvements/:id", async (request, response) => {
  const parsed = ImprovementActionUpdateSchema.safeParse(request.body);
  if (!parsed.success) { response.status(400).json({ error: parsed.error.issues[0]?.message ?? "改进项更新不合法" }); return; }
  try { response.json(await qualityManagementStore.updateImprovement(request.params.id, parsed.data)); }
  catch (error) { response.status(409).json({ error: error instanceof Error ? error.message : "无法更新改进项" }); }
});

app.get("/api/knowledge-documents", async (_request, response) => {
  try {
    response.json(await knowledgeService.list());
  } catch (error) {
    response.status(500).json({ error: error instanceof Error ? error.message : "无法读取项目知识" });
  }
});

app.post("/api/knowledge-documents", knowledgeUpload.single("file"), async (request, response) => {
  try {
    if (!request.file) throw new Error("请选择项目知识文件");
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("服务端未配置 OPENAI_API_KEY，知识向量化已停止");
    const result = await knowledgeService.ingest({
      filename: normalizeUploadFilename(request.file.originalname),
      mimeType: request.file.mimetype || "application/octet-stream",
      bytes: request.file.buffer,
      apiKey,
    });
    response.status(result.reused ? 200 : 201).json(result);
  } catch (error) {
    response.status(422).json({ error: error instanceof Error ? error.message : "项目知识入库失败" });
  }
});

app.post("/api/knowledge-search", async (request, response) => {
  try {
    const parsed = KnowledgeSearchSchema.safeParse(request.body);
    if (!parsed.success) throw new Error("请输入至少 2 个字符的知识检索问题");
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("服务端未配置 OPENAI_API_KEY，知识检索已停止");
    const documentIds = (await projectConfigStore.listKnowledgeBindings(parsed.data.projectId))
      .filter((item) => item.documentStatus === "indexed")
      .map((item) => item.documentId);
    response.json(documentIds.length > 0
      ? await knowledgeService.search(parsed.data.query, apiKey, parsed.data.limit, documentIds)
      : []);
  } catch (error) {
    response.status(422).json({ error: error instanceof Error ? error.message : "项目知识检索失败" });
  }
});

app.delete("/api/knowledge-documents/:id", async (request, response) => {
  try {
    await knowledgeService.remove(request.params.id);
    response.status(204).end();
  } catch (error) {
    response.status(404).json({ error: error instanceof Error ? error.message : "项目知识不存在" });
  }
});

app.post(
  "/api/analyze",
  upload.fields([
    { name: "attachments", maxCount: MAX_FILES },
    { name: "knowledge", maxCount: MAX_FILES },
  ]),
  async (request, response, next) => {
    try {
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) {
        response.status(503).json({ error: "服务端未配置 OPENAI_API_KEY，分析已停止" });
        return;
      }

      const files = (request.files ?? {}) as Record<string, Express.Multer.File[]>;
      const attachments = files.attachments ?? [];
      const knowledge = files.knowledge ?? [];
      if (attachments.length + knowledge.length > MAX_FILES) {
        response.status(400).json({ error: `单次最多上传 ${MAX_FILES} 个文件` });
        return;
      }

      const uploadedSources = createSources(attachments, knowledge);
      const sources = await parseAnalysisSources(uploadedSources, documentParser);
      const analysis = await requirementAnalysisService.start({
        message: REQUIREMENT_ANALYSIS_TASK,
        sources,
        apiKey,
      });
      response.json({
        ...analysis,
        model: MODEL,
        sources: sources.map((source) => ({
          id: source.id,
          name: source.name,
          mimeType: source.mimeType,
          scope: source.scope,
          capability: source.capability,
          capabilityNote: source.capabilityNote,
        })),
      });
    } catch (error) {
      next(error);
    }
  },
);

app.get("/api/ai-quality/profiles", async (_request, response) => {
  try {
    const profiles = await aiQualityStore.list();
    response.json(await Promise.all(profiles.map(qualityProfileView)));
  } catch (error) {
    response.status(500).json({ error: error instanceof Error ? error.message : "无法读取 AI 质量评测配置" });
  }
});

app.post("/api/ai-quality/profiles/:id/approve", async (request, response) => {
  try {
    const parsed = AiQualityApprovalSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: "请填写批准人" });
      return;
    }
    const profile = await aiQualityStore.get(request.params.id);
    const view = await qualityProfileView(profile);
    if (!view.readiness.ready) {
      response.status(409).json({ error: view.readiness.blockers.join("；") });
      return;
    }
    response.json(await qualityProfileView(await aiQualityStore.approve(
      request.params.id,
      parsed.data.approvedBy,
      parsed.data.approvalNote,
    )));
  } catch (error) {
    response.status(409).json({ error: error instanceof Error ? error.message : "无法批准 AI 质量评测配置" });
  }
});

app.get("/api/ai-quality/dataset-exports", async (_request, response) => {
  try {
    response.json(await aiDatasetExportService.list());
  } catch (error) {
    response.status(500).json({ error: error instanceof Error ? error.message : "无法读取 Phoenix Dataset 映射" });
  }
});

app.get("/api/ai-quality/dataset-exports/preview/:approvedVersionId", async (request, response) => {
  try {
    response.json(await aiDatasetExportService.preview(request.params.approvedVersionId));
  } catch (error) {
    response.status(404).json({ error: error instanceof Error ? error.message : "无法生成 Dataset 预览" });
  }
});

app.post("/api/ai-quality/dataset-exports", async (request, response) => {
  const parsed = AiDatasetExportInputSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ error: parsed.error.issues[0]?.message ?? "Dataset 导出参数不合法" });
    return;
  }
  try {
    response.status(201).json(await aiDatasetExportService.export(
      parsed.data.approvedTestCaseVersionId,
      parsed.data.exportedBy,
    ));
  } catch (error) {
    response.status(502).json({ error: error instanceof Error ? error.message : "Phoenix Dataset 导出失败" });
  }
});

app.get("/api/ai-quality/evaluation-sample-sets", async (request, response) => {
  try {
    const approvedVersionId = typeof request.query.approvedVersionId === "string" ? request.query.approvedVersionId : undefined;
    response.json(await evaluationSampleService.list(approvedVersionId));
  } catch (error) {
    response.status(500).json({ error: error instanceof Error ? error.message : "无法读取 AI 评测样本集" });
  }
});

app.get("/api/ai-quality/dataset-specifications/:approvedVersionId", async (request, response) => {
  try {
    response.json(await evaluationSampleService.specification(request.params.approvedVersionId));
  } catch (error) {
    response.status(404).json({ error: error instanceof Error ? error.message : "无法读取 Dataset 设计" });
  }
});

app.post("/api/ai-quality/evaluation-sample-sets", async (request, response) => {
  const parsed = EvaluationSampleSetInputSchema.safeParse(request.body);
  if (!parsed.success) { response.status(400).json({ error: parsed.error.issues[0]?.message }); return; }
  try {
    response.status(201).json(await evaluationSampleService.create(parsed.data));
  } catch (error) {
    response.status(409).json({ error: error instanceof Error ? error.message : "无法创建 AI 评测样本集" });
  }
});

app.get("/api/ai-quality/evaluation-sample-sets/:id/readiness", async (request, response) => {
  try {
    response.json(await evaluationSampleService.readiness(request.params.id));
  } catch (error) {
    response.status(404).json({ error: error instanceof Error ? error.message : "无法检查样本集准备度" });
  }
});

app.post("/api/ai-quality/evaluation-sample-sets/:id/samples", async (request, response) => {
  const parsed = EvaluationSamplePayloadSchema.safeParse(request.body);
  if (!parsed.success) { response.status(400).json({ error: parsed.error.issues[0]?.message }); return; }
  try {
    response.status(201).json(await evaluationSampleService.saveSample(request.params.id, parsed.data));
  } catch (error) {
    response.status(409).json({ error: error instanceof Error ? error.message : "无法保存 AI 评测样本" });
  }
});

app.put("/api/ai-quality/evaluation-sample-sets/:id/samples/:sampleId", async (request, response) => {
  const parsed = EvaluationSamplePayloadSchema.safeParse(request.body);
  if (!parsed.success) { response.status(400).json({ error: parsed.error.issues[0]?.message }); return; }
  try {
    response.json(await evaluationSampleService.saveSample(request.params.id, parsed.data, request.params.sampleId));
  } catch (error) {
    response.status(409).json({ error: error instanceof Error ? error.message : "无法修正 AI 评测样本" });
  }
});

app.post("/api/ai-quality/evaluation-sample-sets/:id/samples/:sampleId/review", async (request, response) => {
  const parsed = EvaluationSampleReviewSchema.safeParse(request.body);
  if (!parsed.success) { response.status(400).json({ error: parsed.error.issues[0]?.message }); return; }
  try {
    response.json(await evaluationSampleService.reviewSample(request.params.id, request.params.sampleId, parsed.data));
  } catch (error) {
    response.status(409).json({ error: error instanceof Error ? error.message : "无法评审 AI 评测样本" });
  }
});

app.post("/api/ai-quality/evaluation-sample-sets/:id/freeze", async (request, response) => {
  const parsed = EvaluationSampleFreezeSchema.safeParse(request.body);
  if (!parsed.success) { response.status(400).json({ error: parsed.error.issues[0]?.message }); return; }
  try {
    response.json(await evaluationSampleService.freeze(request.params.id, parsed.data.frozenBy));
  } catch (error) {
    response.status(409).json({ error: error instanceof Error ? error.message : "样本集未达到冻结条件" });
  }
});

app.post("/api/ai-quality/evaluation-sample-sets/:id/export", async (request, response) => {
  const parsed = EvaluationDatasetExportSchema.safeParse(request.body);
  if (!parsed.success) { response.status(400).json({ error: parsed.error.issues[0]?.message }); return; }
  try {
    response.status(201).json(await evaluationSampleService.export(request.params.id, parsed.data.exportedBy));
  } catch (error) {
    response.status(409).json({ error: error instanceof Error ? error.message : "评测数据集同步失败" });
  }
});

app.get("/api/ai-quality/evaluator-calibrations", async (_request, response) => {
  try {
    response.json(await evaluatorCalibrationService.list());
  } catch (error) {
    response.status(500).json({ error: error instanceof Error ? error.message : "无法读取 Evaluator 校准记录" });
  }
});

app.post("/api/ai-quality/evaluator-calibrations", async (request, response) => {
  const parsed = EvaluatorCalibrationInputSchema.safeParse(request.body);
  if (!parsed.success) { response.status(400).json({ error: parsed.error.issues[0]?.message }); return; }
  try {
    response.status(201).json(await evaluatorCalibrationService.calibrate(parsed.data));
  } catch (error) {
    response.status(409).json({ error: error instanceof Error ? error.message : "Evaluator 校准失败" });
  }
});

app.get("/api/ai-quality/experiments/readiness/:datasetExportId", async (request, response) => {
  try {
    response.json(await aiExperimentReadinessService.inspect(request.params.datasetExportId));
  } catch (error) {
    response.status(404).json({ error: error instanceof Error ? error.message : "无法检查 AI Experiment 执行准备度" });
  }
});

app.get("/api/ai-quality/experiments", async (_request, response) => {
  try {
    response.json(await aiExperimentRunService.list());
  } catch (error) {
    response.status(500).json({ error: error instanceof Error ? error.message : "无法读取 Phoenix Experiment 映射" });
  }
});

app.post("/api/ai-quality/experiments", async (request, response) => {
  const parsed = AiExperimentRunInputSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ error: parsed.error.issues[0]?.message ?? "Experiment 参数不合法" });
    return;
  }
  try {
    response.status(201).json(await aiExperimentRunService.run(parsed.data));
  } catch (error) {
    response.status(409).json({ error: error instanceof Error ? error.message : "Phoenix Experiment 启动失败" });
  }
});

app.get("/api/analyses", (_request, response) => {
  void requirementAnalysisStore.listAnalyses()
    .then(async (records) => response.json(await Promise.all(records.map(async (record) => {
      const [{ document }, reviews, traceUrl] = await Promise.all([
        requirementAnalysisStore.getAnalysis(record.id),
        requirementAnalysisStore.listReviews(record.id),
        record.traceProvider === "phoenix" && record.traceId ? resolvePhoenixTraceUrl({
          provider: "phoenix",
          projectName: record.traceProjectName,
          traceId: record.traceId,
        }) : Promise.resolve(""),
      ]);
      const sections = [
        document.requirements, document.actors, document.business_rules, document.flows,
        document.states, document.constraints, document.exceptions, document.open_questions,
      ];
      const itemIds = [
        ...(document.summary ? [document.summary.id] : []),
        ...sections.flatMap((items) => items.map((item) => item.id)),
      ];
      const latest = new Map(reviews.map((review) => [review.itemId, review]));
      return {
        ...record,
        protocol: "current",
        traceUrl,
        reviewSummary: {
          total: itemIds.length,
          pending: itemIds.filter((id) => !latest.has(id) || latest.get(id)?.status === "clarify").length,
          accepted: itemIds.filter((id) => latest.get(id)?.status === "accepted").length,
          rejected: itemIds.filter((id) => latest.get(id)?.status === "rejected").length,
          merged: itemIds.filter((id) => latest.get(id)?.status === "merged").length,
        },
      };
    }))))
    .catch((error) => response.status(500).json({ error: error instanceof Error ? error.message : "无法读取分析列表" }));
});

app.get("/api/analyses/:id", async (request, response) => {
  try {
    const { document } = await requirementAnalysisStore.getAnalysis(request.params.id);
    response.json(document);
  } catch (error) {
    const message = error instanceof Error ? error.message : "分析结果不存在";
    response.status(404).json({ error: message });
  }
});

app.get("/api/analyses/:id/reviews", async (request, response) => {
  try {
    response.json(await requirementAnalysisStore.listReviews(request.params.id));
  } catch (error) {
    response.status(404).json({ error: error instanceof Error ? error.message : "分析结果不存在" });
  }
});

app.get("/api/analyses/:id/reviews/:itemId/history", async (request, response) => {
  try {
    response.json(await requirementAnalysisStore.listReviewHistory(request.params.id, request.params.itemId));
  } catch (error) {
    response.status(404).json({ error: error instanceof Error ? error.message : "评审历史不存在" });
  }
});

app.get("/api/analyses/:id/amendments", async (request, response) => {
  try {
    response.json(await requirementAnalysisStore.listAmendments(
      request.params.id,
      typeof request.query.itemId === "string" ? request.query.itemId : undefined,
    ));
  } catch (error) {
    response.status(404).json({ error: error instanceof Error ? error.message : "人工修正记录不存在" });
  }
});

app.get("/api/analyses/:id/source-files", async (request, response) => {
  try {
    response.json(await requirementAnalysisStore.listSourceFiles(request.params.id));
  } catch (error) {
    response.status(404).json({ error: error instanceof Error ? error.message : "原文件目录不存在" });
  }
});

app.get("/api/analyses/:id/source-files/:sourceFileId", async (request, response) => {
  try {
    const source = await requirementAnalysisStore.getSourceFile(request.params.id, request.params.sourceFileId);
    response.type(source.mimeType);
    response.setHeader("Content-Disposition", source.mimeType === "application/pdf" || source.mimeType.startsWith("image/") ? "inline" : "attachment");
    response.send(source.file);
  } catch (error) {
    response.status(404).json({ error: error instanceof Error ? error.message : "原始来源文件不存在" });
  }
});

app.put("/api/analyses/:id/reviews/:itemId", async (request, response) => {
  try {
    const parsed = AnalysisReviewInputSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: "评审信息不完整或格式不正确" });
      return;
    }
    response.json(await requirementAnalysisStore.recordReview(request.params.id, request.params.itemId, parsed.data));
  } catch (error) {
    response.status(400).json({ error: error instanceof Error ? error.message : "评审记录无效" });
  }
});

app.get("/api/requirement-baselines", (_request, response) => {
  void requirementAnalysisStore.listBaselines()
    .then((records) => response.json(records))
    .catch((error) => response.status(500).json({ error: error instanceof Error ? error.message : "无法读取需求基线" }));
});

app.post("/api/analyses/:id/baselines", baselineUpload.single("reviewedPrd"), async (request, response) => {
  try {
    const file = request.file;
    if (!file) throw new Error("请上传评审后的 PRD 文件");
    const record = await requirementAnalysisService.createBaselineAndResume(String(request.params.id), {
      prdRevision: String(request.body.prdRevision ?? ""),
      approvedBy: String(request.body.approvedBy ?? ""),
      previousBaselineId: request.body.previousBaselineId ? String(request.body.previousBaselineId) : null,
      prdFilename: normalizeUploadFilename(file.originalname),
      prdFile: file.buffer,
    });
    response.status(201).json(record);
  } catch (error) {
    response.status(409).json({ error: error instanceof Error ? error.message : "无法建立需求基线" });
  }
});

app.get("/api/requirement-baselines/:id", async (request, response) => {
  try {
    const { record, snapshot } = await requirementAnalysisStore.getBaseline(request.params.id);
    response.json({ ...record, snapshot });
  } catch (error) {
    response.status(404).json({ error: error instanceof Error ? error.message : "需求基线不存在" });
  }
});

app.get("/api/requirement-baselines/:id/prd", async (request, response) => {
  try {
    const { record, file } = await requirementAnalysisStore.getBaseline(request.params.id);
    response.attachment(record.prdFilename);
    response.send(file);
  } catch (error) {
    response.status(404).json({ error: error instanceof Error ? error.message : "需求基线不存在" });
  }
});

app.get("/api/test-models", async (request, response) => {
  try {
    response.json(await testModelStore.list(typeof request.query.baselineId === "string" ? request.query.baselineId : undefined));
  } catch (error) {
    response.status(500).json({ error: error instanceof Error ? error.message : "无法读取测试模型" });
  }
});

app.get("/api/test-models/approved-versions", async (request, response) => {
  try {
    response.json(await testModelStore.listApprovedVersions(typeof request.query.baselineId === "string" ? request.query.baselineId : undefined));
  } catch (error) {
    response.status(500).json({ error: error instanceof Error ? error.message : "无法读取 Approved Test Model" });
  }
});

app.post("/api/test-models", async (request, response) => {
  try {
    const parsed = TestModelRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: "请选择已建立的需求基线" });
      return;
    }
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      response.status(503).json({ error: "服务端未配置 OPENAI_API_KEY，测试建模已停止" });
      return;
    }
    response.status(201).json(await testModelService.generate({ ...parsed.data, apiKey }));
  } catch (error) {
    response.status(422).json({ error: error instanceof Error ? error.message : "测试建模失败" });
  }
});

app.post("/api/test-models/simulation-reference", async (request, response) => {
  try {
    const parsed = TestModelRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: "请选择智能导购模拟需求基线" });
      return;
    }
    response.status(201).json(await testModelService.createSimulationReference(parsed.data));
  } catch (error) {
    response.status(422).json({ error: error instanceof Error ? error.message : "无法加载模拟参考模型" });
  }
});

app.get("/api/test-models/simulation-reference-readiness", async (request, response) => {
  const baselineId = typeof request.query.baselineId === "string" ? request.query.baselineId.trim() : "";
  if (!baselineId) { response.status(400).json({ error: "请选择需求基线" }); return; }
  try {
    response.json(await testModelService.inspectSimulationReference(baselineId));
  } catch (error) {
    response.status(422).json({ error: error instanceof Error ? error.message : "无法检查模拟参考模型就绪状态" });
  }
});

app.get("/api/test-models/:id", async (request, response) => {
  try {
    response.json(await testModelStore.get(request.params.id));
  } catch (error) {
    response.status(404).json({ error: error instanceof Error ? error.message : "测试模型不存在" });
  }
});

app.put("/api/test-models/:id", async (request, response) => {
  try {
    const parsed = TestModelAmendmentSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: parsed.error.issues.map((item) => item.message).join("；") });
      return;
    }
    response.json(await testModelStore.amend(request.params.id, parsed.data));
  } catch (error) {
    response.status(409).json({ error: error instanceof Error ? error.message : "测试模型修正失败" });
  }
});

app.post("/api/test-models/:id/approve", async (request, response) => {
  try {
    const parsed = TestModelApprovalSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: "请填写测试模型批准人" });
      return;
    }
    response.status(201).json(await testModelStore.approve(request.params.id, parsed.data.approvedBy));
  } catch (error) {
    response.status(409).json({ error: error instanceof Error ? error.message : "测试模型批准失败" });
  }
});

app.get("/api/test-design/prompt-registry", (_request, response) => {
  response.json({ schemaVersions: ASSET_SCHEMA_VERSIONS, promptVersions: PROMPT_VERSIONS, stages: TEST_DESIGN_PROMPT_REGISTRY });
});

app.get("/api/test-conditions", async (request, response) => {
  try {
    response.json(await testConditionStore.list(typeof request.query.baselineId === "string" ? request.query.baselineId : undefined));
  } catch (error) {
    response.status(500).json({ error: error instanceof Error ? error.message : "无法读取测试条件" });
  }
});

app.get("/api/test-conditions/approved-versions", async (request, response) => {
  try {
    response.json(await testConditionStore.listApprovedVersions(typeof request.query.baselineId === "string" ? request.query.baselineId : undefined));
  } catch (error) {
    response.status(500).json({ error: error instanceof Error ? error.message : "无法读取 Approved TestCondition" });
  }
});

app.post("/api/test-conditions", async (request, response) => {
  try {
    const parsed = TestConditionCreateSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: "请选择需求基线和 Approved Test Model" });
      return;
    }
    const approvedModel = await testModelStore.getApprovedVersion(parsed.data.approvedTestModelVersionId);
    if (approvedModel.record.baselineId !== parsed.data.baselineId) throw new Error("Approved Test Model 与需求基线不一致");
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      response.status(503).json({ error: "服务端未配置 OPENAI_API_KEY，测试条件生成已停止" });
      return;
    }
    const baselineResult = await requirementAnalysisStore.getBaseline(parsed.data.baselineId);
    const baseline = BaselineSnapshotSchema.parse(baselineResult.snapshot);
    const generated = await runTestConditionAgent({
      baselineId: parsed.data.baselineId,
      baseline,
      approvedModel: approvedModel.snapshot,
      model: createOpenAITestDesignModel(apiKey),
    });
    const record = await testConditionStore.create({
      ...parsed.data,
      document: TestConditionSetDocumentSchema.parse({
        schemaVersion: ASSET_SCHEMA_VERSIONS.testCondition,
        baselineId: parsed.data.baselineId,
        approvedTestModelVersionId: parsed.data.approvedTestModelVersionId,
        objective: approvedModel.snapshot.test_analysis.objective,
        conditions: generated.conditions,
        generation: {
          mode: "prompt",
          promptVersion: PROMPT_VERSIONS.testCondition,
          note: "由独立 TestCondition Prompt 从 Approved TestModel 生成，并通过结构、追溯与覆盖校验。",
        },
      }),
    });
    response.status(201).json(record);
  } catch (error) {
    response.status(422).json({ error: error instanceof Error ? error.message : "测试条件建立失败" });
  }
});

app.post("/api/test-conditions/:id/approve", async (request, response) => {
  try {
    const parsed = TestConditionApprovalSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: "请填写测试条件批准人" });
      return;
    }
    response.status(201).json(await testConditionStore.approve(request.params.id, parsed.data.approvedBy));
  } catch (error) {
    response.status(409).json({ error: error instanceof Error ? error.message : "测试条件批准失败" });
  }
});

app.get("/api/test-designs", async (_request, response) => {
  try {
    const designs = await testDesignStore.listDesigns();
    response.json(await Promise.all(designs.map(async (design) => {
      const [reviews, approved, traceUrl] = await Promise.all([
        testDesignStore.listReviews(design.id),
        testDesignStore.getApprovedVersion(design.id),
        design.traceProvider === "phoenix" && design.traceId
          ? resolvePhoenixTraceUrl({ provider: "phoenix", projectName: design.traceProjectName, traceId: design.traceId })
          : Promise.resolve(""),
      ]);
      const accepted = reviews.filter((item) => item.status === "accepted").length;
      const rejected = reviews.filter((item) => item.status === "rejected").length;
      return {
        ...design,
        traceUrl,
        reviewSummary: {
          total: design.document.test_cases.length,
          pending: design.document.test_cases.length - reviews.length,
          accepted,
          rejected,
        },
        approvedVersion: approved?.record ?? null,
      };
    })));
  } catch (error) {
    response.status(500).json({ error: error instanceof Error ? error.message : "无法读取测试设计" });
  }
});

app.post("/api/test-designs", async (request, response) => {
  try {
    const parsed = TestDesignRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: "请选择需求基线和 Approved Test Model" });
      return;
    }
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      response.status(503).json({ error: "服务端未配置 OPENAI_API_KEY，测试设计已停止" });
      return;
    }
    const result = await testDesignService.generate({ baselineId: parsed.data.baselineId, approvedTestModelVersionId: parsed.data.approvedTestModelVersionId, approvedTestConditionVersionId: parsed.data.approvedTestConditionVersionId, regenerate: parsed.data.regenerate, apiKey });
    response.status(result.reused ? 200 : 201).json(result);
  } catch (error) {
    response.status(422).json({ error: error instanceof Error ? error.message : "测试设计生成失败" });
  }
});

app.get("/api/test-designs/:id", async (request, response) => {
  try {
    const design = await testDesignStore.getDesign(request.params.id);
    const [reviews, amendments, approved, baseline] = await Promise.all([
      testDesignStore.listReviews(design.id),
      testDesignStore.listAmendments(design.id),
      testDesignStore.getApprovedVersion(design.id),
      requirementAnalysisStore.getBaseline(design.baselineId),
    ]);
    response.json({ ...design, reviews, amendments, approvedVersion: approved?.record ?? null, baselineSources: BaselineSnapshotSchema.parse(baseline.snapshot).sourceRefs });
  } catch (error) {
    response.status(404).json({ error: error instanceof Error ? error.message : "测试设计不存在" });
  }
});

app.put("/api/test-designs/:id/reviews/:testCaseId", async (request, response) => {
  try {
    const parsed = TestCaseReviewInputSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: "请填写评审人并选择处理结果" });
      return;
    }
    response.json(await testDesignStore.recordReview(request.params.id, request.params.testCaseId, parsed.data));
  } catch (error) {
    response.status(409).json({ error: error instanceof Error ? error.message : "TestCase 评审失败" });
  }
});

app.post("/api/test-designs/:id/approve", async (request, response) => {
  try {
    const parsed = TestCaseApprovalSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: "请填写批准人" });
      return;
    }
    response.status(201).json(await testDesignStore.approve(request.params.id, parsed.data.approvedBy));
  } catch (error) {
    response.status(409).json({ error: error instanceof Error ? error.message : "无法批准 TestCase 版本" });
  }
});

app.get("/api/api-automation/approved-versions", async (_request, response) => {
  try {
    const versions = await testDesignStore.listApprovedVersions();
    response.json(versions.map(({ record, snapshot }) => ({ ...record, testCases: snapshot.test_cases })));
  } catch (error) {
    response.status(500).json({ error: error instanceof Error ? error.message : "无法读取 Approved TestCase 版本" });
  }
});

app.get("/api/api-automation/openapi", (_request, response) => {
  response.json(store.listOpenApiSpecs());
});

app.get("/api/api-automation/test-runs", (_request, response) => {
  response.json(store.listTestRuns());
});

app.post("/api/api-automation/openapi", openApiUpload.single("spec"), async (request, response) => {
  try {
    if (!request.file) {
      response.status(400).json({ error: "请选择 OpenAPI JSON/YAML 文件" });
      return;
    }
    const approvedVersionId = typeof request.body.approvedVersionId === "string" ? request.body.approvedVersionId.trim() : "";
    const projectId = typeof request.body.projectId === "string" ? request.body.projectId.trim() : "";
    const environmentId = typeof request.body.environmentId === "string" ? request.body.environmentId.trim() : "";
    if (!approvedVersionId) {
      response.status(400).json({ error: "请选择 Approved TestCase 版本" });
      return;
    }
    if (!projectId || !environmentId) {
      response.status(400).json({ error: "请选择项目和测试环境" });
      return;
    }
    await projectConfigStore.getEnvironment(projectId, environmentId);
    await testDesignStore.getApprovedVersionById(approvedVersionId);
    const filename = normalizeUploadFilename(request.file.originalname);
    const content = request.file.buffer.toString("utf8");
    const parsed = parseOpenApi(content);
    response.json(
      store.createOpenApiSpec({
        approvedVersionId,
        projectId,
        environmentId,
        name: parsed.name,
        version: parsed.version,
        filename,
        content,
        operations: parsed.operations,
      }),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "OpenAPI 导入失败";
    response.status(400).json({ error: message });
  }
});

app.put("/api/api-automation/operations/:id/links", async (request, response) => {
  try {
    const approvedTestCaseIds: string[] = Array.isArray(request.body.approvedTestCaseIds)
      ? request.body.approvedTestCaseIds.filter((item: unknown): item is string => typeof item === "string")
      : [];
    const approvedVersionId = store.getApprovedVersionIdForOperation(request.params.id);
    const approved = await testDesignStore.getApprovedVersionById(approvedVersionId);
    const allowed = new Set(approved.snapshot.test_cases.map((item) => item.id));
    const invalid = approvedTestCaseIds.filter((id: string) => !allowed.has(id));
    if (invalid.length) throw new Error(`以下 TestCase 不属于所选 Approved 版本：${invalid.join("、")}`);
    store.updateApprovedTestCaseLinks(request.params.id, approvedTestCaseIds);
    response.status(204).end();
  } catch (error) {
    const message = error instanceof Error ? error.message : "追溯关系保存失败";
    response.status(400).json({ error: message });
  }
});

app.get("/api/api-automation/scenario-suites", (_request, response) => {
  response.json(store.listApiScenarioSuites());
});

app.post("/api/api-automation/scenario-suites/validate", (request, response) => {
  try {
    const yamlContent = typeof request.body.yamlContent === "string" ? request.body.yamlContent : "";
    const compiled = compileApiYamlScenario(yamlContent);
    response.json({ name: compiled.name, stepCount: compiled.stepCount, hurlContent: compiled.hurlContent });
  } catch (error) {
    response.status(400).json({ error: error instanceof Error ? error.message : "YAML 场景校验失败" });
  }
});

app.post("/api/api-automation/scenario-suites", async (request, response) => {
  try {
    const projectId = typeof request.body.projectId === "string" ? request.body.projectId.trim() : "";
    const environmentId = typeof request.body.environmentId === "string" ? request.body.environmentId.trim() : "";
    const approvedVersionId = typeof request.body.approvedVersionId === "string" ? request.body.approvedVersionId.trim() : "";
    if (!projectId || !environmentId) throw new Error("请选择项目和测试环境");
    if (!approvedVersionId) throw new Error("请选择 Approved TestCase 版本");
    const approvedTestCaseIds: string[] = Array.isArray(request.body.approvedTestCaseIds)
      ? request.body.approvedTestCaseIds.filter((item: unknown): item is string => typeof item === "string")
      : [];
    if (approvedTestCaseIds.length === 0) throw new Error("至少关联一条 Approved TestCase");
    await projectConfigStore.getEnvironment(projectId, environmentId);
    const approved = await testDesignStore.getApprovedVersionById(approvedVersionId);
    const allowed = new Set(approved.snapshot.test_cases.map((item) => item.id));
    const invalid = approvedTestCaseIds.filter((id) => !allowed.has(id));
    if (invalid.length > 0) throw new Error(`以下 TestCase 不属于所选 Approved 版本：${invalid.join("、")}`);
    const yamlContent = typeof request.body.yamlContent === "string" ? request.body.yamlContent : "";
    const compiled = compileApiYamlScenario(yamlContent);
    const filenameBase = compiled.name.replace(/[^\p{L}\p{N}_-]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "api-scenario";
    response.status(201).json(store.createApiScenarioSuite({
      projectId,
      environmentId,
      approvedVersionId,
      filename: `${filenameBase}.hurl`,
      content: compiled.hurlContent,
      sourceFormat: API_YAML_FORMAT,
      sourceContent: compiled.yamlContent,
      approvedTestCaseIds,
    }));
  } catch (error) {
    response.status(400).json({ error: error instanceof Error ? error.message : "YAML 场景保存失败" });
  }
});

app.get("/api/api-automation/scenario-runs", (_request, response) => {
  response.json(store.listApiScenarioRuns());
});

app.get("/api/api-automation/scenario-runs/:id", (request, response) => {
  try {
    response.json(store.getApiScenarioRun(request.params.id));
  } catch (error) {
    response.status(404).json({ error: error instanceof Error ? error.message : "Hurl TestRun 不存在" });
  }
});

app.post("/api/api-automation/scenario-runs", async (request, response) => {
  try {
    const suiteId = typeof request.body.suiteId === "string" ? request.body.suiteId : "";
    const suite = store.getApiScenarioSuite(suiteId);
    const environment = await projectConfigStore.getEnvironment(suite.projectId, suite.environmentId);
    const targetBaseUrl = validateTargetBaseUrl(environment.baseUrl);
    const headers = parseHeaderLines(environment.headers);
    const rawAuth = request.body.auth;
    const auth: RunnerAuth = rawAuth && typeof rawAuth === "object"
      ? {
          type: rawAuth.type === "bearer" || rawAuth.type === "basic" ? rawAuth.type : "none",
          token: typeof rawAuth.token === "string" ? rawAuth.token : undefined,
          username: typeof rawAuth.username === "string" ? rawAuth.username : undefined,
          password: typeof rawAuth.password === "string" ? rawAuth.password : undefined,
        }
      : { type: "none" };
    const run = await runHurlScenario({ suiteId, targetBaseUrl, headers, variables: environment.variables, auth }, store);
    response.status(run.status === "error" ? 502 : 200).json(run);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Hurl 运行失败";
    response.status(502).json({ error: `Hurl 运行失败，流程已停止：${message}` });
  }
});

app.post("/api/api-automation/test-runs", async (request, response) => {
  try {
    const specId = typeof request.body.specId === "string" ? request.body.specId : "";
    const spec = store.getOpenApiSpec(specId);
    if (!spec.projectId || !spec.environmentId) throw new Error("历史 OpenAPI 未绑定项目环境，请重新导入");
    const environment = await projectConfigStore.getEnvironment(spec.projectId, spec.environmentId);
    const targetBaseUrl = validateTargetBaseUrl(environment.baseUrl);
    const headers = parseHeaderLines(environment.headers);
    const rawAuth = request.body.auth;
    const auth: RunnerAuth =
      rawAuth && typeof rawAuth === "object"
        ? {
            type:
              rawAuth.type === "bearer" || rawAuth.type === "basic" ? rawAuth.type : "none",
            token: typeof rawAuth.token === "string" ? rawAuth.token : undefined,
            username: typeof rawAuth.username === "string" ? rawAuth.username : undefined,
            password: typeof rawAuth.password === "string" ? rawAuth.password : undefined,
          }
        : { type: "none" };
    const run = await runSchemathesis({ specId, targetBaseUrl, headers, auth }, store);
    response.status(run.status === "error" ? 502 : 200).json(run);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Schemathesis 运行失败";
    response.status(502).json({ error: `Schemathesis 运行失败，流程已停止：${message}` });
  }
});

app.post("/api/p03/repository/inspect", async (request, response) => {
  try {
    const repoPath = typeof request.body.repoPath === "string" ? request.body.repoPath : "";
    response.json(await inspectRepository(repoPath));
  } catch (error) {
    const message = error instanceof Error ? error.message : "仓库检查失败";
    response.status(400).json({ error: message });
  }
});

app.get("/api/ui-automation/runs", (_request, response) => {
  response.json(store.listUiTestRuns());
});

app.post("/api/ui-automation/repository", async (request, response) => {
  try {
    const repoPath = typeof request.body.repoPath === "string" ? request.body.repoPath : "";
    response.json(await inspectPlaywrightProject(repoPath));
  } catch (error) {
    response.status(400).json({ error: error instanceof Error ? error.message : "Playwright 仓库检查失败" });
  }
});

app.get("/api/ui-automation/runs/:id", (request, response) => {
  try {
    response.json(store.getUiTestRun(request.params.id));
  } catch (error) {
    response.status(404).json({ error: error instanceof Error ? error.message : "UI TestRun 不存在" });
  }
});

app.post("/api/ui-automation/runs", async (request, response) => {
  try {
    const projectId = typeof request.body.projectId === "string" ? request.body.projectId : "";
    const environmentId = typeof request.body.environmentId === "string" ? request.body.environmentId : "";
    const approvedVersionId = typeof request.body.approvedVersionId === "string" ? request.body.approvedVersionId : "";
    const approvedTestCaseIds = Array.isArray(request.body.approvedTestCaseIds)
      ? request.body.approvedTestCaseIds.filter((item: unknown): item is string => typeof item === "string")
      : [];
    const environment = await projectConfigStore.getEnvironment(projectId, environmentId);
    const approved = await testDesignStore.getApprovedVersionById(approvedVersionId);
    const validIds = new Set<string>(approved.snapshot.test_cases.map((item) => item.id));
    if (approvedTestCaseIds.some((id: string) => !validIds.has(id))) throw new Error("关联用例不属于所选 Approved TestCase 版本");
    const run = await runPlaywrightTest(
      {
        repoPath: typeof request.body.repoPath === "string" ? request.body.repoPath : "",
        testFile: typeof request.body.testFile === "string" ? request.body.testFile : "",
        targetBaseUrl: environment.baseUrl,
        projectId,
        environmentId,
        approvedVersionId,
        approvedTestCaseIds,
        authorized: request.body.authorized === true,
      },
      store,
    );
    response.json(run);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Playwright UI 测试未启动";
    response.status(400).json({ error: `Playwright UI 测试未启动：${message}` });
  }
});

app.get("/api/ui-automation/runs/:id/artifacts/:artifactId", (request, response) => {
  try {
    const artifact = store.getUiTestArtifact(request.params.id, request.params.artifactId);
    response.download(artifact.path, artifact.name);
  } catch (error) {
    response.status(404).json({ error: error instanceof Error ? error.message : "Trace Evidence 不存在" });
  }
});

app.get("/api/failure-triage/runs", async (_request, response) => {
  try {
    response.json(await failureTriageService.listFailureRuns());
  } catch (error) {
    response.status(500).json({ error: error instanceof Error ? error.message : "无法读取失败 TestRun" });
  }
});

app.get("/api/failure-triages", async (_request, response) => {
  try {
    response.json(await failureTriageStore.list());
  } catch (error) {
    response.status(500).json({ error: error instanceof Error ? error.message : "无法读取缺陷定位记录" });
  }
});

app.get("/api/failure-triages/:id", async (request, response) => {
  try {
    response.json(await failureTriageStore.get(request.params.id));
  } catch (error) {
    response.status(404).json({ error: error instanceof Error ? error.message : "缺陷定位记录不存在" });
  }
});

app.post("/api/failure-triages", async (request, response) => {
  try {
    const parsed = FailureDiagnosisRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: parsed.error.issues[0]?.message ?? "缺陷定位输入不合法" });
      return;
    }
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      response.status(503).json({ error: "服务端未配置 OPENAI_API_KEY，缺陷定位已停止" });
      return;
    }
    response.status(201).json(await failureTriageService.analyze({ request: parsed.data, apiKey }));
  } catch (error) {
    response.status(422).json({ error: error instanceof Error ? error.message : "缺陷定位失败" });
  }
});

app.get("/api/p04/android-runs", (_request, response) => {
  response.json(store.listAndroidTestRuns());
});

app.get("/api/p04/android-runs/:id", (request, response) => {
  try {
    response.json(store.getAndroidTestRun(request.params.id));
  } catch (error) {
    response.status(404).json({ error: error instanceof Error ? error.message : "Android TestRun 不存在" });
  }
});

app.post("/api/p04/android-runs", async (request, response) => {
  try {
    const run = await runAndroidTest(
      {
        repoPath: typeof request.body.repoPath === "string" ? request.body.repoPath : "",
        configFile: typeof request.body.configFile === "string" ? request.body.configFile : "",
        testFile: typeof request.body.testFile === "string" ? request.body.testFile : "",
        authorized: request.body.authorized === true,
      },
      store,
    );
    response.json(run);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Android Emulator 测试未启动";
    response.status(400).json({ error: `Android Emulator 测试未启动：${message}` });
  }
});

app.get("/api/p04/android-runs/:id/artifacts/:artifactId", (request, response) => {
  try {
    const artifact = store.getAndroidTestArtifact(request.params.id, request.params.artifactId);
    response.download(artifact.path, artifact.name);
  } catch (error) {
    response.status(404).json({ error: error instanceof Error ? error.message : "Android Evidence 不存在" });
  }
});

app.get("/api/p04/performance-runs", (_request, response) => {
  response.json(store.listPerformanceTestRuns());
});

app.get("/api/p04/performance-runs/:id", (request, response) => {
  try {
    response.json(store.getPerformanceTestRun(request.params.id));
  } catch (error) {
    response.status(404).json({ error: error instanceof Error ? error.message : "性能 TestRun 不存在" });
  }
});

app.post("/api/p04/performance-runs", async (request, response) => {
  try {
    const run = await runK6Test(
      {
        repoPath: typeof request.body.repoPath === "string" ? request.body.repoPath : "",
        scriptFile: typeof request.body.scriptFile === "string" ? request.body.scriptFile : "",
        authorized: request.body.authorized === true,
      },
      store,
    );
    response.json(run);
  } catch (error) {
    const message = error instanceof Error ? error.message : "k6 性能测试未启动";
    response.status(400).json({ error: `k6 性能测试未启动：${message}` });
  }
});

app.get("/api/p04/performance-runs/:id/artifacts/:artifactId", (request, response) => {
  try {
    const artifact = store.getPerformanceTestArtifact(request.params.id, request.params.artifactId);
    response.download(artifact.path, artifact.name);
  } catch (error) {
    response.status(404).json({ error: error instanceof Error ? error.message : "性能测试 Evidence 不存在" });
  }
});

app.get("/api/p04/security-runs", (_request, response) => {
  response.json(store.listSecurityTestRuns());
});

app.get("/api/p04/security-runs/:id", (request, response) => {
  try {
    response.json(store.getSecurityTestRun(request.params.id));
  } catch (error) {
    response.status(404).json({ error: error instanceof Error ? error.message : "安全 TestRun 不存在" });
  }
});

app.post("/api/p04/security-runs", async (request, response) => {
  try {
    const run = await runZapBaseline(
      {
        targetUrl: typeof request.body.targetUrl === "string" ? request.body.targetUrl : "",
        authorized: request.body.authorized === true,
      },
      store,
    );
    response.json(run);
  } catch (error) {
    const message = error instanceof Error ? error.message : "ZAP 安全测试未启动";
    response.status(400).json({ error: `ZAP 安全测试未启动：${message}` });
  }
});

app.get("/api/p04/security-runs/:id/artifacts/:artifactId", (request, response) => {
  try {
    const artifact = store.getSecurityTestArtifact(request.params.id, request.params.artifactId);
    response.download(artifact.path, artifact.name);
  } catch (error) {
    response.status(404).json({ error: error instanceof Error ? error.message : "安全测试 Evidence 不存在" });
  }
});

if (isProduction) {
  const serverDir = path.dirname(fileURLToPath(import.meta.url));
  const clientDir = path.resolve(serverDir, "../client");
  app.use(express.static(clientDir));
  app.use((request, response, next) => {
    if (request.path.startsWith("/api/")) {
      next();
      return;
    }
    response.sendFile(path.join(clientDir, "index.html"));
  });
} else {
  const vite = await createViteServer({
    server: { middlewareMode: true },
    appType: "spa",
  });
  app.use(vite.middlewares);
}

const errorHandler: ErrorRequestHandler = (error, _request, response, _next) => {
  void _next;
  const message = error instanceof Error ? error.message : "未知错误";
  const isUploadError =
    error instanceof multer.MulterError ||
    message.startsWith("不支持的文件格式") ||
    message.startsWith("OpenAPI 只支持");
  const isAnalysisValidation = error instanceof RequirementAnalysisValidationError;
  const status = isUploadError ? 400 : isAnalysisValidation ? 422 : 502;
  response.status(status).json({
    error: isUploadError
      ? message
      : isAnalysisValidation
        ? `需求分析结构、来源或完成条件校验失败：${message}`
        : `需求分析运行失败：${message}`,
  });
};

app.use(errorHandler);

app.listen(port, () => {
  console.log(`TestMesh 需求分析运行中：http://localhost:${port}`);
});
