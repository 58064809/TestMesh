# TestMesh 端到端质量管理体系对齐检查

更新日期：2026-10-29

## 结论

TestMesh 已具备“质量计划 → 需求基线 → Approved TestCase → 自动化 TestRun → 失败定位 → 质量报告 → OPA 发布准入 → 改进项”的主干对象和证据链，不是若干孤立 AI 功能的集合。

当前成熟度属于“闭环骨架成立、关键执行链可审计、企业数据源和 AI 实验仍待接入”。这不是 ISO 认证结论；ISO/IEC 25010、ISO/IEC/IEEE 29119、NIST AI RMF 和 PDCA 仅作为设计与检查依据。

## 管理要求与实现映射

| 管理要求 | TestMesh 对象或机制 | 当前判断 | 主要差距 |
| --- | --- | --- | --- |
| 质量目标 | QualityPlan objectives、qualityCharacteristics、release、scope | 基本满足 | 自然语言目标尚未逐项绑定 KPI、目标值和责任证据 |
| 风险管理 | QualityPlan risks、TestRisk、优先级、treatment、owner | 基本满足 | 风险处置效果和剩余风险尚无独立复核记录 |
| 流程规范 | 候选、人工评审、批准冻结、不可覆盖版本、TestRun | 满足主链 | 企业角色/权限和电子签署尚未接入 |
| 测试策略 | QualityPlan strategies、测试技术、Agent Skill 选择、执行器边界 | 基本满足 | API/UI/AI 各策略尚未形成可复用组织级模板库 |
| 质量度量 | metricCatalog、分子/分母、公式、证据、暂无数据状态 | 满足首轮 | 缺陷生命周期、生产事故、flaky 和 MTTR 数据源缺失 |
| 质量门禁 | OPA/Rego、策略版本、输入事实、allow/review/deny | 满足并已加固 | 需要在企业流水线中调用，风险接受权限尚未接 IAM |
| 持续改进 | ImprovementAction、根因分类、负责人、期限、验证证据 | 基本满足 | 尚未自动从 deny、定位结论和复盘生成候选改进项 |
| 可审计性 | 统一 ID、冻结快照、SHA-256、Trace/Experiment 外部引用 | 满足主链 | 外部证据的保留周期和不可抵赖存储策略待企业配置 |

## 分阶段检查

### 1. 智能需求分析

输入：原始 PRD、补充资料、解析结果和来源定位。

输出：结构化问题、原文证据、人工评审记录、修正 Diff、获批 PRD 和 Requirement Baseline。

已满足：

- Docling 负责 PDF/Office/图片解析，TestMesh 保存 source ID、页码/段落和引用。
- AI 候选结果不能直接成为基线；接受、驳回、合并和澄清均由人工决定。
- 获批基线保存 PRD 文件 SHA-256、批准人、版本和冻结快照。
- 质量快照统计评审数量、决策率和修正数量。

差距：需求分析记录本身尚未强制绑定 projectId；当前通过质量计划选定 baseline 间接归属项目。多项目并行后应把项目归属前移到上传和分析入口。

### 2. 智能测试用例设计

输入：获批 Requirement Baseline、质量计划质量属性、风险和可用知识证据。

输出：TestCondition、TestRisk、TestPoint、结构化 TestCase、覆盖矩阵、人工评审和 Approved TestCase。

已满足：

- 业务测试采用场景、等价类、边界值、决策表、状态迁移、组合和属性测试方法。
- Testing for AI 复用同一 TestCase 生命周期，不另建 Harness。
- 每条用例关联 trace/source/test point/risk，并允许人工修正后重新校验。
- Approved TestCase 冻结版本不可覆盖。

差距：通用 RAG 尚未配置企业资料，knowledge_evidence 可能为空；这不阻止基于 PRD 的设计，但不能宣称已利用企业规则库。

### 3. API 自动化执行

输入：Approved TestCase、真实接口契约、项目环境和人工批准的 `testmesh-api/v1` YAML。

输出：逐数据行、逐请求、逐断言 TestRun，包含预期、实际、状态和证据。

已满足：

- FastAPI/Pydantic 校验，httpx 执行，JSONPath/正则提取。
- 数据驱动、`${variable}`、Python 风格受控 if/elif/else 和 for/enumerate。
- 旧结构化 condition/foreach 继续兼容。
- 候选场景必须绑定项目、环境、Approved TestCase 版本和具体用例，经人工批准后执行。
- 单次 500 请求、循环 100 项/层、最多 3 层、响应 2 MB，不执行任意代码。

差距：项目 PG/MySQL/SkyWalking 数据源尚未注入正式 FastAPI 执行入口；Redis 和消息队列证据节点未实现；企业真实接口尚无验收环境。

### 4. 缺陷分析与定位

输入：失败 TestRun、Approved TestCase、失败断言、HTTP/Runner/Trace/数据库/源码证据。

输出：事实、候选原因、置信度、矛盾证据、定位层级、缺失证据、下一步检查和缺陷草稿。

已满足：

- 只允许引用真实 Evidence ID；没有直接或交叉证据不能标记 located。
- FastAPI YAML 失败运行已纳入 FailureTriage，与 Schemathesis、旧场景和 Playwright 使用同一诊断协议。
- 质量指标计算失败定位覆盖率和已定位比例。

差距：日志、数据库、中间件和源码连接器仍需企业配置；缺陷草稿尚未接入 Jira/MeterSphere 生命周期，因此缺陷逃逸率、重开率和严重缺陷关闭率保持“暂无数据”。

### 5. 质量报告与发布准入

输入：质量计划、基线、Approved TestCase、TestRun、Phoenix 引用、FailureTriage、改进项和 OPA 决策。

输出：冻结 Markdown 报告、SHA-256、历史版本、发布结论和证据缺口。

已满足：

- 报告是默认首页模块，与管理操作分离。
- 指标包含状态、数值、单位、分子、分母、公式、证据或缺失原因。
- 无真实分母/证据时显示“暂无数据”，不伪造 0%。
- OPA 策略升级为 `qm01-v3`，同时检查覆盖、追溯、数据设计、断言设计、执行完整性、执行通过率、失败定位、AI 设计覆盖和 Phoenix 评测证据。
- 报告会判断 OPA 输入事实是否仍与当前快照一致；事实变化后旧结论标记过期，不能用于发布。

差距：尚未接入企业 CI/CD 发布动作、缺陷平台和生产事故系统。

### 6. 持续改进

已满足：改进项保存来源、根因分类、措施、负责人、期限、状态和验证证据；没有验证证据不能关闭。

差距：当前主要由人工创建。下一阶段应从 OPA deny/review、重复失败、缺陷逃逸和 AI 回归退化自动生成“候选改进项”，仍由人工确认负责人和措施。

## 当前真实质量状态

- Requirement Baseline：已批准。
- Approved TestCase：v2，68 条，其中 Testing for AI 49 条。
- 需求覆盖率：36/36，100%。
- 追溯、测试数据设计和断言设计覆盖率：当前冻结用例均为 100%。
- API 执行完整率：2/68，2.94%，不满足正式发布要求。
- API 已执行步骤：3/3 通过；这只代表已执行部分，不代表全部用例通过。
- AI Phoenix 实验完整率：0/49，0%。
- 最新历史 OPA 结果为 deny，且质量事实变化后必须重新按 `qm01-v3` 评估。
- 缺陷逃逸率：暂无数据，原因是尚未接入发布批次和缺陷生命周期。

## 进入 AI 应用测试接入的判定

可以开始接入，但不能宣称 AI 应用质量已经验收。可复用基础设施已经具备：

1. Approved TestCase 中已有 AI dimension、oracle、threshold、dataset/evidence requirement。
2. YAML 已具备数据驱动、变量作用域、请求编排、确定性断言和统一 TestRun。
3. OpenTelemetry/OpenInference/Phoenix 已确定为唯一 Trace、Dataset、Experiment 和 Evaluator 平台。
4. OPA 已能阻止“只有 AI 用例设计、没有真实实验”被误判为发布通过。

AI 接入必须遵守以下边界：

- 不新建第二套 AI Harness；扩展现有 FastAPI YAML 执行和 TestRun。
- 确定性内容由代码断言；语义质量由 Phoenix Evaluator；人工复核用于高风险或低置信度样本。
- 每个 Dataset Version、Experiment、Evaluator 结果必须回链 Approved TestCase ID 和版本。
- 多轮会话必须隔离 session，保存每轮输入、输出、工具调用和 Trace ID。
- 没有真实目标 Agent URL、契约和评测数据时只搭建适配层，不制造验收结果。

## 下一阶段顺序

1. AIAT01（已完成首版）：目标 Agent/版本、交互模式、会话变量、OpenInference Trace 和 Phoenix Evaluator 要求已进入现有 FastAPI YAML；缺失真实 session/trace 时 TestRun 失败。
2. AIAT02（已完成并校准边界）：Approved v2 的 49 条 AI TestCase 已同步为真实 Phoenix `test-plan-manifest` Dataset Version，并以版本 ID、内容哈希和业务 ID 回链；它保存评测计划，不是实际评测语料，不能直接生成通过结论。
3. AIAT03（执行编排已完成，真实资产未就绪）：已实现 Approved AI TestCase → 已批准 AI YAML 的唯一映射检查、OpenInference 契约校验和 Phoenix `runExperiment` 编排。当前真实检查为 0/49，现有传统 API 场景不会被误算；后端已拒绝启动，不生成虚假 Experiment。
4. AIAT04：在真实目标契约和 49/49 已批准脚本就绪后运行 Experiment，接入每条 `ai_evaluation` 要求的代码 Evaluator、经校准的 LLM Judge 与人工抽检，保存外部 ID、逐样本状态和聚合指标引用。
   项目 RAG/契约来源绑定已先行完成：只允许选择已索引文档并标注 OpenAPI、Agent 契约、业务规则或测试数据用途；当前项目为 0 份文档、0 个绑定，脚本生成保持阻塞。
5. AIAT05：AI 失败进入同一 FailureTriage，区分模型、提示词、知识检索、工具、业务服务和环境层。
6. AIAT06：OPA 消费当前 Approved TestCase 版本对应的 Phoenix 通过证据，执行回归准入。
