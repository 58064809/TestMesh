import { describe, expect, it } from "vitest";
import type { DomainStore } from "../server/store.js";
import { buildFailureEvidence, listFailureRuns, resolveFailureContext } from "../server/failure-triage/evidence.js";
import { FailureTriageSchema, type FailureDiagnosisContext, type FailureEvidence } from "../server/failure-triage/schema.js";
import { validateFailureTriage } from "../server/failure-triage/validation.js";

const context: FailureDiagnosisContext = {
  projectId: "project-1", environmentId: "env-1", runKind: "api_schema", runId: "run-1",
  approvedVersionId: "v1", approvedTestCaseIds: ["TC-001"],
};

const store = {
  listTestRuns: () => [{
    id: "run-1", specId: "spec-1", targetBaseUrl: "http://example.test", status: "failed",
    startedAt: "2026-10-14T00:00:00.000Z", finishedAt: "2026-10-14T00:00:01.000Z",
    generatedExamples: 1, passed: 0, failed: 1, exitCode: 1, runnerOutput: "1 failed",
    items: [{ id: "item-1", testCaseId: "case-1", operation: "POST /after-sales", status: "failed",
      durationMs: 10, failureType: "server_error", checks: ["status < 500"], request: "POST /after-sales",
      response: "HTTP/1.1 500", reproduction: "curl example", detail: "server error" }],
  }],
  getOpenApiSpec: () => ({ id: "spec-1", projectId: "project-1", environmentId: "env-1", approvedVersionId: "v1", name: "售后 API", version: "1", filename: "openapi.yaml", testCases: [{ id: "case-1", operationId: "create", method: "POST", path: "/after-sales", summary: "创建售后单", approvedTestCaseIds: ["TC-001"] }] }),
  getTestRun: () => (store.listTestRuns()[0]),
  listApiScenarioRuns: () => [],
  listUiTestRuns: () => [],
} as unknown as DomainStore;

function result() {
  return FailureTriageSchema.parse({
    status: "suspected", failure_layer: "backend", summary: "请求稳定返回 500，但缺少服务端遥测。",
    suspected_components: ["售后服务"],
    facts: [{ statement: "创建接口返回 HTTP 500", evidence_refs: ["EVD-HTTP-1"] }],
    hypotheses: [{ cause: "服务端处理异常", confidence: "medium", supporting_evidence_refs: ["EVD-HTTP-1"], contradicting_evidence_refs: [] }],
    source_locations: [], database_findings: [], missing_evidence: ["服务端 Trace 与异常日志"],
    next_checks: ["按请求时间查询 POST /after-sales 的错误 Trace 和关联日志"],
    submission_draft: { title: "创建售后单返回 500", severity: "major", steps: ["提交 Approved TestCase 中的合法售后申请"], expected: "创建成功",
      actual: "返回 HTTP 500", technical_analysis: "接口返回 500，尚未确认根因。", attachment_evidence_refs: ["EVD-HTTP-1"] },
  });
}

describe("FT01 failure evidence and completion gate", () => {
  it("lists only failed runs and binds them to project and environment", () => {
    expect(listFailureRuns(store)).toEqual([expect.objectContaining({ id: "run-1", projectId: "project-1", environmentId: "env-1" })]);
    expect(resolveFailureContext(store, { runKind: "api_schema", runId: "run-1" })).toEqual(context);
    expect(buildFailureEvidence(store, context).map((item) => item.id)).toEqual([
      "EVD-RUN-SUMMARY", "EVD-HTTP-1", "EVD-RUNNER",
    ]);
  });

  it("accepts an evidence-backed suspected result", () => {
    const evidence = buildFailureEvidence(store, context);
    expect(() => validateFailureTriage(result(), evidence)).not.toThrow();
  });

  it("rejects invented evidence references", () => {
    const candidate = result();
    candidate.facts[0].evidence_refs = ["EVD-INVENTED"];
    expect(() => validateFailureTriage(candidate, buildFailureEvidence(store, context))).toThrow("不存在的证据");
  });

  it("rejects source locations without source-code evidence", () => {
    const candidate = result();
    candidate.source_locations = [{ repository: "repo", commit: "abc", file: "src/service.ts", line: 42, evidence_refs: ["EVD-HTTP-1"] }];
    expect(() => validateFailureTriage(candidate, buildFailureEvidence(store, context))).toThrow("没有真实源码证据");
  });

  it("requires direct or independently corroborated evidence before located", () => {
    const candidate = result();
    candidate.status = "located";
    const evidence: FailureEvidence[] = [{ id: "EVD-HTTP-1", category: "http", title: "响应", content: "500", locator: "run", direct: false }];
    expect(() => validateFailureTriage(candidate, evidence)).toThrow("失败断言不能确认根因");
  });

  it("accepts located only when diagnostic evidence identifies the failure", () => {
    const candidate = result();
    candidate.status = "located";
    candidate.facts.push({ statement: "错误 Span 指向售后服务异常", evidence_refs: ["EVD-TRACE-1"] });
    const evidence = [...buildFailureEvidence(store, context), {
      id: "EVD-TRACE-1", category: "telemetry" as const, title: "错误 Trace", content: "after-sales-service error span", locator: "trace:1", direct: true,
    }];
    expect(() => validateFailureTriage(candidate, evidence)).not.toThrow();
  });
});
