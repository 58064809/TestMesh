import { describe, expect, it } from "vitest";
import { parseOpenApi } from "../server/openapi.js";
import { parseJUnitReport } from "../server/schemathesis.js";
import { DomainStore } from "../server/store.js";
import type { AnalysisResult } from "../server/analysis.js";

const analysis: AnalysisResult = {
  summary: "售后 API 需求",
  requirements: [
    {
      id: "REQ-001",
      title: "查询售后单",
      description: "按编号查询售后单",
      priority: "must",
      acceptanceCriteria: ["返回售后单"],
      evidenceIds: ["EV-001"],
    },
  ],
  risks: [
    {
      id: "RISK-001",
      title: "越权",
      description: "可能读取其他用户售后单",
      severity: "high",
      mitigation: "校验所属用户",
      evidenceIds: ["EV-001"],
    },
  ],
  pendingQuestions: [],
  evidence: [
    {
      id: "EV-001",
      sourceId: "ATT-1",
      sourceName: "售后需求.pdf",
      locatorType: "page",
      locator: "第 1 页",
      excerpt: "查询售后单",
      note: "",
    },
  ],
};

const openapi = `
openapi: 3.0.3
info:
  title: After-sales API
  version: 1.0.0
paths:
  /cases/{caseId}:
    get:
      operationId: getCase
      summary: 查询售后单
      responses:
        "200":
          description: OK
`;

const junit = `<?xml version="1.0" encoding="utf-8"?>
<testsuites errors="0" failures="1" skipped="0" tests="1" time="1.2">
  <testsuite name="schemathesis" errors="0" failures="1" skipped="0" tests="1" time="1.2">
    <testcase name="GET /cases/{caseId}" time="1.2">
      <failure type="failure">1. Test Case ID: ABC123

- Server error

[500] Internal Server Error:

    \`{"error":"boom"}\`

Reproduce with:

    curl -X GET http://127.0.0.1:3101/cases/1</failure>
    </testcase>
  </testsuite>
</testsuites>`;

describe("P02 domain and Schemathesis integration", () => {
  it("creates one TestCase definition per OpenAPI operation", () => {
    const parsed = parseOpenApi(openapi);

    expect(parsed.name).toBe("After-sales API");
    expect(parsed.operations).toEqual([
      {
        operationId: "getCase",
        method: "GET",
        path: "/cases/{caseId}",
        summary: "查询售后单",
      },
    ]);
  });

  it("persists trace links and extracts minimum failure reproduction from JUnit", () => {
    const store = new DomainStore(":memory:");
    try {
      store.saveAnalysis(analysis, "gpt-5.6-luna");
      const trace = store.listTraceSources();
      const parsed = parseOpenApi(openapi);
      const spec = store.createOpenApiSpec({
        ...parsed,
        filename: "openapi.yaml",
        content: openapi,
      });

      expect(() => store.assertSpecTraceable(spec.id)).toThrow("尚未同时关联需求和证据");
      store.updateTestCaseLinks(
        spec.testCases[0].id,
        [trace.requirements[0].id],
        [trace.evidence[0].id],
      );
      expect(() => store.assertSpecTraceable(spec.id)).not.toThrow();

      const report = parseJUnitReport(junit, spec.id, store);
      expect(report.failed).toBe(1);
      expect(report.items[0]).toMatchObject({
        testCaseId: spec.testCases[0].id,
        operation: "GET /cases/{caseId}",
        checks: ["Server error"],
      });
      expect(report.items[0].request).toContain("curl -X GET");
      expect(report.items[0].response).toContain("[500] Internal Server Error");
      expect(report.items[0].reproduction).toContain("/cases/1");
    } finally {
      store.close();
    }
  });
});
