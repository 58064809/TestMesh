# 智能导购受控模拟

这是 TestMesh 在本地与云端调试 AI 应用测试链路的默认模拟业务。全部输入、商品与结果都属于 `simulated`，不能当作真实 Agent 质量或正式发布证据。目标只返回格式正确的 Trace ID，不产生真实 OpenInference Span。

- [业务契约](smart-shopping-contract.md)只记录已明确规则和固定商品夹具。
- [OpenAPI 契约](smart-shopping.openapi.json)记录模拟目标的实际 HTTP 入参与响应；`x-trace-id` 仅为合成关联 ID。
- [目标服务](smart-shopping-target.ts)是确定性测试替身，只识别契约里的示例表达，不是 LLM Agent。
- [三轮样本](smart-shopping.sample.json)提供固定输入与可审查预期；尚未绑定 Approved TestCase，因此不是 Phoenix 正式 Dataset。
- [YAML 场景](smart-shopping.testmesh.yaml)通过 `${dataset_input.conversation[...]}` 消费样本，校验会话、参数继承、工具筛选和推荐商品。

运行 `npm run demo:ai-target` 后，目标仅监听 `127.0.0.1:8011`。通过 FastAPI `/api/api-automation/scenarios/execute` 可将 YAML、`base_url=http://127.0.0.1:8011` 及 `variables.dataset_input` 作为隔离验证输入。正式 AI Experiment 仍要求 Approved Test Model、Approved TestCase、已批准 YAML、冻结 Phoenix Dataset Version 和经过校准的 Evaluator；不能用隔离执行代替这些门禁。
