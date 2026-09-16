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
- P04-D 已获用户授权，但于 2026-09-03 阻塞在 ZAP 2.17.0 官方 Crossplatform ZIP 的 Windows Defender 高危检测；文件未解压、ZAP 未运行，详见 `docs/PHASES/P04.md`。
- P05“测试设计与用例生成”已于 2026-09-07 获用户明确授权开始；唯一生成输入是用户重新上传的原始 PRD 与已保存的真实分析结果，原“知识、归因、完整质量门禁与 CI”顺延为 P06。真实分析包含 14 条 Requirement、8 条 Risk 和 29 条 Evidence；旧 13 条低覆盖草稿及 15 条诊断草稿已删除，当前生成型 TestCase 为 0 条。生成不设固定条数，每条用例只要求真实需求分析、原始 PRD 或后续 RAG 命中至少一种且证据数至少 1；当前没有 RAG，不能伪造。用户于 2026-09-11 批准停止 48 回合串行长运行，改为复用官方 OpenAI Agents SDK 的渐进式并行单一路径：一次审阅 PRD 正文和图片，使用短别名形成业务分区，最多 4 个分区并发生成及独立审查，通过后立即保存草稿并向页面推送进度，全局只允许一次定向补齐；并发控制复用 `p-limit`，不自研工作流运行时或质量门禁。首次真实运行约 10 秒出现进度，约 21 秒因来源规划重复分配 R13、R14 而停止，数据库仍为 0 条。未经用户批准固定键单选 Schema 修正与重跑，不得继续真实请求；未经用户评审，不得运行 OpenHands/Playwright。页面展开用例时直接展示需求分析、风险和 PRD 证据的来源、定位与内容。
- 2026-09-15 用户批准先修订 P01 需求分析协议，且确认 Risk 不属于该协议。新分析只使用固定的 `summary/requirements/actors/business_rules/flows/states/constraints/exceptions/open_questions/sources` 十字段 JSON；空类别保持空，不伪造旧记录的 `origin/confidence`。页面报告与 Markdown 导出均由这份 JSON 渲染。现有 P05 测试设计仍读取旧分析 Risk，新协议分析在 P05 模型请求前显式停下，等待测试设计阶段以独立 TestCase Schema 适配；此优先级例外不授权 P05 来源规划修复或重跑。
- 用户随后明确要求不保留旧分析，P05 后续再调整，当前一步一步先完成需求分析。当前数据库两份旧分析已核实并删除，分析数为 0；其中 P02 演示分析的 2 个 API 用例追溯链接随来源删除，但 API 用例本身仍在。原始 16 页 PRD 完整图片已人工审阅。新协议的一次真实请求获得结构化模型结果，但 `SRC-3` 的 PDF 定位类型被过严的本地校验拒绝，未保存分析。PDF 嵌入图片的定位判断已在同一路径修正并通过 36 项测试、lint 和 build；未经用户再次批准，不得重试真实 OpenAI 请求。P05 保持暂停，不进行来源规划修复或用例生成。
- 2026-09-15 用户批准一次定向重分析；正式代理路径返回 HTTP 200，已保存唯一新版分析 `7f8d148a-d38e-4620-8f62-016df329bfd1`，含 15 项需求、5 个角色、7 条业务规则、6 条流程、4 组状态、5 项约束、5 项异常、9 个待确认问题和 26 条原文来源，其中 8 条定位到 PDF 图片。已增加页面读取已保存报告的单一路径，无须重复发模型请求；自动检查通过，但内置浏览器出现空白页面，页面体验尚未验收。`OQ-001` 将原文歧义标为 `conflict`，保留原 JSON 供用户评审，不擅自改写。P05 继续暂停，不因这次批准运行用例生成。
- 用户刷新 Chrome 后确认白屏。Chrome 控制台定位到 `hasOfficeLocationLimit is not defined`：改写报告组件时误删了上传辅助函数，构建命令仅打包而未执行客户端类型检查。已恢复 `hasOfficeLocationLimit` 和 `fileObject`，增加首屏渲染回归测试，并把现有 TypeScript 检查接进客户端构建；37 项测试、lint、build 通过。在用户当前 Chrome 标签实测工作台、已保存报告、原文引用跳转及报告滚动，修复后的构建没有新脚本错误。Markdown 导出和用户报告评审仍待完成，新版 P01 不标记全部验收；P05 继续暂停。
- 2026-09-15 用户批准继续补齐 P01 的人工评审、缩减导出、决策回写、基线和持久化；飞书因无权限明确搁置。评审事件按条目追加，原分析 JSON 不改；原文件字节与 SHA-256、获批 PRD 与冻结快照保存于现有 SQLite。当前 PRD 的原文件在分析后补录，页面标明不能证明与当时上传字节相同。现有报告待用户实际评审，暂无需求基线；不能把本地模拟测试说成已完成正式评审。来源优先级默认不存在，明确规则作为带原文引用的业务规则；跨文件冲突保留双方证据，在人工评审时决策并写入获批 PRD。最终 41 项测试、lint 和 build 通过。用户说明个人项目仅企业内部使用，本次不扩展网络/权限方案。P05 仍暂停，P04-D 安全阻塞不变。
- 2026-09-15 核对 P01 图片/流程图参与分析：独立 PNG/JPEG/WEBP/静态 GIF 作为高细节 `input_image`，PDF 作为高细节 `input_file` 由 OpenAI 提取正文和页面图像；Markdown 等纯文本由服务端编号，Word/Office 非 PDF 文件由 OpenAI 只抽取文本，内嵌图不进入模型。所有来源汇入同一次固定 RequirementAnalysis 输出；视觉/文件块前增加来源 ID 与文件名标记，中文原生文件名误转码已修正。数据库现有报告含 8 条图片定位来源、18 条页码定位来源；不以此证明未来任意 Word 内嵌图或任意视觉判断都正确。当前没有独立 OCR 流水线，飞书继续搁置。42 项测试、lint、build 通过；本次未重新发送付费模型请求，P05 保持暂停。
- 2026-09-16 人工评审弹窗已内嵌留存的独立图片和 PDF 图片页，PDF 跨页引用可翻页，仍可打开原文件；原文件缺失、定位受限及分析后补录的一致性限制均明确显示。不增加自研 OCR、图像裁剪或证据高亮。浏览器已核对当前 PDF 第 1-3 页及弹窗滚动，独立图片和窄屏仍待真实体验；未保存评审决定、未发模型请求。45 项测试、lint、build 通过；P05、飞书及 P04-D 状态不变。
- 2026-09-16 需求分析协议继续拆分来源与问题分类：公共 `origin` 只允许 `explicit/inferred`；`open_questions[]` 单独增加 `issue_type=missing/ambiguity/conflict`。歧义至少关联一处原文，冲突至少关联两处相互矛盾的原文，缺失在确无材料时可不引用。人工评审仍保存独立的问题分类复核，不覆盖 AI 字段。现有真实报告使用旧混合协议，原 JSON 不自动迁移、不补造 `issue_type`；本地接口返回 HTTP 409 和重新分析提示，库内旧值保持不变。46 项测试、lint、build 通过，未发模型请求；P05 保持暂停。
- P04-D 仍等待官方 ZAP 文件下载与安全复核；在满足已批准的恢复条件前，不得绕过 Defender、替换安装包、改用 Docker/Installer 或继续 P04-D 真实运行。用户已明确批准在该等待期间先执行 P05，这是一次已记录的阶段顺序例外，不得据此提前进入 P06。

## P01 实现约束

- 工作台：Refine + Ant Design，参考 Ant Design Pro 的企业后台布局与视觉。
- AI Chat：薄 UI，支持文本、图片和文件上传。
- AI：服务端直接调用 OpenAI Responses API；不得把 API Key 暴露到浏览器。
- 模型：单一模型配置，不自动改用其他模型。
- 输出：新需求分析固定十字段 RequirementAnalysis JSON，顶层为 `summary/requirements/actors/business_rules/flows/states/constraints/exceptions/open_questions/sources`；各非空条目含 `id/description/origin/source_refs/confidence`，公共 `origin` 只表达来源并取 `explicit/inferred`，`open_questions[]` 另含 `issue_type=missing/ambiguity/conflict`。没有内容时 summary 为 `null`、数组为空。Risk 与 TestCase 属于测试设计阶段，不在需求分析里补造。
- `sources[]` 原文引用关联上传来源；能可靠定位时给出页码/段落/图片，不能定位时明确标记定位限制，不得输出伪造定位。页面报告和 Markdown 导出只从同一 JSON 渲染。
- Chat Attachment 与 Project Knowledge 在概念和界面上分开；P01 只实现完成分析闭环的最小存储。
- 不引入 Open WebUI、Langflow、Temporal、Keploy、Playwright、Appium、k6、ZAP 或其他后续阶段能力。

## 变更与验证

- 优先最小修改；测试通过即停止。
- 不提交密钥、上传文件、构建产物或本地环境文件。
- API 失败必须向用户显示真实、可行动的错误，不得生成假分析结果。
- 代码变更必须通过仓库已有的 lint、测试和 build 命令；不得为“绿灯”跳过失败检查。
