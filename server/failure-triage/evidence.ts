import type { DomainStore } from "../store.js";
import type { FailureDiagnosisContext, FailureDiagnosisRequest, FailureEvidence, FailureRunOption } from "./schema.js";

const MAX_EVIDENCE_CHARS = 16_000;

function bounded(value: unknown): string {
  const text = typeof value === "string" ? value.trim() : JSON.stringify(value, null, 2);
  if (!text) return "（空）";
  return text.length <= MAX_EVIDENCE_CHARS ? text : `${text.slice(0, MAX_EVIDENCE_CHARS)}\n…内容已按证据上限截断`;
}

export function listFailureRuns(store: DomainStore): FailureRunOption[] {
  const schemaRuns = store.listTestRuns()
    .filter((run) => run.status === "failed" || run.status === "error")
    .map((run) => {
      const spec = store.getOpenApiSpec(run.specId);
      return {
        kind: "api_schema" as const,
        id: run.id,
        projectId: spec.projectId,
        environmentId: spec.environmentId,
        label: `Schemathesis · ${spec.name} · ${run.failed} 个失败`,
        status: run.status as "failed" | "error",
        startedAt: run.startedAt,
        failed: run.failed,
      };
    });
  const scenarioRuns = store.listApiScenarioRuns()
    .filter((run) => run.status === "failed" || run.status === "error")
    .map((run) => ({
      kind: "api_scenario" as const,
      id: run.id,
      projectId: run.projectId,
      environmentId: run.environmentId,
      label: `Hurl · ${run.targetBaseUrl} · ${run.failed} 个失败`,
      status: run.status as "failed" | "error",
      startedAt: run.startedAt,
      failed: run.failed,
    }));
  const uiRuns = store.listUiTestRuns()
    .filter((run) => run.status === "failed" || run.status === "error")
    .map((run) => ({
      kind: "ui" as const,
      id: run.id,
      projectId: run.projectId,
      environmentId: run.environmentId,
      label: `Playwright · ${run.testFile} · ${run.failed} 个失败`,
      status: run.status as "failed" | "error",
      startedAt: run.startedAt,
      failed: run.failed,
    }));
  return [...schemaRuns, ...scenarioRuns, ...uiRuns]
    .sort((left, right) => right.startedAt.localeCompare(left.startedAt));
}

export function resolveFailureContext(store: DomainStore, input: FailureDiagnosisRequest): FailureDiagnosisContext {
  const selected = listFailureRuns(store).find((run) => run.kind === input.runKind && run.id === input.runId);
  if (!selected) throw new Error("所选 TestRun 不存在、尚未失败或已不在可分析范围内");
  if (input.runKind === "api_schema") {
    const run = store.getTestRun(input.runId);
    const spec = store.getOpenApiSpec(run.specId);
    const failedOperationIds = new Set(run.items.filter((item) => item.status !== "passed").map((item) => item.testCaseId).filter(Boolean));
    return {
      ...input,
      projectId: spec.projectId,
      environmentId: spec.environmentId,
      approvedVersionId: spec.approvedVersionId,
      approvedTestCaseIds: spec.testCases.filter((item) => failedOperationIds.has(item.id)).flatMap((item) => item.approvedTestCaseIds),
    };
  }
  if (input.runKind === "api_scenario") {
    const run = store.getApiScenarioRun(input.runId);
    const suite = store.getApiScenarioSuite(run.suiteId);
    return { ...input, projectId: run.projectId, environmentId: run.environmentId, approvedVersionId: suite.approvedVersionId, approvedTestCaseIds: suite.approvedTestCaseIds };
  }
  const run = store.getUiTestRun(input.runId);
  return { ...input, projectId: run.projectId, environmentId: run.environmentId, approvedVersionId: run.approvedVersionId, approvedTestCaseIds: run.approvedTestCaseIds };
}

export function buildFailureEvidence(store: DomainStore, input: FailureDiagnosisContext): FailureEvidence[] {
  const selected = listFailureRuns(store).find((run) => run.kind === input.runKind && run.id === input.runId);
  if (!selected) throw new Error("所选 TestRun 不存在、尚未失败或已不在可分析范围内");
  const evidence: FailureEvidence[] = [];

  if (input.runKind === "api_schema") appendSchemaRun(store, input.runId, evidence);
  if (input.runKind === "api_scenario") appendScenarioRun(store, input.runId, evidence);
  if (input.runKind === "ui") appendUiRun(store, input.runId, evidence);
  return evidence;
}

function appendSchemaRun(store: DomainStore, runId: string, evidence: FailureEvidence[]): void {
  const run = store.getTestRun(runId);
  evidence.push({
    id: "EVD-RUN-SUMMARY", category: "test_run", title: "Schemathesis TestRun 摘要",
    locator: `api_schema:${run.id}`, direct: true,
    content: bounded({ status: run.status, targetBaseUrl: run.targetBaseUrl, passed: run.passed, failed: run.failed, exitCode: run.exitCode, startedAt: run.startedAt, finishedAt: run.finishedAt }),
  });
  run.items.filter((item) => item.status !== "passed").slice(0, 20).forEach((item, index) => {
    evidence.push({
      id: `EVD-HTTP-${index + 1}`, category: "assertion", title: `${item.operation} 失败断言、请求与响应`,
      locator: `api_schema:${run.id}:item:${item.id}`, direct: true,
      content: bounded({ failureType: item.failureType, checks: item.checks, request: item.request, response: item.response, reproduction: item.reproduction, detail: item.detail }),
    });
  });
  if (run.runnerOutput.trim()) evidence.push({
    id: "EVD-RUNNER", category: "runner", title: "Schemathesis Runner 输出",
    locator: `api_schema:${run.id}:runner`, direct: false, content: bounded(run.runnerOutput),
  });
}

function appendScenarioRun(store: DomainStore, runId: string, evidence: FailureEvidence[]): void {
  const run = store.getApiScenarioRun(runId);
  evidence.push({
    id: "EVD-RUN-SUMMARY", category: "test_run", title: "Hurl TestRun 摘要",
    locator: `api_scenario:${run.id}`, direct: true,
    content: bounded({ status: run.status, targetBaseUrl: run.targetBaseUrl, passed: run.passed, failed: run.failed, exitCode: run.exitCode, startedAt: run.startedAt, finishedAt: run.finishedAt }),
  });
  run.items.filter((item) => item.status !== "passed").slice(0, 20).forEach((item, index) => evidence.push({
    id: `EVD-SCENARIO-${index + 1}`, category: "assertion", title: `${item.name} 业务断言失败`,
    locator: `api_scenario:${run.id}:item:${item.id}`, direct: true, content: bounded(item),
  }));
  if (run.runnerOutput.trim()) evidence.push({
    id: "EVD-RUNNER", category: "runner", title: "Hurl Runner 输出",
    locator: `api_scenario:${run.id}:runner`, direct: false, content: bounded(run.runnerOutput),
  });
}

function appendUiRun(store: DomainStore, runId: string, evidence: FailureEvidence[]): void {
  const run = store.getUiTestRun(runId);
  evidence.push({
    id: "EVD-RUN-SUMMARY", category: "test_run", title: "Playwright TestRun 摘要",
    locator: `ui:${run.id}`, direct: true,
    content: bounded({ status: run.status, targetBaseUrl: run.targetBaseUrl, repoPath: run.repoPath, testFile: run.testFile, passed: run.passed, failed: run.failed, skipped: run.skipped, exitCode: run.exitCode, error: run.error, startedAt: run.startedAt, finishedAt: run.finishedAt }),
  });
  run.results.filter((item) => item.status !== "passed").slice(0, 20).forEach((item, index) => evidence.push({
    id: `EVD-UI-${index + 1}`, category: "runner", title: `${item.title} UI 执行失败`,
    locator: `ui:${run.id}:result:${item.id}`, direct: true, content: bounded(item),
  }));
  run.artifacts.forEach((item, index) => evidence.push({
    id: `EVD-ARTIFACT-${index + 1}`, category: "artifact", title: `Playwright Trace：${item.name}`,
    locator: `/api/ui-automation/runs/${run.id}/artifacts/${item.id}`, direct: false,
    content: "平台已保存 Playwright Trace ZIP；FT01-A 仅登记附件，FT01-B 将通过成熟 Trace 工具读取其中证据。",
  }));
  if (run.runnerOutput.trim()) evidence.push({
    id: "EVD-RUNNER", category: "runner", title: "Playwright Runner 输出",
    locator: `ui:${run.id}:runner`, direct: false, content: bounded(run.runnerOutput),
  });
}
