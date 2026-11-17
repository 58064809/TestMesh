# AIAT02 — Approved AI TestCase → Phoenix Test Plan Manifest

状态：已完成真实本地 Phoenix Dataset 同步与业务回链。该 Dataset 明确属于 `test-plan-manifest`，保存冻结 TestCase、Oracle、门槛和样本要求，不是可直接运行目标 Agent 的评测语料集。

## 边界

- Phoenix 是 Dataset、Dataset Version、Example 和后续 Experiment 的唯一事实来源。
- TestMesh 只保存 Approved TestCase Version、Dataset/Version 外部 ID、内容 SHA-256、样本数、AI 维度、操作人和时间。
- 同一 Approved TestCase Version 与相同内容哈希重复同步时直接复用映射，不创建重复版本。
- Dataset 成功不代表目标 Agent 通过；计划清单不能直接进入目标 Experiment。必须先把每条 TestCase 的 `dataset_requirements` 展开为真实 `evaluation-dataset` 样本。

## 映射规则

每条带 `ai_evaluation` 的冻结 TestCase 映射为一个 Phoenix Example：

- `input`：TestCase ID、标题、目标、前置条件、测试数据、步骤和 Gherkin。
- `output`：期望行为、Oracle 类型、门槛和可选参数提取期望。
- `metadata`：Approved TestCase Version/ID、AI 维度、Evaluator、优先级、Requirement/Source 引用、Dataset 与证据要求。
- `splits`：`approved`、AI 维度、优先级。

## 真实结果

- Approved TestCase Version：`6118917d-765a-4c5a-a655-7298aec0db5e`（v2）。
- AI TestCase：49 条，共 9 个 AI 维度。
- Dataset ID：`RGF0YXNldDoz`。
- Dataset Version ID：`RGF0YXNldFZlcnNpb246Mw==`。
- 内容 SHA-256：`ea9110720a4c4d0b681b0e3cfc5c3db65c3fe92fa0d68792f2799d21cf507f8f`。
- 操作人：路昭凡。
- Phoenix 反查确认：49 个 Example，Dataset 名称和 Version ID 与 TestMesh 映射一致。
- 第二次同步返回同一 TestMesh 映射、Dataset ID 和 Version ID，未生成重复版本。

第一次真实同步在 Phoenix 已完成后，TestMesh PostgreSQL JSONB 写入因数组序列化错误被拒绝；没有保存成功记录。修复后复用同名 Dataset 完成映射。该失败不删除，作为集成门禁发现问题的记录。

## 验证

- AIAT02 映射、无 AI 用例拒绝、幂等复用：3 项测试通过。
- 质量管理与报告回归：7 项通过。
- FastAPI：23 项通过。
- OPA：通过。
- ESLint 与生产构建：通过。

## 下一步

AIAT03 使用同一 FastAPI YAML Runner 对接真实目标 Agent Contract，按 Dataset Example 执行单轮/多轮会话并采集 OpenInference Trace。没有真实目标 URL 时只实现适配和受控 Mock 验证，不生成业务验收结论。
