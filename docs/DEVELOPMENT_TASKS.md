# TestMesh 新主线开发任务

本清单按依赖顺序执行。只有当前任务验收通过后才进入下一项；失败时停在失败点，不自动换框架或保留备用路径。

## H00 — Harness Foundation

| 任务 | 内容 | 验收结果 | 状态 |
| --- | --- | --- | --- |
| H00-01 | 接受 Harness ADR，重排 Roadmap，固定职责与范围 | ADR、阶段文档、任务清单一致 | 已完成 |
| H00-01A | 删除旧 P05 Agent 生成与旧 OpenHands 工程入口 | 无旧页面、API、依赖或可执行入口 | 已完成 |
| H00-02 | 接入 LangGraph 最小运行时 | 无模型测试图可以执行、暂停、恢复 | 已完成 |
| H00-03 | 定义 Stage Profile 与任务/产物协议 | 六类装配项、版本、状态均有 Schema | 已完成 |
| H00-04 | 实现能力装配与完成条件 | 未授权能力不可见；Agent 自报完成不能绕过 Gate | 已完成 |
| H00-05 | 接入 Checkpoint 与运行记录 | PostgreSQL Checkpointer 验收；业务数据与运行状态分离 | 已完成 |
| H00-06 | 接入框架 Trace/Eval 最小路径 | 可以查看一次运行的节点、工具和失败位置 | 已完成 |
| H00-07 | H00 集成验收 | 自动检查和一条无付费模型端到端运行通过 | 已完成 |

## RA01 — Requirement Analysis

| 任务 | 内容 | 验收结果 | 状态 |
| --- | --- | --- | --- |
| RA01-01 | 固定 Requirement Analysis Stage Profile | 明确 Context、Knowledge、Skills、Tools、Policy、Schema | 已完成 |
| RA01-02 | 迁移多文件与图片 Source Reader | PRD、PDF 页面图、独立图片和补充资料均可追溯 | 已完成 |
| RA01-03 | 迁移 RequirementAnalysis Agent | 输出继续使用固定十字段 Schema | 已完成 |
| RA01-04 | 引用与完成条件校验 | 无证据、伪造来源、错误冲突引用均不能完成 | 已完成 |
| RA01-05 | 人工 Review、决策回写与 Baseline 恢复点 | 可跨时间暂停和继续，不覆盖原分析 | 已完成 |
| RA01-06 | 数据切换与真实验收 | 一次性迁移或清理旧数据，完成真实多模态闭环，不保留兼容读取 | 已完成 |

## TD01 — Test Design / TestCase

| 任务 | 内容 | 验收结果 | 状态 |
| --- | --- | --- | --- |
| TD01-01 | 固定 TestDesign、Risk、TestPoint、TestCase Schema | 与 RequirementAnalysis 分离 | 待 RA01 |
| TD01-02 | 固定 Test Design Stage Profile | 只读取 Baseline、范围、人工决策和获准知识 | 待 RA01 |
| TD01-03 | 接入测试设计 Skills | 按任务加载等价类、边界值、判定表、状态迁移等；不适用有理由 | 待 RA01 |
| TD01-04 | 覆盖矩阵与追溯 Gate | Requirement/Test Point/TestCase/证据可回链，无静默遗漏 | 待 RA01 |
| TD01-05 | 人工 Review 与 Approved TestCase | 驳回/合并不进入后续，批准项形成不可覆盖版本 | 待 RA01 |
| TD01-06 | 真实需求验收 | 数量不设上限，质量与完成由证据和 Gate 判断 | 待 RA01 |

## AT01 — API Automation

| 任务 | 内容 | 验收结果 | 状态 |
| --- | --- | --- | --- |
| AT01-01 | 固定 API Automation Stage Profile | 只接收 Approved TestCase、目标仓库和必要代码上下文 | 待 TD01 |
| AT01-02 | 选择单一成熟 Engineering Harness | 不同时维护 OpenHands 与另一套代码 Agent | 待 TD01 |
| AT01-03 | 生成和验证 API 自动化 | 代码变更回链 TestCase，使用既定 Runner 真实执行 | 待 TD01 |
| AT01-04 | 人工验收 | 不自动 commit/push，保存 Diff 和 Runner 证据 | 待 TD01 |

## AT02 — UI Automation

| 任务 | 内容 | 验收结果 | 状态 |
| --- | --- | --- | --- |
| AT02-01 | 固定 UI Automation Stage Profile | 只装配 Approved TestCase、目标页面和仓库上下文 | 待 AT01 |
| AT02-02 | Playwright Skill 与现有代码检索 | 优先复用 Page Object 和既有组件 | 待 AT01 |
| AT02-03 | 生成、调试和 Runner 验证 | Harness 根据真实 Playwright 结果判定完成 | 待 AT01 |
| AT02-04 | 人工验收 | 保存 Diff、Trace、截图/视频与 TestCase 回链 | 待 AT01 |

## FT01 — 辅助缺陷定位调研

| 任务 | 内容 | 验收结果 | 状态 |
| --- | --- | --- | --- |
| FT01-01 | 调研企业内可获得的失败上下文 | 明确日志、数据库、接口 Trace、代码和测试报告的真实来源 | 待 AT02 |
| FT01-02 | 定义 FailureTriage Schema 和证据边界 | 区分事实、推断、候选原因和待补证据 | 待调研 |
| FT01-03 | 选择日志/数据库/代码检索成熟能力 | 不自研日志平台、数据库代理或通用检索基础设施 | 待调研 |
| FT01-04 | 最小闭环 | 从一次失败 TestRun 生成有证据的候选定位，不自动断言根因 | 待调研 |

## 本轮排除项

- APP 自动化的新开发。
- 性能测试的新开发。
- 安全测试的新开发。
- 自动 commit、push、合并代码。
- 在 FT01 调研完成前预设日志平台、数据库读取方式或根因算法。
