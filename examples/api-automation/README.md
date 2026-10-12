# API 自动化本机受控演示

本目录用于在没有真实业务测试环境时验证 TestMesh 平台链路。所有接口、数据和结果都是受控演示，不能作为真实业务验收证据。

1. 在一个终端运行 `npm run demo:api-target`。
2. 在 TestMesh“项目配置”中增加环境：名称 `本机受控演示（非业务）`，Base URL `http://127.0.0.1:3021`。
3. 契约生成测试可上传 `after-sales-demo.openapi.yaml`。
4. 业务场景执行可上传 `after-sales-demo.hurl`，关联 `TC-003` 和 `TC-004`。

Hurl 场景验证三个真实 HTTP 请求：提交完整退货申请、使用捕获的申请 ID 查询状态、拒绝未确认的退货申请。
