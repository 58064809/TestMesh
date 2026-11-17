# AIAT03 — Approved AI YAML → Phoenix Experiment 执行层

状态：执行准备度、正式启动门禁和 Phoenix Experiment 编排已实现；当前真实项目同时缺少 `evaluation-dataset`、目标 Agent 契约和已批准 AI YAML，未启动 Experiment。

## 目标与边界

复用现有链路，不建立第二套 AI Harness：

`Approved AI TestCase → Phoenix Dataset Version → 人工批准 FastAPI YAML → 目标 Agent → OpenInference Trace → Phoenix Experiment`。

- FastAPI YAML 继续负责 HTTP 请求、数据驱动、会话变量、确定性断言和 TestRun。
- Phoenix 官方客户端继续负责 Dataset Version、Experiment、任务运行和 Evaluator 结果。
- TestMesh 只保存业务 ID、外部 Experiment ID、目标版本和执行摘要。
- 本阶段的两个代码 Evaluator 只判断 YAML TestRun 是否通过、会话/Trace 契约是否通过，不替代意图、正确性、幻觉、工具轨迹等业务 Evaluator。
- 因此成功运行仍标记为 `execution-only`、`gateEligible=false`；只有 AIAT04 完成全部必需 Evaluator 后才能形成准入候选证据。

## 已实现

1. 对每个 Phoenix Dataset 映射检查 49 条冻结 AI TestCase 是否唯一关联已批准 YAML。
2. YAML 必须声明 `ai_application`，且目标 ID/版本、交互模式、会话、OpenInference Trace 和 Phoenix Evaluator 契约合法。
3. 缺失映射、重复映射或无效契约时，服务端返回阻塞原因；前端按钮不可用，后端也返回 409，不存在绕过入口。
4. 准备度通过后，Phoenix `runExperiment` 按固定 Dataset Version 逐样本调用对应的已批准 FastAPI YAML 场景。
5. Experiment 映射表只保存官方 Phoenix Experiment ID、Dataset/Version ID、目标版本、运行数量、操作人和时间。

## 当前真实检查结果

- Dataset Version：`RGF0YXNldFZlcnNpb246Mw==`。
- 该版本现已明确归类为 `test-plan-manifest`，不能冒充实际输入样本集。
- 冻结 AI TestCase：49 条。
- 有效 AI YAML 执行资产：0 个。
- 已建立唯一映射：0/49。
- 现有“本机受控售后业务链”是传统 API 场景，没有 `ai_application`，不会被误算为 AI Experiment 证据。
- 正式启动请求被服务端以 HTTP 409 拒绝；Phoenix 没有被写入虚假 Experiment。

当前阻塞不是代码故障，而是缺少真实目标 Agent URL/API 契约、请求/响应字段、会话字段、Trace 字段和可执行测试数据。不能从 PRD 中猜测这些接口细节。

## 验证

- Dataset 映射和 AIAT03 准备度相关测试：8 项通过。
- 覆盖完整映射、缺失脚本、无效契约、重复映射、确定性执行判断和并发/操作人边界。
- 客户端与服务端生产构建通过。
- 真实 PostgreSQL/HTTP 检查返回 49 条缺失和 1 个非 AI 场景，不产生 Experiment 记录。

## 下一步

1. 项目 RAG/契约来源绑定已完成；当前等待真实 OpenAPI 与 Agent 会话/Trace 契约入库并绑定，不采用执行页面临时上传。
2. 由 Agent 基于 API 契约和 Approved AI TestCase 生成 YAML 候选；人工可修正，校验后批准冻结。
3. 映射达到 49/49 后启动 Phoenix Experiment。
4. AIAT04 实现按 `ai_evaluation` 注册的代码 Evaluator、经基准验证的 LLM Judge 和人工抽检，并把逐样本失败回链 FailureTriage。
