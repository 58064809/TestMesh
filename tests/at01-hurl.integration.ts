import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { runHurlScenario } from "../server/hurl.js";
import { DomainStore } from "../server/store.js";

const server = http.createServer((request, response) => {
  if (request.url === "/session") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ id: "item-42", status: "ready" }));
    return;
  }
  if (request.url === "/items/item-42") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ id: "item-42", name: "approved" }));
    return;
  }
  response.writeHead(404);
  response.end();
});

const scenario = `GET {{baseUrl}}/session
HTTP 200
[Captures]
item_id: jsonpath "$.id"
[Asserts]
jsonpath "$.status" == "ready"

GET {{baseUrl}}/items/{{item_id}}
HTTP 200
[Asserts]
jsonpath "$.name" == "approved"
`;

const store = new DomainStore(":memory:");
const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "testmesh-hurl-"));

try {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address === "object");
  const suite = store.createApiScenarioSuite({
    projectId: "controlled-project",
    environmentId: "controlled-environment",
    approvedVersionId: "controlled-approved-v1",
    filename: "controlled.hurl",
    content: scenario,
    approvedTestCaseIds: ["TC-LOGIN", "TC-QUERY"],
  });
  const run = await runHurlScenario({
    suiteId: suite.id,
    targetBaseUrl: `http://127.0.0.1:${address.port}`,
    headers: [],
    auth: { type: "none" },
  }, store, dataRoot);
  if (run.status === "error") process.stderr.write(`\n${run.runnerOutput}\n${JSON.stringify(run.items, null, 2)}\n`);
  assert.equal(run.status, "passed");
  assert(run.passed > 0);
  assert.equal(run.failed, 0);
  assert.deepEqual(store.getApiScenarioSuite(suite.id).approvedTestCaseIds, ["TC-LOGIN", "TC-QUERY"]);
  process.stdout.write(JSON.stringify({
    status: run.status,
    passed: run.passed,
    failed: run.failed,
    chainedRequests: 2,
    approvedTestCases: suite.approvedTestCaseIds,
  }, null, 2));
} finally {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  store.close();
  fs.rmSync(dataRoot, { recursive: true, force: true });
}
