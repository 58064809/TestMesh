# 传统 API YAML 场景

## 定位

`testmesh-api/v1` 是 TestMesh 的确定性传统接口自动化执行协议，由 FastAPI/Pydantic 负责输入校验，httpx 负责 HTTP 请求。它不承担需求分析、用例设计或 LLM 评估；Agent 只能根据 Approved TestCase 和真实 OpenAPI/RAG 契约生成候选 YAML，候选物必须经过校验与人工审核。

项目配置与场景分层：Base URL、公共 Header、环境变量、PG/MySQL 数据源、只读查询模板和 SkyWalking 查询端点属于项目配置；YAML 只引用配置 ID，不允许写完整连接串、明文密码或自由 SQL。

## 最小示例

```yaml
format: testmesh-api/v1
name: 商品列表逐项验证
data_driven:
  continue_on_failure: true
  cases:
    - id: enabled-products
      name: 启用商品
      variables: { product_status: enabled }
steps:
  - kind: request
    name: 获取商品列表
    request: { method: GET, path: /products }
    expected_status: 200
    captures:
      - { name: products, type: jsonpath, expression: "$.data.products[*]", mode: all }
  - "for product_index, product in enumerate(${products})":
      - kind: request
        name: 查询商品详情
        request: { method: GET, path: "/products/${product.id}" }
        expected_status: 200
        assertions:
          - { type: jsonpath, expression: "$.data.id", operator: "==", expected: "${product.id}" }
```

## v1 支持范围

- HTTP：GET、POST、PUT、PATCH、DELETE、HEAD、OPTIONS；相对 path、Header、Query、JSON、Form 和文本请求体。
- 变量：`${name}`、`${item.id}` 和数组索引；值完全等于变量表达式时保留 JSON 原生类型。
- 数据驱动：顶层 `data_driven.cases` 逐行建立隔离上下文并运行完整场景；支持稳定 ID、名称、标签、启停和失败后是否继续。
- 响应提取：JSONPath、正则、Header、body、status；支持首项和列表结果。
- 证据提取：通过项目配置中的 PG/MySQL 只读查询或 SkyWalking trace 获取 JSON，再用 JSONPath、正则或 raw 保存变量。
- 断言：status、duration、JSONPath、正则、Header、body；逐条保存预期、实际和失败信息是统一 TestRun 持久化阶段的验收要求。
- 条件：Python 风格 `if/elif/else`，支持白名单比较、`in/not in`、`and/or/not` 和括号；解析为受控 AST，不执行 Python 代码。旧结构化写法保持兼容。
- 遍历：Python 风格 `for item in ${items}` 或 `for index, item in enumerate(${items})` 遍历运行时列表，单层上限 100 项；嵌套深度最多 3 层。旧 `kind: foreach` 保持兼容。
- 请求控制：delay、有限重试、重试间隔和超时；单场景最多 500 次请求，响应体最多 2 MB。

## AI 应用执行契约（AIAT01）

AI 应用测试不建立第二套 Harness，仍使用同一份 YAML、数据驱动、HTTP 请求、变量、控制器、断言和 TestRun。可选的 `ai_application` 只增加目标 Agent 与证据契约：

```yaml
ai_application:
  target_id: after-sales-agent
  target_version: candidate-v1
  interaction: multi_turn       # single_turn | multi_turn | agent
  session_id_variable: session_id
  trace_id_variable: trace_id
  require_trace: true
  observability_standard: openinference
  evaluation_provider: phoenix
  evaluator_names:
    - intent_correctness
    - conversation_coherence
    - groundedness
```

- `multi_turn` 和 `agent` 必须声明会话变量，避免不同数据行共享上下文。
- `require_trace: true` 时，场景必须从目标应用响应中提取真实的 32 位 OpenTelemetry Trace ID；缺失或格式错误会让 TestRun 失败。
- `evaluator_names` 是质量计划要求，不是本地伪造的评测结果。Dataset、Experiment、Evaluator 结果与版本比较仍由 Phoenix 保存，TestMesh 只回链外部 ID。
- 确定性断言继续由 YAML 执行器完成；回复准确性、Groundedness、多轮一致性等语义判定交给 Phoenix Evaluator。

## 明确不支持

- `while`、无界递归、动态导入、任意脚本或 `eval`。
- YAML 内数据库连接、密码、Token、自由 SQL 或完整服务 URL。
- 由 LLM 将失败改写为通过，或在证据缺失时生成“推测通过”的结果。
- 在未绑定 Approved TestCase、真实契约和项目环境时直接执行候选 YAML。

## 质量管理约束

产品化入口必须绑定项目、环境、Approved TestCase 版本及具体用例。每次批准形成不可变场景版本；执行形成统一 TestRun，并进入失败定位、质量计划指标、质量报告与 OPA 发布准入。项目配置绑定、场景版本、数据行结果和失败证据已经持久化；PG/MySQL/SkyWalking 适配器已通过隔离测试。Redis/MQ、企业真实连接和目标 Agent 的 Phoenix Experiment 尚未接入，不得据此宣称企业闭环已验收。
