---
name: api-automation-yaml
description: 根据 Approved TestCase、真实 OpenAPI/RAG 契约和项目环境事实，设计可人工修正并由 FastAPI 确定性执行的 testmesh-api/v1 YAML 场景。
---

# API 自动化 YAML 场景设计

本 Skill 只负责生成候选场景，不执行 HTTP、不读取凭证、不决定发布结果。候选必须通过 Pydantic 校验并经人工审核后才能保存和执行。

## 输入门槛

- 必须具有 Approved TestCase 版本和至少一个关联 TestCase ID。
- 接口 method、path、参数、响应和业务状态必须来自真实 OpenAPI 或批准的 RAG 契约，不得从 PRD 猜接口。
- Base URL、公共 Header、公共变量属于项目环境配置，不写入 YAML。
- Authorization、Cookie、Token、API Key、密码和证书不得出现在候选中。

缺少接口契约、必填参数、响应结构或断言依据时，返回 `blocked` 及缺口，不生成看似可运行的 YAML。

## 结构选择

- 普通依赖链使用多个 `kind: request` 步骤，通过 `captures` 提取后续变量。
- JSON 响应使用 `jsonpath`；文本使用 `regex`；Header、body 和 status 使用对应提取类型。
- 只取单值使用 `mode: first`；准备遍历集合时必须使用 `mode: all`。
- 执行前已知的等价类、边界值和业务组合使用顶层 `data_driven.cases`；每条数据必须有稳定 ID、名称和明确变量，不得包含密钥。
- 运行时集合长度未知时使用 Python 风格 `for item in ${items}` 或 `for index, item in enumerate(${items})`，禁止用固定次数重放冒充遍历；旧 `kind: foreach` 只用于兼容。
- 确定性分支默认使用 Python 风格 `if / elif / else`。只允许变量、常量、列表、比较、`and/or/not` 和括号，不生成函数调用或任意表达式代码；旧结构化条件只用于兼容。
- 数据库或调用链证据使用 `kind: evidence`，只引用项目配置中的 `data_source_id/query_id` 或 `provider_id`；禁止在 YAML 写连接串、密码或任意 SQL。
- `${products}` 引用整个集合；`${product.id}` 引用当前元素字段；完全等于变量时保留原生 JSON 类型。
- `retry` 只用于明确允许轮询或短暂失败的幂等请求，不能掩盖业务断言失败。
- 当前引擎不开放 while、任意递归或用户脚本，不得生成这些节点；集合处理使用有界 `foreach`。

## 候选模板

```yaml
format: testmesh-api/v1
name: 商品列表数据驱动验证
data_driven:
  continue_on_failure: true
  cases:
    - id: enabled-products
      name: 查询启用商品
      variables: { product_status: enabled }
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
  - "for product_index, product in enumerate(${products})":
      - kind: request
        name: 查询商品详情
        request:
          method: GET
          path: /products/${product.id}
        expected_status: 200
        assertions:
          - type: jsonpath
            expression: $.data.id
            operator: ==
            expected: ${product.id}
```

## 质量与追溯

- 每个场景必须说明关联的 Approved TestCase ID、覆盖目标和断言依据；这些元数据由 TestMesh 业务对象保存，不塞入执行器私有字段。
- 正常、异常、边界和跨请求状态链分别设计，不把大量无关目标塞进一个场景。
- Agent 输出后必须先调用 YAML 校验；校验错误原样返回人工修正，不静默改成另一套语法。
- 执行结果必须按数据行、请求和 for 元素分别记录，最终汇总进入 TestRun、质量计划、失败诊断和发布准入证据。

## AI 应用测试扩展边界

- 不生成第二套 AI Harness。AI 应用测试继续使用同一 YAML、数据驱动、请求、变量、控制器、断言和 TestRun。
- 只有目标 Agent 契约明确时才增加 `ai_application`，记录目标 ID/版本、交互模式、会话变量、Trace 变量和所需 Phoenix Evaluator。
- `multi_turn` 或 `agent` 必须声明 `session_id_variable`；`require_trace=true` 时必须从真实响应提取 32 位 OpenTelemetry Trace ID。
- `ai_application` 不执行或存储 Phoenix 评测。Dataset、Experiment、Evaluator、Annotation 和版本比较仍以 Phoenix 为唯一事实来源。
- 确定性字段由 YAML 断言；回复准确性、Groundedness、多轮一致性等语义质量由 Phoenix Evaluator 判断。
