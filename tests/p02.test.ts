import { describe, expect, it } from "vitest";
import { parseOpenApi } from "../server/openapi.js";
import { parseJUnitReport } from "../server/schemathesis.js";
import { DomainStore } from "../server/store.js";

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

describe("AT01 Approved TestCase and Schemathesis integration", () => {
  it("discovers each OpenAPI operation", () => {
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

  it("runs only operations mapped to an Approved TestCase and extracts minimum failure reproduction", () => {
    const store = new DomainStore(":memory:");
    try {
      const parsed = parseOpenApi(openapi);
      const spec = store.createOpenApiSpec({
        ...parsed,
        approvedVersionId: "approved-v1",
        filename: "openapi.yaml",
        content: openapi,
      });

      expect(spec.approvedVersionId).toBe("approved-v1");
      expect(() => store.getMappedOperationIds(spec.id)).toThrow("至少需要");
      store.updateApprovedTestCaseLinks(spec.testCases[0].id, ["TC-001"]);
      expect(store.getMappedOperationIds(spec.id)).toEqual(["getCase"]);
      expect(store.getOpenApiSpec(spec.id).testCases[0].approvedTestCaseIds).toEqual(["TC-001"]);

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
