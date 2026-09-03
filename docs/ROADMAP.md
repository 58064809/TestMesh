# TestMesh Roadmap

## 状态定义

- `进行中`：唯一允许实施代码的阶段。
- `已规划`：只维护文档，不得提前实现。
- `已完成`：全部验收标准已验证并记录。
- `阻塞`：既定路径失败，等待用户决策；不得自行降级。

## 阶段总览

| 阶段 | 目标 | 状态 | 下一阶段入口 |
| --- | --- | --- | --- |
| P01 | 统一工作台中的 PRD 多模态需求分析闭环 | 已完成 | 获得用户明确授权后进入 P02 |
| P02 | 领域模型与 OpenAPI API 测试闭环 | 已完成 | 获得用户明确授权后进入 P03 |
| P03 | 接入 OpenHands 与工程上下文 | 已完成 | 获得用户明确授权后进入 P04 |
| P04 | 扩展 UI、APP、性能与安全测试 | 进行中（P04-A、P04-B 已完成） | 获批后进入 P04-C；P04 全部验收通过后进入 P05 |
| P05 | 检索、失败归因、质量门禁、完整回归与 CI | 已规划 | 路线完成，后续规划须重新批准 |

## P01 — 统一工作台与 PRD 多模态分析

- **目标**：让用户在统一中文工作台上传 PRD/截图并获得有证据的结构化需求分析。
- **范围**：Refine + Ant Design Shell、AI Chat、文本/图片/文件上传、最小 Project Knowledge、OpenAI Responses API、Requirement/Risk/Pending Question/Evidence 展示。
- **验收标准**：进入工作台 → 打开 AI Chat → 上传包含文本或图片的 PRD → 输入“帮我分析这个需求” → 获得结构化结果 → Evidence 可关联来源；定位不可靠时显式说明。
- **明确不做**：UI/API 自动化、知识库增强、长流程编排、后续引擎、模型 fallback。
- **依赖**：Node.js、Refine、Ant Design、OpenAI SDK、有效 `OPENAI_API_KEY` 与可用的单一模型。
- **下一阶段入口**：全部自动检查和一次真实多模态闭环通过，P01 标记已完成，用户批准继续。
- **状态**：已完成。2026-09-01 使用真实多模态 PDF 完成受控验收：输出 15 条需求、10 条风险、10 个待确认问题和 20 条可按页追溯的证据；中文文件名显示正确；本次共 51,582 tokens。lint、7 项测试、production build 与生产依赖审计均通过。

## P02 — 领域模型与 API 测试闭环

- **目标**：建立 Requirement/Risk/Evidence/TestCase 数据模型并完成 OpenAPI 到 TestRun 的单一路径。
- **范围**：领域模型、OpenAPI 导入、Schemathesis 执行、结果与证据回写。
- **验收标准**：从 OpenAPI 生成并运行 Schemathesis 测试，TestRun 可追溯到 Requirement/TestCase/Evidence。
- **明确不做**：UI、APP、性能、安全测试；OpenHands 工程 Agent；复杂工作流运行时。
- **依赖**：P01 已完成；Schemathesis 可用；P02 数据模型 ADR 获批准。
- **下一阶段入口**：API 闭环验收通过并获得继续授权后进入 P03。
- **状态**：已完成。2026-09-01 使用有效 OpenAPI 和本地真实 HTTP 服务完成闭环验收；TestRun 保存 Schemathesis 失败的 operation、checks、request、response 与 reproduction。完整记录见 `docs/PHASES/P02.md`。

## P03 — OpenHands 与工程上下文

- **目标**：复用 OpenHands，把 Repo/Code/Log/Terminal/Docker 上下文接入 TestMesh。
- **范围**：OpenHands 集成、工程上下文选择与查看、分析任务的上下文关联。
- **验收标准**：用户可选择仓库并让 OpenHands 基于代码、日志、终端和 Docker 上下文完成批准的工程任务，结果可追溯。
- **明确不做**：自研 Agent Loop/Harness/Checkpoint；P04 测试引擎；P05 质量门禁。
- **依赖**：P02 已完成；OpenHands 的部署与授权方案获批准。
- **下一阶段入口**：工程上下文闭环通过并获得继续授权后进入 P04。
- **状态**：已完成。2026-09-02 使用 OpenHands Agent Server 1.44.0 与 TypeScript Client 1.39.0 完成真实工程任务验收；Agent 在只挂载所选仓库的一次性 Docker 容器中执行 `pwd && git status --short --branch`，返回 `/workspace`、`## main` 和退出码 0。共保存 17 条真实 Agent Event、终端证据、最终结论、Token/Cost 与 Git Diff；未暴露 API Key，仓库无改动，容器已清理。详见 `docs/PHASES/P03.md`。

## P04 — 多类型测试引擎

- **目标**：扩展 UI、APP、性能和安全测试，并复用各自成熟引擎。
- **范围**：Playwright、Appium、k6、ZAP 的单一适配路径及统一 TestRun/Evidence 展示。
- **验收标准**：四类测试各有一条可运行、可追溯、失败透明的端到端路径。
- **明确不做**：重写引擎能力；并行引擎或备用 Runner；P05 检索与 Quality Gate。
- **依赖**：P03 已完成；各引擎版本和部署方式逐项批准。
- **下一阶段入口**：四类路径全部验收并获得继续授权后进入 P05。
- **状态**：进行中。P04-A Playwright UI 测试已于 2026-09-02 完成；P04-B Android Emulator + Appium 已于 2026-09-03 完成真实通过/失败闭环验收，JUnit TestRun、失败截图、页面源、Appium 日志、单会话和服务清理均已验证。详见 `docs/PHASES/P04.md`。P04-C k6 与 P04-D ZAP 未授权，不得实施。

## P05 — 质量治理与持续回归

- **目标**：把历史知识、失败归因和质量决策接入完整回归与 CI。
- **范围**：知识库、历史缺陷与用例检索、Failure Triage、Quality Gate、完整回归、CI。
- **验收标准**：一次 CI 回归可使用历史证据辅助归因，并输出可解释、可追溯的 Quality Gate 结果。
- **明确不做**：未批准的新测试类别、自研通用 RAG/Trace/Eval/Workflow 基础设施、平行实现。
- **依赖**：P04 已完成；检索和 CI 方案获批准。
- **下一阶段入口**：路线完成；任何新增阶段必须先更新 Roadmap 并获得用户批准。
- **状态**：已规划。

## 路线变更规则

阶段顺序和单一路径允许显式调整，但必须先报告变更原因、影响、选项和推荐方案，等待用户批准后再更新本文档。禁止擅自改序或插入平行路线。
