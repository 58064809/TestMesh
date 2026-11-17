# AIAT04 — 项目契约发现与 AI 脚本候选

状态：项目 RAG/契约来源绑定已实现；当前项目无已索引知识文档，因此脚本生成保持阻塞。

## 已完成

- 项目配置可从现有知识库选择已完成索引的文档，不在 API/AI 执行页面重复上传。
- 每个绑定必须声明用途：`openapi`、`agent_contract`、`business_rules` 或 `test_data`。
- 文档仍由 Docling 解析、Qdrant 检索；TestMesh 只保存项目、文档 ID、用途、操作人和版本证据。
- 同一项目、文档和用途不能重复绑定；未完成索引的文档不能绑定。
- 解除绑定只删除业务关系，不删除知识库原文和向量，避免破坏其他项目证据。
- 契约准备度读取 PostgreSQL 中保存的完整原文件并执行 OpenAPI 结构校验；Qdrant chunk 不参与可执行契约重建。
- 只有至少一份有效 OpenAPI 和一份 Agent 会话/响应/Trace 契约同时存在时，脚本生成才可进入下一阶段。

## 当前真实状态

- 当前项目知识文档：0。
- 当前项目契约绑定：0。
- AI YAML 候选生成保持阻塞，不根据 PRD 猜测 URL、路径、请求字段、会话 ID 或 Trace ID。
- 页面和服务端均显示两个具体阻塞项：缺少有效 OpenAPI 原文件、缺少 Agent 会话与 OpenInference Trace 契约。

## 下一步

1. 将真实 OpenAPI 和 Agent 会话/Trace 契约进入通用知识库。
2. 在“项目质量管理 → 项目与环境 → 项目 RAG / 契约来源”绑定用途。
3. 使用完整原始 OpenAPI 做结构校验；Qdrant 只负责发现和检索，不使用分块文本拼接可执行契约。
4. Agent 生成 FastAPI YAML 候选，人工修正、校验和批准后，才进入 AIAT03 Phoenix Experiment。
5. 根据每条 AI TestCase 的样本要求建立带实际输入、期望输出、标签、会话初始状态和所属 TestCase ID 的 `evaluation-dataset`；冻结评测计划清单不得直接运行目标 Agent。
