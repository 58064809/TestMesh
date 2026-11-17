# AIAT01 — AI 应用执行与证据契约

状态：执行契约与确定性证据 Gate 已实现；真实目标 Agent 和 Phoenix Experiment 尚未接入。

## 目标

在不新增第二套 AI Harness 的前提下，把 Testing for AI 接入现有链路：

`Approved AI TestCase → FastAPI YAML/TestRun → OpenInference Trace → Phoenix Dataset/Experiment/Evaluator → OPA`。

本阶段只实现目标应用执行契约和可验证证据边界。没有真实目标 URL、真实 Dataset Version 和 Experiment 时，不生成通过证据。

## 成熟能力边界

- TestMesh：业务 ID、Approved TestCase 关联、目标 Agent/版本、数据驱动、请求编排、确定性断言、TestRun、人工审核、质量门禁。
- OpenTelemetry + OpenInference：会话、Agent、LLM、Retriever、Tool、Guardrail、Evaluator 等 Trace 语义。
- Phoenix：版本化 Dataset、Experiment、Evaluator、Annotation、比较和 Trace 查看。
- OPA/Rego：消费 TestMesh 事实及 Phoenix 外部证据，输出 allow/review/deny。

## 已实现

YAML 新增可选 `ai_application`：

- `target_id`、`target_version`：防止测试结果脱离被测版本。
- `interaction`：`single_turn`、`multi_turn`、`agent`。
- `session_id_variable`：多轮/Agent 必填；每个数据行使用隔离上下文。
- `trace_id_variable`、`require_trace`：要求目标应用回传真实 OpenTelemetry Trace ID。
- `observability_standard`：固定 `openinference`。
- `evaluation_provider`：固定 `phoenix`。
- `evaluator_names`：声明质量计划所需评估器，不冒充评测结果。

执行结束时增加“AI 应用证据契约”确定性检查。缺少会话 ID 或合法 Trace ID，TestRun 失败。该检查不调用 LLM，不以语义猜测代替证据。

## 验证证据

- FastAPI 单元/隔离测试 23 项通过。
- 覆盖同一 HTTP Runner 的 AI 单轮执行、Trace 提取、Phoenix Evaluator 要求展示。
- 覆盖多轮缺少 session/trace 的失败行为。
- 覆盖多轮配置未声明 session 变量的 schema 拒绝。

## 下一步

AIAT02 将把当前 Approved AI TestCase 映射为 Phoenix Dataset Version。映射必须保存 Approved TestCase Version/ID；重复导出应可识别，Phoenix 保持 Dataset 的唯一事实来源。真实 Experiment 尚未完成前，OPA 继续 deny。

## 依据

- Phoenix Dataset 概念：https://arize.com/docs/phoenix/learn/datasets-and-experiments/datasets-concepts
- OpenInference 规范：https://github.com/Arize-ai/openinference/blob/main/spec/README.md
- OpenInference 语义约定：https://github.com/Arize-ai/openinference/blob/main/spec/semantic_conventions.md
