# ADR 0005：LangGraph 与 Deep Agents 作为 Harness 基础

- **状态**：已接受
- **日期**：2026-09-17

## 背景

TestMesh 已分别实现需求分析、测试引擎、OpenHands 工程任务和测试用例生成尝试，但缺少统一的任务运行环境。此前 P05 把覆盖规划、生成、审查和终止判断交给单个 Agent Loop，出现了运行时间长、阶段状态不清、模型提前结束而系统仍无法确认完成等问题。

TestMesh 后续需要覆盖需求分析、测试设计、API/UI 自动化以及测试失败后的辅助缺陷定位。不同任务需要不同的上下文、知识、技能、工具、策略和输出 Schema，并且需要在人工评审处暂停，在评审完成后恢复。

## 决策

1. 使用 **LangGraph** 作为唯一 Workflow/Harness Runtime，复用其图执行、Checkpoint、Interrupt、子图、并行和恢复能力。
2. 使用 **Deep Agents / LangChain Agent** 作为 LangGraph 体系内的 Agent Harness；它们不是第二套工作流运行时。
3. 新主线不再把 OpenAI Agents SDK 与 LangGraph 叠加在同一执行路径。已确认错误且没有有效业务产物的旧 P05 Agent 生成链路直接删除，不保留兼容入口。
4. TestMesh 只维护领域层：Stage Profile、Schema、数据适配、证据与追溯校验、完成条件和页面；不自研 Agent Loop、Checkpoint、Workflow Runtime、Skill Loader、通用 Tool Executor 或 Trace/Eval 基础设施。
5. 每个阶段使用独立 Harness Profile。Profile 固定声明允许装配的 Context、Knowledge、Skills、Tools、Policy 和 Schema。
6. Skill 使用渐进披露：阶段先限制候选集合，只暴露元数据；匹配后再加载完整 Skill 与相关脚本、模板。关键测试方法是否适用由确定性规则记录，不能仅依赖模型自由选择。
7. Agent 的“已完成”只代表它提交了候选结果。Harness 需要通过 Schema、证据、追溯、Runner 结果和阶段完成条件后，才把任务标记为完成。
8. PostgreSQL 作为业务数据与 LangGraph Checkpoint 的唯一长期持久化方案。业务表是领域事实来源；Checkpoint 只保存运行状态和业务对象 ID，不复制业务事实。进入数据迁移时一次性切换，不长期维护 SQLite/PostgreSQL 双实现。
9. 需求分析在 RA01 原位替换现有入口；同一变更内删除旧 Responses API 直调代码，不创建 `v1/v2` 接口或兼容读取。

## 新主线

```text
H00 Harness Foundation
  → RA01 Requirement Analysis
  → TD01 Test Design / TestCase
  → AT01 API Automation
  → AT02 UI Automation
  → FT01 Failure Triage Discovery
```

APP、性能和安全测试不进入本轮新主线；既有实现保留为历史能力，不继续扩展。

## 影响

- P05 原 OpenAI Agents SDK 渐进式并行方案及页面/API 直接删除，后续由 TD01 重新设计。
- 旧 OpenHands 工程任务入口删除。AT01 只评估并保留一个 Engineering Harness，不并行维护旧实现。
- 当前真实需求资料在 RA01 数据切换前只作为迁移输入；不为旧协议编写永久兼容层。没有有效产物的旧生成数据可直接清理。
- 每个阶段在进入实现前需要先完成 Profile、Schema、完成条件和失败边界。
