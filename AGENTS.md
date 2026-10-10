# TestMesh 工程规则

本文件适用于整个仓库。所有人和自动化 Agent 在开始任务前必须阅读本文件以及当前阶段文档。

## 最高优先级规则

1. **Reuse-first（尽量不自研）**：成熟开源组件能满足需求时必须优先集成。禁止重造 Agent Loop、Harness Runtime、Checkpoint/Recovery、Workflow Runtime、Tool Executor、Browser/API Runner、RAG 基础设施、Trace/Eval 等成熟能力。
2. **Single-path MVP（MVP 单一路径）**：每项能力只保留一条实现路径。不得同时维护主方案、降级方案、兼容方案或备用实现。
3. **No silent fallback（禁止静默降级）**：既定方案失败时立即停在失败点，报告失败原因、影响、可选方案和推荐方案。未经用户明确批准，不得替换技术方案、使用 mock 顶替、加入 fallback 或保留第二套实现。
4. **禁止过度开发**：只实现当前阶段验收闭环所需内容；不为未来阶段提前抽象、引入基础设施或顺手重构。
5. **Roadmap 连续性**：阶段规划必须持久化在 `docs/ROADMAP.md` 和 `docs/PHASES/`。完成当前阶段后，只能进入已规划的下一阶段；调整顺序或插入路线必须先获用户批准。

## 历史阶段记录（当前执行规则见下方）

- 2026-09-17 用户批准重排 TestMesh 主线：先建设 Harness Foundation，再依次进行 Requirement Analysis、Test Design/TestCase、API Automation、UI Automation，最后调研辅助缺陷定位；APP、性能和安全测试不进入本轮新开发。新主线采用 `H00 → RA01 → TD01 → AT01 → AT02 → FT01`，任务见 `docs/DEVELOPMENT_TASKS.md`。
- H00 已于 2026-09-17 完成。LangGraph 是唯一 Workflow Runtime；LangChain `createAgent` 提供 Agent Loop，Deep Agents 中间件提供渐进式 Skill 加载。PostgreSQL Checkpoint 中断恢复、原生节点/工具事件、失败位置记录和确定性 Completion Gate 已通过真实验收；旧 P05 Agent 生成和旧 OpenHands 工程入口已直接删除。
- RA01 已于 2026-09-17 完成。Stage Profile、Source Reader、LangChain/Deep Agents Agent、动态来源 Structured Output Schema、确定性 Completion Gate、PostgreSQL 人工评审与基线恢复均已落地；有效分析、原文件、72 条评审历史和 Baseline v1 已一次性迁入 `testmesh_business`，旧协议分析及 SQLite 需求分析路径已清理。最终真实多模态验收读取 16 页 PDF，五项 Completion Gate 全部通过；隔离候选未写入正式列表。下一阶段为 TD01，开始前先读取其阶段任务，不恢复旧 P05 生成路径。

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
- 2026-09-16 用户已按新协议生成分析 `717ee21b-4428-4da1-b5ae-455a6dfd1569`；旧协议分析 `7f8d148a-d38e-4620-8f62-016df329bfd1` 继续原样保留。已保存报告列表标识协议兼容性；选择旧协议报告时立即清空当前报告并在列表旁显示专属说明，不再把读取失败追加到页面底部。人工评审的处理结果仍为接受、驳回、合并、待澄清；评审人和理由或补充说明均为选填，取消“已核对来源”的布尔勾选及其基线拦截，来源证据继续直接展示供人工判断。不得恢复这些本地必填限制或把旧报告静默转换为当前协议。
- 2026-09-16 用户已登记当前分析的 57 条评审结果：55 条接受、`REQ-5` 合并到已接受的 `REQ-9`、`REQ-6` 驳回；合并关系不是建立基线的阻塞项。10 条 `open_questions` 均已接受但缺少正式决策、决策人或回写 PRD 版本，因此基线尚未就绪。页面现在一次汇总这些问题并可直接打开对应评审，存在未完成评审或未回写完整决策时禁用“建立需求基线”；服务端失败信息也一次列出全部问题编号。不得绕过这些业务决策或代用户补写内容。
- 2026-09-16 人工评审与建立基线弹窗已统一标识必填项：处理结果、合并目标、接受待确认问题时的问题类型/正式决策/决策人/PRD 版本，以及基线的获批 PRD 修订标识、批准人和获批文件均显示红色 `*`；评审人、理由或补充说明、首次建立时的前一基线继续明确为选填。标识只反映既有校验规则，不新增业务门槛。
- 2026-09-16 当前 57 条评审结果更新为 51 条接受、3 条合并、3 条驳回；合并关系为 `REQ-5 → REQ-9`、`OQ-4 → OQ-10`、`OQ-5 → OQ-9`。合并来源不再单独处理，目标作为保留项继续回写一次最终决策；页面待处理入口显示“已合并来源”，评审弹窗将目标标成“保留项”并动态说明方向，全部记录也显示具体目标。现有评审数据未改写。
- 2026-09-17 修复人工评审从“接受”切换到“合并/驳回/待澄清”后的保存失败：此前隐藏的正式决策字段仍随请求提交，服务端会误报缺少决策人和 PRD 版本。页面切换结果时清空这些隐藏字段，服务端再按最终处理结果归一化，弹窗内直接显示保存错误。回归检查 47 项测试、lint、build 通过；未修改现有评审记录，未发模型请求。
- P04-D 仍等待官方 ZAP 文件下载与安全复核；在满足已批准的恢复条件前，不得绕过 Defender、替换安装包、改用 Docker/Installer 或继续 P04-D 真实运行。用户已明确批准在该等待期间先执行 P05，这是一次已记录的阶段顺序例外，不得据此提前进入 P06。

## 当前 Harness 规则（2026-10-05，优先于上方历史记录）

- 用户明确要求迁移到成熟 Harness，并删除旧 Harness；本次授权包含技术替换和阶段插入，不需要再次确认选型。
- HM01 已完成代码迁移、51 项测试、lint/build、正式 PostgreSQL 持久化与迁移验收及本机启动验证。下一阶段为 TD01，尚未开始。唯一 Agent Harness 是 Deep Agents 官方 `createDeepAgent`；不能再用 `createAgent` 拼装一套 TestMesh Harness。
- 工具排除、子 Agent 禁用使用 Deep Agents 官方 `registerHarnessProfile`；技能加载、文件权限、结构化输出使用其原生配置。不要创建自己的 StageProfile、TaskManifest、ArtifactEnvelope 或 Capability Assembler 框架。
- 需求证据有效性属于业务规则，通过官方 `afterAgent` 中间件执行；不要恢复通用 Completion Gate/Report 引擎。结构化协议、人工业务决策和不可覆盖的需求基线继续保留。
- 人工评审使用 LangGraph 官方 Functional API `entrypoint/interrupt/Command` 和 `PostgresSaver`。状态、错误和恢复点由框架保存；不维护独立 HarnessRunStore、追踪表或自定义状态机。
- Agent 检查点由官方框架保存消息和工具结果；评审检查点只使用分析 ID、基线记录。原文件和评审历史继续保存在原 PostgreSQL 业务表。
- 默认新检查点 Schema 为 `deepagents_checkpoint`。旧业务库通过 `npm run migrate:deepagents` 离线迁移评审恢复点；成功后删除旧 `harness_checkpoint/harness_runtime`，不保留旧运行路径或双读写。
- 现阶段不开放子 Agent、Shell、写文件、删除文件、Interpreter 或 RAG。技能按业务信号选择，并由官方技能中间件渐进加载。
- 框架能力缺口必须明确报告，不能自行补造治理平台。无 PostgreSQL 时不能以内存/SQLite替代生产验收；MemorySaver 仅用于单元测试。

## 当前文档解析规则（2026-10-06）

- 用户批准在 TD01 前插入 DI01，并要求每项成熟能力先调研再选型，不受初始推荐表限制。
- 复杂文档唯一入口是 Docling Serve v1；PDF、Office、电子表格与图片不得再直接交给模型解析。
- TestMesh 只保留上传、原文件字节与 SHA-256、来源 ID、Docling provenance 映射、原文引用和页面展示。
- 不实现 OCR、表格恢复、阅读顺序、版面算法或通用文档平台；不并行维护 PaddleOCR、MinerU、Unstructured、Tika 或 OpenAI 文件解析路径。
- Docling 不可用、部分成功、输出为空或契约不匹配时立即失败，不得静默降级。
- DI01 已于 2026-10-06 完成真实 Docling 服务与中文图片/PDF、DOCX、PPTX、XLSX 验收；默认 OCR 语言由已验收的 PP-OCRv6 中文模型决定，不显式发送 `ocr_lang`。旧版 DOC/PPT/XLS 因 LibreOffice 尚未安装而不在白名单。状态见 `docs/PHASES/DI01.md`。

## 当前需求语言质量规则（2026-10-07）

- 用户批准在 DI01 后插入 RQ01，并继续遵循“先调研、后选型、成熟能力积木化接入”。
- RQ01 唯一候选路径为 QVscribe WebAPI；TestMesh 只提交已提取需求、保存并展示外部评分/问题/触发文本/版本，以及记录人工处置。
- 不自研模糊词词典、句法检测或质量评分；不以通用大模型自评或 LanguageTool 冒充完整需求质量能力；不并行维护 IBM RQA。
- 当前阻塞在 QVscribe API 租户、接口契约、认证和中文支持验证。条件满足前不得写 mock 适配器、数据库或页面，也不得删除现有需求分析能力。状态见 `docs/PHASES/RQ01.md`。

## 当前产品方向规则（2026-10-08）

- TestMesh 的终极目标是 Agent / AI 应用质量保障体系；推荐表只是调研候选，不是逐项建设清单。
- 项目只能有一个 AI 需求分析入口，目标是发现缺失、歧义、冲突及不可验证内容并回链原文。文档解析、语言质量等成熟能力必须隐藏在该闭环内部，不能扩展成平行需求分析产品。
- FR01 形式化验证和 BR01 业务规则独立路径已撤回；不得恢复其页面、API、存储或运行时。TLA+、DMN 等只有在具体 Agent 质量场景和真实样本证明必要时才可重新调研。
- 新能力必须先定义 Agent / AI 应用质量问题、评估对象、输入证据和验收结果，再调研成熟组件。没有真实端到端验收，不得进入产品导航。
- TestMesh 只保留业务 ID 映射、统一入口、企业配置、人工决策和证据回链；不得自研成熟的 Harness、Runner、Trace/Eval、测试管理或规则执行能力。详见 `docs/PRODUCT_DIRECTION.md`。

## 当前 Agent 质量底座规则（2026-10-08）

- AQ01 已以真实 16 页中文 PRD 完成 Phoenix 20.19.0 技术尖峰；Phoenix 是 Dataset、Experiment、Trace、Evaluator 和比较的唯一成熟平台，不得再建 TestMesh Trace/Eval 表、调度器或页面。
- TestMesh 只在 Trace 中附加 task/source 等业务 ID，并维护人工审批与准入语义。OpenTelemetry/OpenInference 必须覆盖现有 Deep Agents Agent、模型和工具调用，不复制 Agent 逻辑。
- Phoenix 仅绑定本机，默认关闭遥测、Agent Assistant、MCP、Web 访问和服务端 Bash。不得把企业需求样本发送到 Phoenix Cloud。
- `evaluation/ai-after-sales-prd-rubric.json` 是 `pending-human-approval` 的候选 rubric；人工确认前不能称为金标准或用于正式准入。
- AQ01 复现实验使用 `npm run aq01:spike -- <PRD绝对路径>`。解析缓存只按 SHA-256 保存于忽略版本控制的 `data/aq01-parse-cache`，不是第二套 Dataset 存储。

## 当前测试设计规则（2026-10-09）

- TD01 已获用户批准并进入实施。唯一输入是不可覆盖的 Requirement Baseline；不得从 candidate/reviewing 分析直接生成 TestCase。
- 唯一 Agent Harness 继续使用 Deep Agents `createDeepAgent`；TestCase 统一输出简体中文 Cucumber/Gherkin，并由 `@cucumber/gherkin` 官方 Parser 校验。
- 风险、测试点和 TestCase 必须回链接受的 Baseline 条目与真实 source ID。所有应覆盖 Baseline ID 是动态 Structured Output Schema 的固定键，不允许静默遗漏。
- fast-check、NIST ACTS、GraphWalker 仅在对应输入域、参数约束或状态图完整时适用；不适用必须保存原因，不得让 AI 猜测缺失模型。
- TestMesh 只保存业务 ID、结构化设计、评审事件和不可覆盖 Approved TestCase 版本；不实现 Gherkin Parser、组合算法、路径算法或第二套 Agent Loop。
- 首个真实草稿 `36b0c1aa-0812-4a03-b674-ab62a96b2d6f` 虽通过旧覆盖 Gate，但以 8 条宽泛用例承载 36 个基线项，已被用户明确判定不满足测试设计质量，不得批准或作为验收成果。新生成必须是原子用例：每条只有一个主要验证对象、一个独立可判定场景和结构化步骤；每个未排除基线项至少成为一条用例的 `primary_trace_ref`，复杂分支继续展开，不以最低条数为目标。
- 测试设计 Agent 必须完整读取获批 PRD 与基线，使用 Deep Agents 原生渐进式 Skills 执行测试分析规划、场景、等价类/边界值、判定表、状态迁移、失败模式与跨系统一致性分析；不得把全部方法压缩为一段通用提示词。
- TestCondition 是 TestPoint 与 TestCase 之间的强制规划层。每个未排除基线项至少要有正常/有效与反向/异常两个不同条件，存在更多业务分支时继续展开；每个条件必须由独立原子 TestCase 覆盖。2026-10-10 第二次真实草稿虽达到 36 条，但仍恰好一项一例，已再次判定为最低覆盖而非质量验收成果。
- 用户已批准调研并接入通用 RAG。RAG 只补充架构、接口契约、数据字典、历史缺陷和企业规则，不得用检索片段替代完整 PRD 或不可覆盖基线。单一路径候选为 Docling HybridChunker + Qdrant + 成熟 Embedding；无知识语料时明确无命中，不伪造知识引用。实施和真实检索验收前不能宣称 RAG 已完成。
- 草稿重新生成只能在无评审记录时进行，并且必须先完整通过 Schema、Gherkin、追溯和原子覆盖 Gate，再以单事务替换旧草稿；失败时保留旧记录。后续不得后台自动重试或自动批准。

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
