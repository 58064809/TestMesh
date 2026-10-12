import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseOpenApi } from "../server/openapi.js";
import { runSchemathesis } from "../server/schemathesis.js";
import { DomainStore } from "../server/store.js";

const openapi = `
openapi: 3.0.3
info:
  title: AT01 controlled acceptance target
  version: 1.0.0
paths:
  /items/{itemId}:
    get:
      operationId: getItem
      parameters:
        - name: itemId
          in: path
          required: true
          schema:
            type: integer
            minimum: 1
      responses:
        "200":
          description: Item found
          content:
            application/json:
              schema:
                type: object
                required: [id]
                properties:
                  id:
                    type: integer
        "404":
          description: Item not found
`;

const target = http.createServer((_request, response) => {
  response.writeHead(500, { "content-type": "application/json" });
  response.end(JSON.stringify({ error: "controlled AT01 failure" }));
});

const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "testmesh-at01-"));
const store = new DomainStore(":memory:");

try {
  await new Promise<void>((resolve) => target.listen(0, "127.0.0.1", resolve));
  const address = target.address();
  assert(address && typeof address === "object");
  const parsed = parseOpenApi(openapi);
  const spec = store.createOpenApiSpec({
    ...parsed,
    approvedVersionId: "controlled-approved-v1",
    filename: "at01-controlled-openapi.yaml",
    content: openapi,
  });
  store.updateApprovedTestCaseLinks(spec.testCases[0].id, ["CONTROLLED-TC-001"]);

  const run = await runSchemathesis(
    {
      specId: spec.id,
      targetBaseUrl: `http://127.0.0.1:${address.port}`,
      headers: [],
      auth: { type: "none" },
    },
    store,
    dataRoot,
  );

  if (run.status === "error") process.stderr.write(`\n${run.runnerOutput}\n${JSON.stringify(run.items, null, 2)}\n`);
  assert.equal(run.status, "failed");
  assert(run.failed > 0);
  assert(run.items.some((item) => item.testCaseId === spec.testCases[0].id));
  assert(run.items.some((item) => item.response.includes("500")));
  process.stdout.write(JSON.stringify({
    status: run.status,
    generatedExamples: run.generatedExamples,
    passed: run.passed,
    failed: run.failed,
    mappedApprovedTestCase: "CONTROLLED-TC-001",
  }, null, 2));
} finally {
  await new Promise<void>((resolve) => target.close(() => resolve()));
  store.close();
  fs.rmSync(dataRoot, { recursive: true, force: true });
}
