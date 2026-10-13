# AT02 本机受控 UI 演示

这组资产只验证 TestMesh 的 Playwright 执行、结果解析和失败 Trace 链路，不代表真实售后业务系统验收。

1. `npm run demo:ui-target`
2. `npm run test:ui-demo`

正式使用时，测试代码由 Playwright 官方 Test Agents 在目标仓库中规划、生成和修复；人工审阅 Diff 后，再由 TestMesh 关联 Approved TestCase 并执行。
