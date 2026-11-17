import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { runHurlScenario } from "../server/hurl.js";
import { DomainStore } from "../server/store.js";
import { API_YAML_FORMAT, compileApiYamlScenario } from "../server/api-automation/yaml-scenario.js";

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

const source = `format: testmesh-hurl/v1
name: 受控两请求链路
steps:
  - name: 建立会话并捕获 ID
    request:
      method: GET
      path: /session
    expectedStatus: 200
    captures:
      - name: item_id
        type: jsonpath
        expression: $.id
    assertions:
      - type: jsonpath
        expression: $.status
        operator: "=="
        expected: ready
  - name: 使用捕获 ID 查询
    request:
      method: GET
      path: /items/\${item_id}
    expectedStatus: 200
    assertions:
      - type: jsonpath
        expression: $.name
        operator: "=="
        expected: approved
`;
const scenario = compileApiYamlScenario(source);

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
    content: scenario.hurlContent,
    sourceFormat: API_YAML_FORMAT,
    sourceContent: source,
    approvedTestCaseIds: ["TC-LOGIN", "TC-QUERY"],
  });
  const run = await runHurlScenario({
    suiteId: suite.id,
    targetBaseUrl: `http://127.0.0.1:${address.port}`,
    headers: [],
    variables: [],
    auth: { type: "none" },
  }, store, dataRoot);
  if (run.status === "error") process.stderr.write(`\n${run.runnerOutput}\n${JSON.stringify(run.items, null, 2)}\n`);
  assert.equal(run.status, "passed");
  assert(run.passed > 0);
  assert.equal(run.failed, 0);
  assert.deepEqual(store.getApiScenarioSuite(suite.id).approvedTestCaseIds, ["TC-LOGIN", "TC-QUERY"]);
  assert.equal(store.getApiScenarioSuite(suite.id).sourceContent, source);
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
