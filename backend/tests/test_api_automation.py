import json

import httpx
import pytest

from testmesh_api.application.api_automation.service import ApiScenarioService
from testmesh_api.domain.api_automation.models import parse_scenario_yaml
from testmesh_api.infrastructure.extraction.response_extractor import JsonPathResponseExtractor
from testmesh_api.infrastructure.extraction.value_extractor import JsonValueExtractor
from testmesh_api.infrastructure.http.httpx_client import HttpxApiClient
from testmesh_api.application.api_automation.ports import HttpResponseData
from testmesh_api.main import app
from testmesh_api.api.api_automation import repository
from testmesh_api.api.api_automation import DatasetSampleRunRequest, execute_approved_asset


SCENARIO = """
format: testmesh-api/v1
name: 商品列表逐项验证
steps:
  - kind: request
    name: 获取商品列表
    request:
      method: GET
      path: /products
    expected_status: 200
    captures:
      - name: products
        type: jsonpath
        expression: $.data.products[*]
        mode: all
  - kind: foreach
    name: 遍历商品
    foreach:
      source: ${products}
      item: product
      index: product_index
      max_items: 20
    steps:
      - kind: request
        name: 查询商品详情
        request:
          method: GET
          path: /products/${product.id}
          query:
            expectedName: ${product.name}
        expected_status: 200
        assertions:
          - type: jsonpath
            expression: $.data.id
            operator: ==
            expected: ${product.id}
"""


def handler(request: httpx.Request) -> httpx.Response:
    if request.url.path == "/products":
        return httpx.Response(200, json={"data": {"products": [
            {"id": 101, "name": "键盘"}, {"id": 202, "name": "鼠标"}, {"id": 303, "name": "显示器"}
        ]}})
    product_id = int(request.url.path.rsplit("/", 1)[1])
    return httpx.Response(200, json={"data": {"id": product_id}})


@pytest.mark.asyncio
async def test_runtime_foreach_uses_dynamic_response_list_and_preserves_types() -> None:
    scenario = parse_scenario_yaml(SCENARIO)
    async with HttpxApiClient("https://test.invalid", transport=httpx.MockTransport(handler)) as client:
        result = await ApiScenarioService(client, JsonPathResponseExtractor()).run(scenario)
    assert result.status == "passed"
    assert result.passed == 4
    assert result.failed == 0
    assert result.variables["products"][0]["id"] == 101
    assert [item.iteration for item in result.items[1:]] == [
        "遍历商品[0]", "遍历商品[1]", "遍历商品[2]"
    ]


@pytest.mark.asyncio
async def test_foreach_collects_each_item_failure_instead_of_stopping_the_list() -> None:
    def failing_handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/products":
            return handler(request)
        product_id = int(request.url.path.rsplit("/", 1)[1])
        actual = -1 if product_id == 202 else product_id
        return httpx.Response(200, json={"data": {"id": actual}})

    async with HttpxApiClient("https://test.invalid", transport=httpx.MockTransport(failing_handler)) as client:
        result = await ApiScenarioService(client, JsonPathResponseExtractor()).run(parse_scenario_yaml(SCENARIO))
    assert result.status == "failed"
    assert result.passed == 3
    assert result.failed == 1
    assert result.items[-1].iteration == "遍历商品[2]"


def test_rejects_unbounded_or_wrong_foreach_source() -> None:
    invalid = SCENARIO.replace("max_items: 20", "max_items: 1000")
    with pytest.raises(ValueError):
        parse_scenario_yaml(invalid)


def test_exact_variable_reference_keeps_json_number() -> None:
    parsed = parse_scenario_yaml(SCENARIO)
    dumped = json.loads(parsed.model_dump_json())
    assert dumped["steps"][1]["foreach"]["source"] == "${products}"


@pytest.mark.asyncio
async def test_fastapi_validation_endpoint() -> None:
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://testmesh") as client:
        response = await client.post("/api/api-automation/scenarios/validate", json={"yaml_content": SCENARIO})
    assert response.status_code == 200
    assert response.json()["name"] == "商品列表逐项验证"
    assert response.json()["plan"]["format"] == "testmesh-api/v1"


@pytest.mark.asyncio
async def test_product_asset_requires_approval_and_persists_assertion_evidence() -> None:
    product_scenario = """
format: testmesh-api/v1
name: 产品化场景
steps:
  - kind: request
    name: 健康检查
    request: { method: GET, path: /health }
    expected_status: 200
    assertions:
      - { type: jsonpath, expression: $.ok, operator: "==", expected: true }
"""
    class FakeRepository:
        def __init__(self) -> None:
            self.approved = False
            self.saved_result = None

        async def create_draft(self, **values: object) -> dict[str, object]:
            assert values["approved_test_case_ids"] == ["TC-001"]
            return {"id": "scenario-1", "status": "draft", "name": values["name"]}

        async def approve(self, scenario_id: str, approved_by: str) -> dict[str, object]:
            assert scenario_id == "scenario-1" and approved_by == "reviewer"
            self.approved = True
            return {"id": scenario_id, "status": "approved", "approved_by": approved_by}

        async def execution_context(self, scenario_id: str) -> dict[str, object]:
            if not self.approved:
                raise ValueError("只有人工批准的场景可以执行")
            return {"id": scenario_id, "yaml_content": product_scenario, "base_url": "https://test.invalid",
                    "headers_json": [], "variables_json": [], "project_id": "P-1", "environment_id": "E-1",
                    "approved_version_id": "V-1", "approved_test_case_ids": ["TC-001"]}

        async def save_run(self, context: object, result: object, started_at: str, finished_at: str) -> dict[str, object]:
            del context, started_at, finished_at
            self.saved_result = result
            return {"id": "run-1", "status": result.status, "items_json": [item.__dict__ for item in result.items]}

    fake = FakeRepository()
    app.dependency_overrides[repository] = lambda: fake
    original_client = HttpxApiClient.request

    async def fake_request(self: object, method: str, path: str, **kwargs: object) -> HttpResponseData:
        del self, method, kwargs
        assert path == "/health"
        return HttpResponseData(200, {}, '{"ok":true}', {"ok": True}, 3.5)

    HttpxApiClient.request = fake_request
    try:
        payload = {"yaml_content": product_scenario, "project_id": "P-1", "environment_id": "E-1",
                   "approved_version_id": "V-1", "approved_test_case_ids": ["TC-001"],
                   "created_by": "author", "change_reason": "initial"}
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://testmesh") as client:
            created = await client.post("/api/api-automation/scenarios/assets", json=payload)
            assert created.status_code == 201
            blocked = await client.post("/api/api-automation/scenarios/assets/scenario-1/runs")
            assert blocked.status_code == 422
            approved = await client.post("/api/api-automation/scenarios/assets/scenario-1/approve", json={"approved_by": "reviewer"})
            assert approved.status_code == 200
            executed = await client.post("/api/api-automation/scenarios/assets/scenario-1/runs")
            assert executed.status_code == 201
            assert fake.saved_result.items[0].assertions[0].assertion_type == "status"
            assert fake.saved_result.items[0].assertions[1].actual is True
    finally:
        app.dependency_overrides.clear()
        HttpxApiClient.request = original_client


@pytest.mark.asyncio
async def test_if_elif_else_executes_only_matching_branch() -> None:
    conditional = """
format: testmesh-api/v1
name: 状态分支
steps:
  - kind: condition
    name: 按订单状态选择校验
    if:
      left: ${status}
      operator: ==
      right: paid
    then:
      - kind: request
        name: 已支付订单
        request: { method: GET, path: /paid }
        expected_status: 200
    elif:
      - when: { left: "${status}", operator: ==, right: pending }
        steps:
          - kind: request
            name: 待支付订单
            request: { method: GET, path: /pending }
            expected_status: 200
    else:
      - kind: request
        name: 其他订单
        request: { method: GET, path: /other }
        expected_status: 200
"""
    visited: list[str] = []

    def branch_handler(request: httpx.Request) -> httpx.Response:
        visited.append(request.url.path)
        return httpx.Response(200, json={"ok": True})

    async with HttpxApiClient("https://test.invalid", transport=httpx.MockTransport(branch_handler)) as client:
        result = await ApiScenarioService(client, JsonPathResponseExtractor()).run(
            parse_scenario_yaml(conditional), {"status": "pending"}
        )
    assert result.status == "passed"
    assert visited == ["/pending"]


@pytest.mark.asyncio
async def test_database_or_trace_evidence_can_feed_foreach() -> None:
    evidence_yaml = """
format: testmesh-api/v1
name: 数据库订单逐项验证
steps:
  - kind: evidence
    name: 查询订单
    source:
      type: database
      data_source_id: pg-test
      query_id: orders-by-user
      params: { user_id: "${user_id}" }
    save_as: orders
    extract: { type: jsonpath, expression: "$[*]", mode: all }
  - kind: foreach
    name: 遍历订单
    foreach: { source: "${orders}", item: order, max_items: 10 }
    steps:
      - kind: request
        name: 查询订单接口
        request: { method: GET, path: "/orders/${order.id}" }
        expected_status: 200
"""

    class FakeEvidenceProvider:
        async def load(self, source: object, context: dict[str, object]) -> object:
            assert context["user_id"] == 7
            return [{"id": 11}, {"id": 22}]

    visited: list[str] = []
    def handler(request: httpx.Request) -> httpx.Response:
        visited.append(request.url.path)
        return httpx.Response(200, json={"ok": True})

    async with HttpxApiClient("https://test.invalid", transport=httpx.MockTransport(handler)) as client:
        result = await ApiScenarioService(
            client, JsonPathResponseExtractor(), FakeEvidenceProvider(), JsonValueExtractor()
        ).run(parse_scenario_yaml(evidence_yaml), {"user_id": 7})
    assert result.status == "passed"
    assert visited == ["/orders/11", "/orders/22"]


@pytest.mark.asyncio
async def test_data_driven_runs_each_enabled_case_with_isolated_typed_variables() -> None:
    source = """
format: testmesh-api/v1
name: 商品数据驱动
data_driven:
  source: inline
  continue_on_failure: true
  cases:
    - id: product-101
      name: 整数商品101
      tags: [normal]
      variables: { product_id: 101 }
    - id: product-202
      name: 整数商品202
      tags: [boundary]
      variables: { product_id: 202 }
    - id: disabled-case
      name: 暂不执行
      enabled: false
      variables: { product_id: 999 }
steps:
  - kind: request
    name: 查询商品
    request: { method: GET, path: "/products/${product_id}" }
    expected_status: 200
    assertions:
      - { type: jsonpath, expression: $.data.id, operator: "==", expected: "${product_id}" }
"""
    visited: list[str] = []

    def data_handler(request: httpx.Request) -> httpx.Response:
        visited.append(request.url.path)
        product_id = int(request.url.path.rsplit("/", 1)[1])
        return httpx.Response(200, json={"data": {"id": product_id}})

    async with HttpxApiClient("https://test.invalid", transport=httpx.MockTransport(data_handler)) as client:
        result = await ApiScenarioService(client, JsonPathResponseExtractor()).run(parse_scenario_yaml(source))
    assert result.status == "passed"
    assert visited == ["/products/101", "/products/202"]
    assert [item.iteration for item in result.items] == ["data[product-101]", "data[product-202]"]
    assert [item.status for item in result.data_cases] == ["passed", "passed", "skipped"]
    assert result.data_cases[0].variables["product_id"] == 101


@pytest.mark.asyncio
async def test_python_style_if_elif_else_and_for_are_normalized_and_executed() -> None:
    source = """
format: testmesh-api/v1
name: Python风格控制器
steps:
  - kind: request
    name: 获取商品
    request: { method: GET, path: /products }
    expected_status: 200
    captures:
      - { name: products, type: jsonpath, expression: "$.data.products[*]", mode: all }
  - "for product_index, product in enumerate(${products})":
      - "if ${product.id} == 101 and ${product_index} == 0":
          - kind: request
            name: 首个商品
            request: { method: GET, path: "/featured/${product.id}" }
            expected_status: 200
        "elif ${product.id} in [202, 303]":
          - kind: request
            name: 普通商品
            request: { method: GET, path: "/regular/${product.id}" }
            expected_status: 200
        else:
          - kind: request
            name: 其他商品
            request: { method: GET, path: "/other/${product.id}" }
            expected_status: 200
"""
    visited: list[str] = []

    def python_handler(request: httpx.Request) -> httpx.Response:
        visited.append(request.url.path)
        if request.url.path == "/products":
            return httpx.Response(200, json={"data": {"products": [{"id": 101}, {"id": 202}, {"id": 303}]}})
        return httpx.Response(200, json={"ok": True})

    scenario = parse_scenario_yaml(source)
    dumped = scenario.model_dump(mode="json", by_alias=True)
    assert dumped["steps"][1]["kind"] == "foreach"
    assert dumped["steps"][1]["foreach"]["index"] == "product_index"
    async with HttpxApiClient("https://test.invalid", transport=httpx.MockTransport(python_handler)) as client:
        result = await ApiScenarioService(client, JsonPathResponseExtractor()).run(scenario)
    assert result.status == "passed"
    assert visited == ["/products", "/featured/101", "/regular/202", "/regular/303"]


def test_rejects_duplicate_data_ids_and_unsafe_python_expression() -> None:
    duplicate = """
format: testmesh-api/v1
name: 重复数据
data_driven:
  cases:
    - { id: same, name: 第一条, variables: { value: 1 } }
    - { id: same, name: 第二条, variables: { value: 2 } }
steps:
  - { kind: request, name: 健康检查, request: { method: GET, path: /health }, expected_status: 200 }
"""
    with pytest.raises(ValueError, match="不能重复"):
        parse_scenario_yaml(duplicate)
    with pytest.raises(ValueError, match="不允许的语法"):
        from testmesh_api.application.api_automation.service import evaluate_python_expression
        evaluate_python_expression("__import__('os')", {})


@pytest.mark.asyncio
async def test_ai_application_contract_reuses_http_runner_and_requires_trace_evidence() -> None:
    source = """
format: testmesh-api/v1
name: 售后 Agent 单轮契约测试
ai_application:
  target_id: after-sales-agent
  target_version: candidate-v1
  interaction: single_turn
  trace_id_variable: trace_id
  require_trace: true
  observability_standard: openinference
  evaluation_provider: phoenix
  evaluator_names: [intent_correctness, groundedness]
data_driven:
  cases:
    - id: intent-refund
      name: 退款意图
      variables: { message: "我要退款" }
steps:
  - kind: request
    name: 调用目标 Agent
    request:
      method: POST
      path: /agent/invoke
      json: { message: "${message}" }
    expected_status: 200
    captures:
      - { name: trace_id, type: header, expression: x-trace-id }
    assertions:
      - { type: jsonpath, expression: $.answer, operator: exists }
"""

    def ai_handler(request: httpx.Request) -> httpx.Response:
        assert json.loads(request.content)["message"] == "我要退款"
        return httpx.Response(
            200,
            headers={"x-trace-id": "0123456789abcdef0123456789abcdef"},
            json={"answer": "我来协助处理退款。"},
        )

    scenario = parse_scenario_yaml(source)
    async with HttpxApiClient("https://test.invalid", transport=httpx.MockTransport(ai_handler)) as client:
        result = await ApiScenarioService(client, JsonPathResponseExtractor()).run(scenario)
    assert result.status == "passed"
    assert result.data_cases[0].variables["trace_id"] == "0123456789abcdef0123456789abcdef"
    assert result.items[-1].name == "AI 应用证据契约"
    assert "Phoenix Evaluator=intent_correctness,groundedness" in result.items[-1].detail


@pytest.mark.asyncio
async def test_ai_application_contract_fails_without_real_trace_and_session() -> None:
    source = """
format: testmesh-api/v1
name: 多轮 Agent 证据缺失
ai_application:
  target_id: after-sales-agent
  target_version: candidate-v1
  interaction: multi_turn
  session_id_variable: session_id
  trace_id_variable: trace_id
  evaluator_names: [conversation_coherence]
steps:
  - kind: request
    name: 调用目标 Agent
    request: { method: POST, path: /agent/invoke, json: { message: 继续 } }
    expected_status: 200
"""

    def no_evidence_handler(request: httpx.Request) -> httpx.Response:
        del request
        return httpx.Response(200, json={"answer": "继续处理"})

    async with HttpxApiClient("https://test.invalid", transport=httpx.MockTransport(no_evidence_handler)) as client:
        result = await ApiScenarioService(client, JsonPathResponseExtractor()).run(parse_scenario_yaml(source))
    assert result.status == "failed"
    assert result.items[-1].name == "AI 应用证据契约"
    assert "缺少会话变量 session_id" in result.items[-1].detail
    assert "Trace ID" in result.items[-1].detail


def test_ai_application_contract_rejects_multiturn_without_session_variable() -> None:
    source = """
format: testmesh-api/v1
name: 无会话多轮配置
ai_application:
  target_id: agent
  target_version: v1
  interaction: multi_turn
  evaluator_names: [conversation_coherence]
steps:
  - { kind: request, name: invoke, request: { method: POST, path: /invoke }, expected_status: 200 }
"""
    with pytest.raises(ValueError, match="session_id_variable"):
        parse_scenario_yaml(source)


@pytest.mark.asyncio
async def test_approved_ai_asset_executes_each_dataset_input(monkeypatch: pytest.MonkeyPatch) -> None:
    from testmesh_api.api import api_automation as api_module

    source = """
format: testmesh-api/v1
name: 导购样本执行
ai_application:
  target_id: smart-shopping-simulated
  target_version: fixture-v1
  interaction: single_turn
  evaluator_names: [product_faithfulness]
steps:
  - kind: request
    name: 调用导购
    request:
      method: POST
      path: /agent
      json: {message: "${dataset_input.message}"}
    expected_status: 200
    captures:
      - {name: trace_id, type: header, expression: x-trace-id}
"""
    seen: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(json.loads(request.content)["message"])
        return httpx.Response(200, headers={"x-trace-id": "0123456789abcdef0123456789abcdef"}, json={"ok": True})

    class Client(HttpxApiClient):
        def __init__(self, base_url: str, headers: dict[str, str]) -> None:
            super().__init__(base_url, headers, transport=httpx.MockTransport(handler))

    class Store:
        async def execution_context(self, _scenario_id: str) -> dict[str, object]:
            return {"id": "scenario-1", "yaml_content": source, "base_url": "https://test.invalid",
                    "headers_json": [], "variables_json": [], "approved_test_case_ids": ["TC-001"]}

        async def save_run(self, _context: object, result: object, *_times: str) -> dict[str, object]:
            return {"status": result.status, "variables": result.variables}

    monkeypatch.setattr(api_module, "HttpxApiClient", Client)
    store = Store()
    first = await execute_approved_asset("scenario-1", store, DatasetSampleRunRequest(sample_id="sample-1", input={"message": "推荐羽毛球拍"}))
    second = await execute_approved_asset("scenario-1", store, DatasetSampleRunRequest(sample_id="sample-2", input={"message": "预算300元"}))
    assert seen == ["推荐羽毛球拍", "预算300元"]
    assert first["variables"]["dataset_sample_id"] == "sample-1"
    assert second["variables"]["dataset_sample_id"] == "sample-2"
