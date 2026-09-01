# ADR 0001：Reuse-first

- **状态**：已接受
- **日期**：2026-09-01

## 背景

TestMesh 需要覆盖需求分析、工程上下文和多类测试能力。重复建设成熟基础设施会扩大代码量、维护面和可靠性风险。

## 决策

成熟开源组件能满足阶段验收时必须优先集成。TestMesh 只实现统一体验、领域边界与必要适配，不重造 Agent Loop、Harness Runtime、Checkpoint/Recovery、Workflow Runtime、Tool Executor、Browser/API Runner、RAG 基础设施、Trace/Eval 等能力。

## 影响

- 新增能力前必须先评估成熟组件。
- 自研仅在现有能力无法满足且用户明确批准后进行。
- P01 复用 Refine、Ant Design 和 OpenAI 官方 SDK。

