# AIAT05 — 可执行 AI 评测样本生命周期

## 目标

把“Approved AI TestCase 评测计划清单”和“可以发送给目标 AI 的真实评测数据”分开管理，避免把用例描述、Oracle 说明或“待配置”内容冒充 Dataset 通过证据。

## 成熟能力边界

- Phoenix 继续作为 Dataset Version、Experiment、Evaluator 和结果的事实来源。
- TestMesh 只管理业务生命周期：Approved TestCase 回链、候选样本、人工修正、接受/拒绝、覆盖检查、冻结哈希和 Phoenix ID 映射。
- 不新增 AI Harness；后续 Experiment 仍复用 FastAPI YAML 执行引擎和 `ai_application` 契约。
- Agent 可以提出候选样本，但不能自行批准、冻结或改变发布门禁。

## 数据生命周期

1. 选择一个 Approved TestCase Version 创建草稿样本集。
2. 每条样本必须关联当前版本中的一个 AI TestCase，并保存真实输入、可判定期望、维度、工具约束、Fixture 与来源引用。
3. 人工可以修改样本；修改后状态自动回到 `draft`。
4. 人工逐条 `approved` 或 `rejected`；拒绝必须填写原因。
5. 只有所有 AI TestCase 均至少有一条已接受样本，且没有未评审样本，样本集才能冻结。
6. 冻结后计算确定性 SHA-256，并禁止修改。
7. 只有冻结版本可以同步 Phoenix，数据类别固定为 `evaluation-dataset`。

## 质量规则

- 禁止保存包含“待配置 / 待补充 / TODO / TBD / placeholder”的输入或期望。
- 单轮样本必须有 `message`；多轮样本使用 `conversation`。
- `multi_turn_context` 至少需要两个会话轮次。
- `tool_selection`、`tool_invocation` 必须声明预期工具或禁止工具。
- `expected` 至少包含一个可由确定性断言或 Phoenix Evaluator 判定的字段。
- 样本设计覆盖不等于执行通过；未产生 Experiment/Evaluator 证据前，OPA 发布门禁保持不通过。

## 当前状态

当前真实项目没有目标 Agent 语料、业务 Fixture 和已绑定契约，因此样本集保持为空。页面明确提示阻断原因，不自动生成或写入演示数据。

## 验证

- `tests/ai-evaluation-samples.test.ts`
- `tests/ai-dataset-export.test.ts`
- `tests/ai-experiment-readiness.test.ts`
- 前后端生产构建与 ESLint
- 页面人工验收：AI 质量评估 → 真实 AI 评测样本集
