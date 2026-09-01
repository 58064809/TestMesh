# ADR 0004：P02 OpenAPI 与 Schemathesis 单一路径

- **状态**：已接受
- **日期**：2026-09-01

## 背景

P02 需要把 Requirement/Risk/Evidence/TestCase 持久化，并完成 OpenAPI 到 TestRun 的可追溯闭环。TestCase 表示 API operation 的测试定义与意图，不表示 Schemathesis 运行时生成的单个 example。

## 决策

- 唯一数据库为 SQLite，固定使用 `better-sqlite3@12.10.0`；不增加数据库抽象或备用数据库。
- 唯一 Runner 为 `Schemathesis 4.24.3`，通过 `uvx schemathesis@4.24.3` 执行。
- 一条 OpenAPI operation 生成一条 TestCase；generated examples 只归属于 TestRun，不逐条持久化为 TestCase。
- Runner 固定单 worker、确定性生成、请求重试为零。
- 单次执行生成 JUnit 报告并捕获同一进程的已脱敏输出。失败项保存 operation、check、request、response、reproduction 和原始失败详情。
- Header/Auth 只在本次执行中使用，不进入 SQLite；P02 不建设 Credential Vault 或环境管理系统。
- 若固定版本 JUnit 无法可靠提供最小失败复现信息，立即停止，不引入第二种报告格式、Python SDK、备用 Runner 或 fallback。

## 验证

已使用本地真实 HTTP 服务制造 500 响应，确认 Schemathesis 4.24.3 JUnit 的失败节点包含 operation、check 分类、响应状态/正文和可复现 curl 请求。

## 明确不做

Docker、备用 Runner、数据库抽象、环境管理系统、Credential Vault、通用 Runner Framework，以及 P03–P05 能力。
