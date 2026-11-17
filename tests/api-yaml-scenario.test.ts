import { describe, expect, it } from "vitest";
import { compileApiYamlScenario } from "../server/api-automation/yaml-scenario.js";

const scenario = `format: testmesh-hurl/v1
name: 售后申请查询链路
steps:
  - name: 创建售后申请
    request:
      method: POST
      path: /after-sales
      headers:
        X-Request-Source: testmesh
      json:
        orderId: order-1001
        quantity: 1
    expectedStatus: 201
    captures:
      - name: applicationId
        type: jsonpath
        expression: $.data.id
    assertions:
      - type: jsonpath
        expression: $.code
        operator: "=="
        expected: 0
  - name: 查询申请状态
    request:
      method: GET
      path: /after-sales/\${applicationId}
      query:
        detail: true
    expectedStatus: 200
    options:
      delay: 100 ms
      retry: 2
      retryInterval: 200 ms
    assertions:
      - type: jsonpath
        expression: $.data.status
        operator: "=="
        expected: pending
`;

describe("traditional API YAML authoring", () => {
  it("compiles a typed YAML chain into Hurl without embedding environment configuration", () => {
    const result = compileApiYamlScenario(scenario);
    expect(result).toMatchObject({ name: "售后申请查询链路", stepCount: 2 });
    expect(result.hurlContent).toContain("POST {{baseUrl}}/after-sales");
    expect(result.hurlContent).toContain('applicationId: jsonpath "$.data.id"');
    expect(result.hurlContent).toContain("GET {{baseUrl}}/after-sales/{{applicationId}}");
    expect(result.hurlContent).toContain("retry: 2");
    expect(result.hurlContent).not.toContain("http://");
  });

  it("preserves native JSON variable types for exact variable references", () => {
    const result = compileApiYamlScenario(`format: testmesh-hurl/v1
name: 类型保持
steps:
  - name: 提交数量
    request:
      method: POST
      path: /items
      json:
        quantity: \${quantity}
        label: item-\${quantity}
    expectedStatus: 200
`);
    expect(result.hurlContent).toContain('"quantity": {{quantity}}');
    expect(result.hurlContent).toContain('"label": "item-{{quantity}}"');
  });

  it("rejects environment configuration, custom functions and persisted secrets", () => {
    expect(() => compileApiYamlScenario(scenario.replace("/after-sales", "https://example.test/after-sales"))).toThrow(/项目环境配置/);
    expect(() => compileApiYamlScenario(scenario.replace("order-1001", "${__random_number()}"))).toThrow(/不执行自定义函数/);
    expect(() => compileApiYamlScenario(scenario.replace("X-Request-Source: testmesh", "Authorization: Bearer saved-token"))).toThrow(/明文/);
  });

  it("reports the exact schema path for invalid assertions", () => {
    expect(() => compileApiYamlScenario(scenario.replace("expected: pending", "expected_typo: pending"))).toThrow(/steps\.1\.assertions\.0/);
  });
});
