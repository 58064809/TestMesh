# TestMesh 工程规则

本文件适用于整个仓库。所有人和自动化 Agent 在开始任务前必须阅读本文件以及当前阶段文档。

## 最高优先级规则

1. **Reuse-first（尽量不自研）**：成熟开源组件能满足需求时必须优先集成。禁止重造 Agent Loop、Harness Runtime、Checkpoint/Recovery、Workflow Runtime、Tool Executor、Browser/API Runner、RAG 基础设施、Trace/Eval 等成熟能力。
2. **Single-path MVP（MVP 单一路径）**：每项能力只保留一条实现路径。不得同时维护主方案、降级方案、兼容方案或备用实现。
3. **No silent fallback（禁止静默降级）**：既定方案失败时立即停在失败点，报告失败原因、影响、可选方案和推荐方案。未经用户明确批准，不得替换技术方案、使用 mock 顶替、加入 fallback 或保留第二套实现。
4. **禁止过度开发**：只实现当前阶段验收闭环所需内容；不为未来阶段提前抽象、引入基础设施或顺手重构。
5. **Roadmap 连续性**：阶段规划必须持久化在 `docs/ROADMAP.md` 和 `docs/PHASES/`。完成当前阶段后，只能进入已规划的下一阶段；调整顺序或插入路线必须先获用户批准。

## 当前阶段

- P01 已于 2026-09-01 完成，验收记录见 `docs/PHASES/P01.md`。
- P02 已于 2026-09-01 完成，验收记录见 `docs/PHASES/P02.md`，实现路径见 ADR 0004。
- P03 已于 2026-09-02 完成，验收记录见 `docs/PHASES/P03.md`。
- P04-A Playwright UI 测试闭环已于 2026-09-02 完成，验收记录见 `docs/PHASES/P04.md`。
- P04-B Android Emulator + Appium 测试闭环已于 2026-09-03 完成，验收记录见 `docs/PHASES/P04.md`。
- P04-C k6 性能测试闭环已于 2026-09-03 完成，验收记录见 `docs/PHASES/P04.md`。
- P04 仍在进行中；P04-D ZAP 是已规划的下一入口，但尚未获得用户授权。P04-D 与 P05 仅允许维护规划文档，不得提前实现。

## P01 实现约束

- 工作台：Refine + Ant Design，参考 Ant Design Pro 的企业后台布局与视觉。
- AI Chat：薄 UI，支持文本、图片和文件上传。
- AI：服务端直接调用 OpenAI Responses API；不得把 API Key 暴露到浏览器。
- 模型：单一模型配置，不自动改用其他模型。
- 输出：结构化 Requirement、Risk、Pending Question、Evidence。
- Evidence 必须关联上传来源；能可靠定位时给出页码/段落/图片，不能定位时明确标记定位限制，不得输出伪造定位。
- Chat Attachment 与 Project Knowledge 在概念和界面上分开；P01 只实现完成分析闭环的最小存储。
- 不引入 Open WebUI、Langflow、Temporal、Keploy、Playwright、Appium、k6、ZAP 或其他后续阶段能力。

## 变更与验证

- 优先最小修改；测试通过即停止。
- 不提交密钥、上传文件、构建产物或本地环境文件。
- API 失败必须向用户显示真实、可行动的错误，不得生成假分析结果。
- 代码变更必须通过仓库已有的 lint、测试和 build 命令；不得为“绿灯”跳过失败检查。
