# TestMesh 新主线开发任务

## 2026-10-08 产品方向纠偏

推荐表只作为候选来源。TestMesh 的终极目标是 Agent / AI 应用质量保障体系，项目只保留一个 AI 需求分析入口。FR01 和 BR01 的独立产品实现已删除，相关任务均记为“已撤回”，不得据其恢复页面或运行路径。

下一步不是继续按表开发，而是先围绕具体 Agent 质量闭环调研：质量目标、评估数据集、目标 Agent 执行、Trace/Eval、回归比较和准入策略。每阶段选型必须有真实样本验收。

AQ01 已确认 Phoenix 为唯一评测底座；Langfuse 与 promptfoo 本阶段不并行接入。真实 Dataset → Experiment → Trace → Eval 技术尖峰和 TestMesh 评测配置/人工批准入口已经完成。当前等待人工完成 OQ-005～OQ-011 的评审后批准 candidate-v1，再扩充样本和定义版本比较准入阈值，详见 `docs/PHASES/AQ01.md`。

---

## 2026-10-07 业务规则插入（历史，2026-10-08 已撤回）

> 以下记录说明当时做过什么，不再代表当前产品能力；对应实现与数据表已经删除。

用户批准继续成熟能力积木化建设，插入 **BR01 — 业务规则**。唯一执行器为 Apache KIE DMN 10.2.0；TestMesh 不实现 FEEL、判定表或规则 JSON 引擎。

| 任务 | 内容 | 验收结果 | 状态 |
| --- | --- | --- | --- |
| BR01-01 | 官方候选调研与单一选型 | DMN 支持、维护、许可、部署和边界有记录 | 已完成 |
| BR01-02 | 固定可重复运行时 | JDK/Maven/KIE 版本固定，Runner 哈希稳定且运行前校验 | 已完成 |
| BR01-03 | DMN 验证与执行 | schema/model/decision-table analysis 与指定 Decision 执行 | 已完成 |
| BR01-04 | 基线追溯与 PostgreSQL 证据 | 只关联获批业务规则并保存完整输入、输出、版本和审阅人 | 已完成 |
| BR01-05 | 企业工作台页面 | 可选基线/规则、执行审阅模型、查看结果与历史 | 已完成 |
| BR01-06 | 真实边界与错误验收 | 17/18 岁边界正确、非法引用被拒绝、检查全部通过 | 已完成 |

最终验收：两次真实决策均 `succeeded / exit 0`，非法模型为 `validation_error / exit 2`，隔离 PostgreSQL 追溯成功；62 项自动测试、lint、TypeScript 和 production build 通过。

---

## 2026-10-07 形式化需求验证插入（历史，2026-10-08 已撤回）

> 以下记录说明当时做过什么，不再代表当前产品能力；对应实现与数据表已经删除。

用户在 RQ01 外部准入阻塞期间批准继续成熟能力积木化建设，插入 **FR01 — 形式化需求验证**。唯一执行器为 TLA+ 官方 SANY/TLC 1.7.4；不并行接入 FRET、Apalache、Alloy 或自研模型检查器。

| 任务 | 内容 | 验收结果 | 状态 |
| --- | --- | --- | --- |
| FR01-01 | 官方候选调研与单一选型 | 语言入口、模型能力、维护、许可和运行边界有记录 | 已完成 |
| FR01-02 | 固定本地运行时 | Temurin/TLA+ 版本与哈希固定，缺失或篡改立即失败 | 已完成 |
| FR01-03 | TLC 安全执行与分类 | 参数执行、资源边界、passed/violated/error/timeout 分离 | 已完成 |
| FR01-04 | 基线追溯与 PostgreSQL 证据 | 只接收获批基线需求并保存模型、输出、版本和审阅人 | 已完成 |
| FR01-05 | 企业工作台页面 | 可选基线/需求、提交审阅模型、查看结果与历史 | 已完成 |
| FR01-06 | 真实正反模型与自动检查 | 正确模型通过、错误模型给出反例，test/lint/build 通过 | 已完成 |

中文需求到 TLA+ 的自动转换不能绕过人工模型审阅；本阶段先完成可审计的确定性验证底座，不把 LLM 生成文本冒充已验证需求。

最终验收：真实正常模型为 `passed / exit 0`，故意违反 `BelowLimit` 不变量的模型为 `violated / exit 12`，反例包含 `count = 0 → 1 → 2 → 3`；隔离 PostgreSQL Schema 中两条结果、基线与 `REQ-1` 追溯均成功持久化并在验收后清理。58 项自动测试、lint、客户端/服务端 TypeScript 与 production build 通过，生产页面和运行时健康检查实测可用。

---

## 2026-10-07 当前执行更新

用户批准执行 **RQ01 — 需求语言质量**。调研选择 QVscribe WebAPI 作为唯一候选路径；当前因商业 API 契约、认证、测试租户和中文支持均未公开而阻塞。不得用自研模糊词词典、通用大模型自评、LanguageTool 或 mock 顶替。

| 任务 | 内容 | 验收结果 | 状态 |
| --- | --- | --- | --- |
| RQ01-01 | 候选调研与单一选型 | 生命周期、专业规则、API、部署、语言、许可与可解释性有记录 | 已完成 |
| RQ01-02 | 获得 QVscribe WebAPI 准入 | 取得真实租户、当前接口契约和认证方式 | 阻塞 |
| RQ01-03 | 中文支持验证 | 用真实中文需求确认支持范围；不支持则回到选型决策 | 待 RQ01-02 |
| RQ01-04 | 接入外部分析结果 | 原样保存评分、问题、触发文本和引擎/配置版本，不本地评分 | 待 RQ01-03 |
| RQ01-05 | 页面与人工处理 | 结果回链 Requirement/来源，可接受、驳回和备注 | 待 RQ01-04 |
| RQ01-06 | 真实验收与自动检查 | 真实好/坏需求调用、失败透明、测试/lint/build通过 | 待 RQ01-05 |

RQ01 在准入点阻塞；现有需求分析路径保持不变，不提前进入实现。

---

## 2026-10-06 当前执行更新

用户批准在 TD01 前执行 **DI01 — 文档解析、OCR、表格与版面**。先调研 Docling、PaddleOCR、MinerU、Unstructured 和 Apache Tika，再选定 Docling Serve v1 为唯一复杂文档解析入口。不得把 PaddleOCR、MinerU、OpenAI 文件输入或自写解析器作为并行路径或 fallback。

| 任务 | 内容 | 验收结果 | 状态 |
| --- | --- | --- | --- |
| DI01-01 | 候选调研与单一选型 | 格式、中文 OCR、表格/版面、引用、私有部署、许可和成本有记录 | 已完成 |
| DI01-02 | 接入 Docling Serve v1 | 复杂文件只进入 Docling；失败不降级 | 已完成 |
| DI01-03 | 映射 DoclingDocument provenance | 模型上下文带来源 ID、元素引用、页码/段落号 | 已完成 |
| DI01-04 | 页面与配置更新 | 支持 PDF/Office/表格/图片并说明单一路径 | 已完成 |
| DI01-05 | 自动检查 | 54 项测试、lint 和 production build 通过 | 已完成 |
| DI01-06 | 真实文档验收 | 扫描 PDF、XLSX、DOCX/PPTX 和图片真实解析并回链 | 已完成 |

DI01 已完成，下一阶段进入 TD01。

---

## 2026-10-05 当前执行更新

用户要求删除自研 Harness，迁移到成熟框架。插入 **HM01 — Deep Agents 官方 Harness 迁移**（现已完成），下一阶段为 TD01；不恢复下方历史 Stage Profile/自研 Gate/运行记录方案。

唯一入口改为 Deep Agents `createDeepAgent`；能力限制使用官方 Harness Profile，需求校验使用领域中间件，评审恢复使用 LangGraph Functional API + PostgresSaver。删除旧 `server/harness`、通用协议/装配/完成引擎、自研 Trace/RunStore 和旧评审状态图。

实施、选型依据和验收范围见 `docs/PHASES/HM01.md`。RA01 业务报告、原文件、评审历史和基线保留；HM01 完成后下一阶段仍为 TD01。

---


本清单按依赖顺序执行。只有当前任务验收通过后才进入下一项；失败时停在失败点，不自动换框架或保留备用路径。

## H00 — Harness Foundation

| 任务 | 内容 | 验收结果 | 状态 |
| --- | --- | --- | --- |
| H00-01 | 接受 Harness ADR，重排 Roadmap，固定职责与范围 | ADR、阶段文档、任务清单一致 | 已完成 |
| H00-01A | 删除旧 P05 Agent 生成与旧 OpenHands 工程入口 | 无旧页面、API、依赖或可执行入口 | 已完成 |
| H00-02 | 接入 LangGraph 最小运行时 | 无模型测试图可以执行、暂停、恢复 | 已完成 |
| H00-03 | 定义 Stage Profile 与任务/产物协议 | 六类装配项、版本、状态均有 Schema | 已完成 |
| H00-04 | 实现能力装配与完成条件 | 未授权能力不可见；Agent 自报完成不能绕过 Gate | 已完成 |
| H00-05 | 接入 Checkpoint 与运行记录 | PostgreSQL Checkpointer 验收；业务数据与运行状态分离 | 已完成 |
| H00-06 | 接入框架 Trace/Eval 最小路径 | 可以查看一次运行的节点、工具和失败位置 | 已完成 |
| H00-07 | H00 集成验收 | 自动检查和一条无付费模型端到端运行通过 | 已完成 |

## RA01 — Requirement Analysis

| 任务 | 内容 | 验收结果 | 状态 |
| --- | --- | --- | --- |
| RA01-01 | 固定 Requirement Analysis Stage Profile | 明确 Context、Knowledge、Skills、Tools、Policy、Schema | 已完成 |
| RA01-02 | 迁移多文件与图片 Source Reader | PRD、PDF 页面图、独立图片和补充资料均可追溯 | 已完成 |
| RA01-03 | 迁移 RequirementAnalysis Agent | 输出继续使用固定十字段 Schema | 已完成 |
| RA01-04 | 引用与完成条件校验 | 无证据、伪造来源、错误冲突引用均不能完成 | 已完成 |
| RA01-05 | 人工 Review、决策回写与 Baseline 恢复点 | 可跨时间暂停和继续，不覆盖原分析 | 已完成 |
| RA01-06 | 数据切换与真实验收 | 一次性迁移或清理旧数据，完成真实多模态闭环，不保留兼容读取 | 已完成 |

## TD01 — Test Design / TestCase

| 任务 | 内容 | 验收结果 | 状态 |
| --- | --- | --- | --- |
| TD01-01 | 固定 TestDesign、Risk、TestPoint、TestCase Schema | 与 RequirementAnalysis 分离 | 已完成 |
| TD01-02 | 固定 Test Design Stage Profile | 只读取 Baseline、范围、人工决策和获准知识 | 已完成 |
| TD01-03 | 接入测试设计 Skills | 按任务加载等价类、边界值、判定表、状态迁移等；不适用有理由 | 已完成 |
| TD01-04 | 覆盖矩阵与追溯 Gate | Requirement/Test Point/TestCase/证据可回链，无静默遗漏 | 已完成 |
| TD01-05 | 人工 Review 与 Approved TestCase | 72 条逐条追加 accepted 事件，Approved v1 不可覆盖 | 已完成 |
| TD01-06 | 真实需求验收 | 72 条原子用例、36 个基线项各 2 条条件，用户全量确认通过 | 已完成 |

## AT01 — API Automation

| 任务 | 内容 | 验收结果 | 状态 |
| --- | --- | --- | --- |
| AT01-01 | 固定 API Automation 输入 | 只接收 Approved TestCase 版本、OpenAPI、目标 URL 与临时认证 | 已完成 |
| AT01-01A | 独立项目/环境配置 | TestMesh 只保留业务主键与非敏感环境配置；API 执行引用固定环境；敏感 Header 拒绝落库，Infisical 作为正式 provider 边界 | 已完成（Infisical 实例接入待企业环境） |
| AT01-02 | 选择单一成熟 Runner | OpenAPI 3.x + Schemathesis 4.29.3；不引入代码生成 Agent | 已完成 |
| AT01-03 | operation 映射与真实 Runner 验证 | 只执行已映射 operation，受控 HTTP 目标保存 2 条失败证据 | 已完成（平台闭环） |
| AT01-03A | 确定性业务 API 场景执行 | Hurl 8.0.1 执行请求链、捕获与断言；场景绑定项目环境和 Approved TestCase，保存 JUnit 证据 | 已完成（受控双请求链路） |
| AT01-03B | 可重复本机演示与刷新恢复 | 固定演示 API/OpenAPI/Hurl 资产；两类 Runner 全绿；刷新后恢复契约、映射、场景，并可切换最近 20 次 TestRun | 已完成（非业务验收） |
| AT01-04 | 真实业务验收 | 使用本项目 OpenAPI 与测试环境执行并回链 Approved v1 | 等待真实契约、URL 与认证 |

## AT02 — UI Automation

| 任务 | 内容 | 验收结果 | 状态 |
| --- | --- | --- | --- |
| AT02-01 | 固定 UI Automation 输入 | Project、UI Environment、Approved TestCase、已配置仓库与测试文件 | 已完成 |
| AT02-02 | 复用 Playwright 官方 Test Agents | planner/generator/healer 负责规划、生成和修复；受控仓库已用官方命令初始化并通过 seed | 已完成（真实仓库待接入） |
| AT02-03 | 真实 Runner 验证 | Playwright 1.64.0 + Chromium；受控页面 2/2 通过，失败运行产生 2 份 Trace | 已完成（非业务验收） |
| AT02-04 | 真实业务人工验收 | 审阅官方 Agent Diff，执行真实前端并保存 Trace/截图与 TestCase 回链 | 等待真实仓库、URL 与账号 |

## HR01 — AI 候选稿人工修正与冻结

| 任务 | 内容 | 验收结果 | 状态 |
| --- | --- | --- | --- |
| HR01-01 | 需求分析候选修正 | 评审时可修正描述和真实 source 引用；事务保存修正、评审与 Diff | 已完成（新候选待真实人工修订验收） |
| HR01-02 | TestCase 候选修正 | 可修正业务字段、步骤与 Gherkin；保存时重跑 Schema/Gherkin/追溯/覆盖 Gate | 已完成（新草稿待真实人工修订验收） |
| HR01-03 | API/UI 脚本候选修正 | 契约发现与 AI 脚本生成后进入修正、Runner 校验和批准，不保留上传型主入口 | 待 API/UI 生成阶段实施 |

## FT01 — 辅助缺陷定位调研

| 任务 | 内容 | 验收结果 | 状态 |
| --- | --- | --- | --- |
| FT01-01 | 调研企业内可获得的失败上下文 | 已明确测试证据、SkyWalking 遥测、受治理数据库查询和版本源码四类来源 | 已完成，等待方案评审 |
| FT01-02 | 定义 FailureTriage Schema 和证据边界 | 已区分事实、候选原因、反证、源码位置和待补证据，并定义确定性完成门 | 已完成，等待方案评审 |
| FT01-03 | 选择日志/数据库/代码检索成熟能力 | 推荐 SkyWalking MCP、DBHub/Bytebase MCP、只读 Git/GitHub/Sourcegraph MCP；不自研检索基础设施 | 已完成，等待方案评审 |
| FT01-04 | 最小闭环 | 诊断已内嵌 Schemathesis/Hurl/Playwright 失败结果；自动追溯 Approved TestCase、断言和运行证据，不再手填缺陷现象 | FT01-A 已按主链路重构；重启后进入 SkyWalking 受控全链路验收 |

## 本轮排除项

- APP 自动化的新开发。
- 性能测试的新开发。
- 安全测试的新开发。
- 自动 commit、push、合并代码。
- 在 FT01 调研完成前预设日志平台、数据库读取方式或根因算法。
