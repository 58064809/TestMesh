# TestMesh 架构

## 架构原则

TestMesh 采用“统一工作台 + 薄领域层 + 成熟 Harness/Agent/测试引擎适配”的演进方式。2026-09-17 起先建设 H00 Harness Foundation，再迁移需求分析、测试设计和 API/UI 自动化。历史 P01–P06 保留为实现与验收记录，不再决定新主线顺序。

## Harness-first 目标结构

```text
TestMesh UI / API
  └─ Task Manifest
       └─ LangGraph Workflow Runtime
            ├─ Requirement Analysis Stage Profile
            ├─ Test Design Stage Profile
            ├─ API Automation Stage Profile
            ├─ UI Automation Stage Profile
            └─ Failure Triage Stage Profile（调研后）

每个 Stage Profile
  ├─ Context
  ├─ Knowledge
  ├─ Skills
  ├─ Tools
  ├─ Policy
  └─ Schema
       ↓
Deep Agents / LangChain Agent
       ↓
候选 Artifact
       ↓
确定性 Completion Gate
       ↓
已完成 Artifact / 等待人工输入 / 显式失败
```

LangGraph 负责图执行、Checkpoint、Interrupt、并行和恢复。LangChain `createAgent` 提供 Agent Loop，Deep Agents 中间件提供渐进式 Skill 加载和受限只读能力。TestMesh 不复制这些基础能力，只提供领域配置和校验。

业务数据与运行状态分开：业务数据库保存 Source、Analysis、Decision、Baseline、TestCase、AutomationArtifact 和 TestRun；LangGraph Checkpoint 保存运行位置和这些对象的 ID。本机 PostgreSQL `testmesh` 数据库使用 `harness_checkpoint` 保存 Checkpoint、`harness_runtime` 保存运行摘要、`testmesh_business` 保存需求分析业务事实。RA01 已一次性迁移有效需求分析数据并删除 SQLite 需求分析路径，不保留双读写。

## RA01 运行结构

```text
浏览器
  → Requirement Analysis Task
  → Requirement Analysis Stage Profile
  → LangGraph Workflow
       ├─ Source Reader / Locator
       ├─ LangChain Agent + Deep Agents Skill Middleware
       ├─ 固定 RequirementAnalysis Structured Output
       ├─ Deterministic Completion Gate
       └─ Human Review Interrupt / Baseline Resume
  → PostgreSQL 业务事实与 Checkpoint
```

OpenAI 文件与视觉输入由 LangChain 的 OpenAI 适配器送入单一模型；TestMesh 负责来源编号、阶段装配、领域 Schema、证据校验和完成判定，不再维护一条直接调用 Responses API 的需求分析路径。

## RA01 数据流

1. 用户上传 PRD、图片或支持的文档。
2. 服务端校验数量、大小和格式，生成稳定来源 ID。
3. 用户发送分析请求。
4. Harness 按 Stage Profile 装配来源、只读工具、Skills、Policy 和固定输出 Schema。
5. LangChain Agent 把文件与图片交给单一多模态模型，返回候选 RequirementAnalysis。
6. Completion Gate 验证结构、来源 ID、定位、冲突证据和来源优先级依据；失败时停在真实失败点。
7. 通过的分析写入 PostgreSQL，工作流暂停等待人工评审；冻结 Baseline 后从 Checkpoint 恢复并完成。

## 安全与成本边界

- API Key 仅从服务端环境变量读取，绝不进入前端构建产物。
- 上传设置明确的格式、数量和大小上限。
- 单次请求限制输出 token；不自动重试或切换模型。
- 上传文件和分析结果不提交到 Git。

## P02 运行结构

```text
OpenAPI JSON/YAML
  └─ operation → TestCase 定义
       ├─ Requirement / Evidence 追溯关系
       └─ uvx Schemathesis 4.24.3
             └─ JUnit → TestRun / 失败复现信息

SQLite（better-sqlite3 12.10.0）
  └─ Requirement / Risk / Evidence / TestCase / TestRun
```

- Header/Auth 仅进入本次 Runner 进程，不持久化。
- generated examples 只归属于 TestRun，不展开成 TestCase。
- JUnit 缺失时 TestRun 标记为 error 并停止，不解析其他报告格式。

## 后续演进边界

- H00 先删除会形成第二条路径的旧 P05/OpenHands 入口，再交付统一 Harness 基础，不调用真实业务模型。
- RA01 把需求分析、人工评审和基线建成第一个正式 Stage Profile，并原位替换旧调用，不保留版本化兼容入口。
- TD01 使用 Requirement Baseline 和人工决策重新建设测试设计，不沿用旧 P05 Agent Loop。
- AT01、AT02 分别完成 API 和 UI 自动化；代码生成是否继续使用 OpenHands，需要在 AT01 前进行单一路径评估。
- FT01 先调查企业内真实可获得的日志、数据库、接口 Trace、代码和测试报告，再设计辅助缺陷定位。
- APP、性能和安全测试暂不继续开发，历史能力不删除。

任何提前接入均视为路线变更，必须先获用户批准。
