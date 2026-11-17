# TestMesh 面试准备资料

> 更新时间：2026-11-17  
> 用途：项目介绍、技术面试、系统设计面试、AI 测试与质量工程面试。  
> 口径原则：只描述仓库中已经实现或有真实验收记录的能力；模拟业务、受控演示、设计完成和真实业务验收必须明确区分。

## 1. 一句话定位

TestMesh 是一个面向 Agent 与生成式 AI 应用的质量保障工作台。它把需求基线、测试模型、测试条件、测试用例、评估数据集、实验、Trace、自动化执行、失败诊断和发布准入组织成一条可追溯、可人工审核、可持续回归的质量链路。

它不是另一个大模型应用开发框架，也不重复实现 OCR、Agent Runtime、测试 Runner、Trace 平台或规则引擎。TestMesh 的核心价值是：

1. 把业务需求变成可验证的质量资产；
2. 通过稳定 ID 和冻结版本保持上下游追溯；
3. 复用成熟引擎执行测试与评测；
4. 把真实执行证据汇聚为可审计的发布决策。

## 2. 面试开场话术

### 2.1 30 秒版本

我做的 TestMesh 是一个 Agent/AI 应用质量保障平台。项目解决的核心问题不是“怎么调用大模型”，而是怎么把需求、测试设计、评估数据、Agent Trace、自动化执行和发布准入连接起来。架构上采用薄控制层和 reuse-first 原则：复杂文档由 Docling 解析，Agent 工作流使用 Deep Agents 和 LangGraph，知识检索使用 Qdrant，Dataset/Experiment/Evaluator/Trace 使用 Phoenix，发布门禁使用 OPA。TestMesh 负责业务资产、版本、人工审批、追溯关系和证据闭环。

### 2.2 1 分钟版本

传统软件测试通常假设输入输出确定，而 Agent 应用还会遇到意图识别、多轮上下文、工具调用、RAG 引用、幻觉、输出波动和评估主观性等问题。TestMesh 为此设计了一条完整链路：先把 PRD 解析成带原文证据的需求分析，经人工评审后冻结 Requirement Baseline；再建立 M-01 到 M-04 四类行为模型，生成独立 TestCondition 和原子 TestCase；经过审核的 AI 用例再形成 Dataset、Evaluator 和 Experiment；执行时采集工具调用、业务结果和 OpenInference Trace；最后把覆盖率、执行结果、AI 评测证据和改进项交给 OPA 做 allow、review 或 deny 的发布判断。整个过程中，AI 只能生成候选稿，不能绕过确定性校验和人工批准。

### 2.3 3 分钟版本

TestMesh 的出发点是：AI 应用质量不能只看最终回复，也不能只靠另一个 LLM 打一个总分。我们把质量证据分成 Agent 决策、工具执行、业务结果和最终回复四层，并要求每条测试用例明确 oracle、Evaluator、阈值、样本要求和证据要求。

系统主链路是：

`Source → RequirementAnalysis → RequirementBaseline → ApprovedTestModel → ApprovedTestCondition → ApprovedTestCase → Dataset/Automation → TestRun/Experiment → Evaluation/Triage → QualityReport → ReleaseGate`

技术上我坚持“成熟能力复用、平台只做业务关系层”。例如：Docling 负责 PDF/Office/OCR/表格和版面解析；Deep Agents 负责 Agent Loop 和 Skills；LangGraph 负责人工中断、恢复和 PostgreSQL Checkpoint；Qdrant 负责 Dense、BM25 和 RRF 混合检索；Phoenix 负责 Dataset、Experiment、Evaluator 和 Trace；Cucumber、Schemathesis、Hurl、Playwright 分别负责用例语法和 API/UI 执行；OPA/Rego 负责发布策略。

为了避免 AI 看似完成但实际不可用，平台有三层约束：第一层是 Zod/JSON Schema 等结构校验；第二层是追溯、覆盖、引用和业务语义的确定性 Gate；第三层是人工评审和不可覆盖的批准版本。失败时不静默切换模型、解析器或 Runner，而是停在真实失败点。

项目目前已经打通需求分析、测试建模、测试条件、测试用例、质量管理、API/UI 执行、Phoenix 评测底座、失败诊断入口、OPA 发布准入和项目级混合 RAG。智能导购是受控模拟业务，用来验证方法和接口，不冒充真实业务验收；真实目标 Agent 契约、正式评估样本和完整 Experiment 仍是当前待补证据。

## 3. 项目为什么有价值

### 3.1 Agent 测试与传统测试的差异

| 传统系统 | Agent / AI 应用 |
| --- | --- |
| 输入输出通常确定 | 回复可能存在合理波动 |
| 主要检查接口、状态和数据 | 还要检查意图、上下文、Groundedness、幻觉和拒答 |
| 单次请求即可覆盖大量功能 | 多轮状态和工具轨迹同样属于被测行为 |
| 断言多为精确相等 | 需要 exact、normalized、range、set、schema、semantic、LLM Judge 等多类 oracle |
| 日志和接口结果是主要证据 | 还需要 Prompt 版本、Dataset 版本、Trace、工具参数和 Evaluator 结果 |
| 发布门禁通常统计测试通过率 | 还要验证评测集覆盖、Evaluator 校准和版本关联 |

### 3.2 TestMesh 解决的关键问题

- 需求经 AI 分析后，怎样保证每个结论都有原文依据？
- AI 生成的模型和用例怎样避免“数量很多但不可执行”？
- 多轮对话、参数规范化、工具调用和最终回复怎样分层验证？
- Dataset、TestCase 和 Requirement 怎样保持版本追溯？
- LLM Judge 怎样避免成为未经验证的主观裁判？
- 自动化执行和 Phoenix Experiment 怎样共同进入质量报告？
- 质量门禁怎样避免把“设计覆盖”误当成“执行通过”？

## 4. 核心工程原则

### 4.1 Reuse-first

增加能力时先调研成熟组件，只实现成熟组件缺失的业务映射和证据关联。这样可以降低自研基础设施的成本，也减少平台内出现多个相互冲突的事实来源。

### 4.2 Single path

同一能力只保留一条正式运行路径。例如复杂文档只走 Docling；Dataset、Experiment、Trace 和 Evaluator 只走 Phoenix；发布策略只走 OPA。没有经过真实验收的备选方案不会作为静默 fallback。

### 4.3 Evidence first

模型输出不能因为“看起来合理”就进入下游。需求分析必须引用 source ID 和原文位置；测试模型和用例必须引用 Baseline ID；失败诊断中的事实必须引用 TestRun、Trace、日志、数据库查询或源码证据。

### 4.4 Human-in-the-loop

AI 生成的是候选资产。需求、测试模型、测试条件、测试用例、Dataset 样本和质量计划都需要人工修正或审批。批准版本不可覆盖，新变化形成新版本。

### 4.5 Fail transparent

Docling 失败不切换另一套解析器；模型输出未通过 Gate 不伪装成成功；Runner 没有生成有效报告时标记 error；发布证据不足时由 OPA 明确 deny。

## 5. 总体架构

```text
React + Ant Design 工作台
            │
            ▼
Express / TypeScript 领域 API
  ├─ 项目与环境配置
  ├─ 需求分析与评审
  ├─ 测试模型 / 条件 / 用例
  ├─ Dataset 与 Experiment 编排
  ├─ 自动化执行映射
  ├─ 失败诊断
  └─ 质量计划、报告与发布准入
            │
            ├──────── PostgreSQL
            │          业务事实、版本、审批、关系、Checkpoint
            │
            ├──────── Docling
            │          PDF / Office / OCR / 表格 / 版面 / provenance
            │
            ├──────── Deep Agents + LangGraph
            │          Agent Loop、Skills、工具、人工中断与恢复
            │
            ├──────── Qdrant
            │          项目级 Dense + BM25 + RRF 混合检索
            │
            ├──────── Phoenix + OpenInference
            │          Dataset、Experiment、Evaluator、Trace
            │
            ├──────── 测试执行器
            │          Cucumber / Schemathesis / Hurl / Playwright
            │
            └──────── OPA / Rego
                       allow / review / deny 发布决策
```

### 5.1 TestMesh 自己保存什么

- 项目、发布批次、质量计划和环境配置；
- Source、Requirement、Baseline、TestModel、TestCondition、TestCase 等领域资产；
- 资产之间的 ID、版本和追溯关系；
- 人工修正、评审事件和批准状态；
- 外部 Dataset、Experiment、Trace、TestRun 等引用；
- 质量事实、OPA 输入输出、风险接受和改进项。

### 5.2 TestMesh 不保存或不重复实现什么

- 不自研 OCR、版面分析和表格识别；
- 不自研 Agent Loop、通用 Tool Executor 或 Trace Viewer；
- 不复制 Phoenix 的 Dataset、Experiment 和 Eval 存储；
- 不自研浏览器、API、性能或安全测试执行引擎；
- 不实现 BM25、分词或 RRF 算法；
- 不把 LLM 输出当成无需验证的业务事实。

## 6. 端到端质量链路

### 6.1 需求分析与基线

1. 用户上传 PRD、PDF、Office、表格、图片或结构化文本；
2. 复杂文档由 Docling 解析，并保留元素、页码和 provenance；
3. Requirement Analysis Agent 识别需求、规则、流程、状态、异常和待确认问题；
4. 服务端校验来源 ID、逐字引用和冲突依据；
5. 人工逐项接受、驳回或修正；
6. 上传评审后的 PRD，冻结 Requirement Baseline；
7. Baseline 之后不可覆盖，变更应生成新版本。

关键点：需求分析只发现问题并提供证据，不直接生成 TestCase，也不替产品负责人决定缺失业务规则。

### 6.2 测试模型

冻结基线后先生成 Test Model，而不是直接生成用例。模型包含四个职责分离的行为视图：

| 模型 | 责任 | 典型内容 |
| --- | --- | --- |
| M-01 语义与参数模型 | 参数如何识别、表示、规范化和校验 | Intent、Slot、类型、范围、单位、别名、跨字段约束 |
| M-02 业务决策模型 | 条件如何映射成业务动作 | 筛选、排序、数量控制、无结果和异常动作 |
| M-03 会话状态模型 | 多轮状态和参数如何变化 | 状态、事件、保留、覆盖、清除、冲突、恢复 |
| M-04 Agent 交互模型 | 何时以及怎样调用工具 | 工具 Schema、调用前置条件、成功、无结果、超时和失败路径 |

模型之外还包含质量目标、风险、测试点、AI 维度适用性和候选测试条件。模型通过人工审核后才成为 Approved Test Model。

### 6.3 TestCondition

TestCondition 是模型与用例之间的独立资产。每条条件只描述一个可独立判定的验证目标，不包含执行步骤、Gherkin 或样本全文。

引入这一层的原因：

- 防止模型直接生成大量重复用例；
- 先检查业务规则和风险分支是否完整；
- 让正常、异常、边界、状态迁移和依赖失败可以被系统化拆分；
- 允许人工在写执行细节前修正测试意图。

### 6.4 TestCase

只有 Approved TestCondition 才能生成 TestCase。平台要求一条条件对应一条原子用例，不能由模型新增、删除、合并或改写已经批准的条件。

TestCase 主要字段包括：

- module、title、objective、priority；
- primary trace、condition 和 source refs；
- scenario type 与测试设计技术；
- preconditions、test data、steps；
- 独立合法的中文 Gherkin；
- AI 用例的 dimension、oracle、Evaluator、threshold、Dataset 和 evidence requirement。

### 6.5 Dataset、Experiment 与 Evaluator

AI TestCase 可以关联多条 Dataset Sample。样本必须经过逐条审核和冻结，随后导出为 Phoenix Dataset Version。Experiment 执行真实目标 Agent，并把每一行结果与 Sample ID、TestCase ID、TestCondition ID、Model Version 和 Trace 关联。

Evaluator 采用分层策略：

1. 能确定判断的优先代码 Evaluator；
2. 参数和结构按字段语义使用 exact、normalized、range、set、schema、context 或 tool matching；
3. 需要语义质量判断时才使用经过校准的 LLM Judge；
4. 高风险结论保留人工抽检；
5. LLM Judge 必须有校准样本和与人工标签的一致性证据。

### 6.6 自动化执行

- Schemathesis：根据 OpenAPI 做契约和属性测试；
- Hurl：执行确定性的 API 请求链、变量捕获和断言；
- Playwright：执行 UI 测试并保留 Trace、截图和 Runner 结果；
- FastAPI YAML：描述 AI 应用单轮、多轮和 Agent 工具调用场景；
- Cucumber/Gherkin：作为业务可读的测试表达和语法 Gate。

执行器是事实来源，TestMesh 只保存业务映射、执行摘要和证据引用。

### 6.7 失败诊断

失败诊断从 TestRun 进入，不要求测试人员重新手填缺陷描述。服务端自动追溯 Approved TestCase、步骤、预期、实际、请求响应和 Runner/Trace，再交给受控 Agent 形成：

- 已确认事实及 evidence refs；
- 故障层级和候选组件；
- 候选原因、反证和置信度；
- 缺失证据和下一步检查；
- 可人工确认的缺陷草稿。

没有日志、Trace、数据库或源码证据时，结果只能是 `suspected` 或 `insufficient_evidence`，不能伪造 `located` 根因。

### 6.8 质量报告与发布准入

Quality Plan 先定义发布范围、风险、质量目标、证据要求和门槛。Quality Snapshot 再汇总：

- 治理层：计划、Baseline、Model、TestCase 是否批准；
- 覆盖层：需求、风险和 AI 维度覆盖；
- 执行层：执行完整率、通过率、失败数；
- AI 质量层：Dataset、Experiment、Evaluator 和 Trace 是否与当前版本关联；
- 改进层：未关闭改进项及验证证据。

OPA/Rego 根据这些事实返回：

- `allow`：全部硬门槛满足；
- `review`：存在允许人工接受的风险项；
- `deny`：关键资产、执行或 AI 评测证据缺失，不允许人工覆盖。

## 7. Prompt 工程设计

TestMesh 不使用一个万能 Prompt 贯穿全部阶段，而是按资产边界拆分 Prompt 和 Schema。

| 阶段 | 是否加载 Prompt | 输入 | 输出 | 禁止事项 |
| --- | --- | --- | --- | --- |
| Requirement Analysis | 是 | 原始资料、解析结果、来源信息 | 结构化需求分析 | 不替产品决定规则，不生成 TestCase |
| Test Model | 是 | Approved Baseline、PRD、受治理知识 | `test-model/v2` | 不生成正式 TestCondition/TestCase/Dataset |
| TestCondition | 是 | Approved Test Model、Baseline Evidence | `test-condition-set/v1` | 不写步骤、样本和 Gherkin |
| TestCase | 是 | Approved TestCondition、Model Evidence | `test-case-set/v1` | 不改写批准条件 |
| Approval | 否 | 候选资产、人工操作 | 审批事件和冻结版本 | 不让模型代替批准人 |
| Dataset Export | 否 | Approved Sample | 确定性 Dataset Version | 不用模型重写样本 |
| Evaluation | 视类型 | 样本、输出、Rubric | Evaluation | 代码判定不加载 Prompt；LLM Judge 使用独立版本化 Prompt |

### 7.1 Prompt 工程不是只改措辞

项目里的 Prompt 工程至少包含：

- 固定输入契约和输出 Schema；
- Prompt Version；
- 阶段责任和禁止事项；
- Skills 的按需加载；
- 可用工具和读写权限；
- 来源引用、覆盖和语义校验；
- Dataset 回归与 Phoenix Experiment；
- Token、耗时和失败位置观测；
- 人工修正结果反哺新的 Prompt 候选版本。

### 7.2 为什么不能只靠 Prompt

Prompt 可以提高模型遵循度，但不能保证正确性。因此平台把约束下沉到代码：Zod Schema 保证结构，领域 Gate 检查追溯和覆盖，人工审批确定业务含义，Experiment 验证新 Prompt 是否回归。

## 8. RAG 设计

### 8.1 使用场景

RAG 为测试建模提供项目级补充知识，例如接口契约、架构说明、数据字典、历史缺陷和企业规则。知识不能替代冻结 PRD，也不能自动改变 Baseline。

### 8.2 当前链路

```text
项目绑定文档
  → Docling 或稳定文本分块
  → text-embedding-3-small Dense Vector
  → Qdrant multilingual BM25 文本索引
  → Dense 与 BM25 两路候选
  → Qdrant 原生 RRF 融合
  → project document_id filter
  → chunk/source/provenance evidence
```

### 8.3 为什么没有引入完整 RAG 框架

LlamaIndex 和 Haystack 都很成熟，但现有系统已经有 LangChain/Deep Agents、Docling、Qdrant 和 Phoenix。再引入完整框架会形成第二套 Pipeline、Retriever 和评测面。当前选择 Qdrant 原生 BM25、Dense 和 RRF，是对既有架构改动最小的成熟能力复用。

### 8.4 关键工程细节

- Qdrant Server 1.20.1，JS Client 1.20.0；
- `text` 使用 multilingual tokenizer 和 BM25 scoring；
- `document_id` 建立 keyword payload index；
- 每次查询只允许当前项目明确绑定且状态为 indexed 的文档；
- PostgreSQL 保存原文件、SHA-256、索引状态和项目绑定；
- Qdrant 只保存可重建的检索索引；
- Agent 只能引用真实返回的 chunk ID；
- 没有标注集前不随意调整融合权重，也不提前加入 reranker。

### 8.5 尚待完成的检索评测

下一步需要在 Phoenix 建立带相关 chunk 标注的检索 Dataset，对 Dense、BM25 和 Hybrid 分别计算 Recall@K、MRR 和 nDCG。只有评测证明 RRF 排序仍不足，才评审多阶段检索或 Cross-Encoder Reranker。

## 9. Testing for AI 的质量模型

平台按项目证据判断以下维度是否适用：

- 意图识别；
- 参数/Slot 提取和规范化；
- 多轮上下文；
- 约束保持；
- 回复准确性；
- Groundedness 与幻觉；
- 安全拒答；
- 工具选择；
- 工具调用参数；
- 鲁棒性与一致性。

不是每个项目都强制使用所有维度。例如参数提取只有在需求已提供字段 Schema、归一化规则、上下文和工具映射时才能标记为 applicable；证据不足时必须是 blocked，而不是由模型自行猜测字段契约。

### 9.1 四层证据

| 层次 | 要验证的问题 | 典型证据 |
| --- | --- | --- |
| Agent Decision | 意图、计划和决策是否正确 | Agent State、结构化输出、Trace |
| Tool Execution | 是否选择了正确工具和参数 | Tool Call Name、Arguments、Result、Error |
| Business Outcome | 实际业务状态是否正确 | API/DB/业务响应、库存、状态迁移 |
| Final Response | 对用户的回复是否准确、完整、有依据 | 回复文本、引用、Evaluator、人工标签 |

只检查最终文本会漏掉“工具参数错误但回复碰巧正确”或“工具返回正确但模型编造解释”等问题。

## 10. 模拟智能导购业务在项目中的作用

智能导购不是 TestMesh 的真实商业业务，而是受控模拟场景。它用于验证：

- 从业务规则到 M-01～M-04 的建模方法；
- 多轮参数保留、覆盖、清除和冲突处理；
- TestCondition、TestCase、Dataset 和 Evaluator 的数据契约；
- AI YAML 场景怎样消费 Dataset Input；
- 工具参数、筛选结果和最终回复怎样分层断言；
- 模拟资产如何在未来替换为真实 PRD、真实 Agent 契约和真实样本。

必须明确的边界：

- 模拟目标是确定性测试替身，不是 LLM Agent；
- 合成 Trace ID 不是 OpenInference Span；
- 模拟样本不是正式 Phoenix Dataset；
- 未绑定 Approved TestCase 的执行不能进入正式发布证据；
- 如果旧 Baseline 与新业务规则冲突，必须重新分析、评审和冻结，不能偷偷修改冻结资产。

## 11. 已实现能力与当前边界

### 11.1 已实现并有验收记录

- Docling 复杂文档解析和来源回链；
- AI 需求分析、人工评审、修正和 Requirement Baseline；
- Deep Agents 正式 Agent Harness 与 LangGraph 人工中断/恢复；
- Test Model、TestCondition、TestCase 的分阶段 Schema、Prompt 和审批；
- M-01～M-04 行为模型契约；
- Cucumber/Gherkin 语法与追溯 Gate；
- API 契约测试和确定性场景执行；
- Playwright UI 执行和 Trace 证据；
- Phoenix Dataset、Experiment、Trace、Evaluator 技术底座；
- AI Dataset Sample 审核、冻结、导出和 Experiment Readiness；
- Failure Triage 结构和执行结果内嵌入口；
- Quality Plan、分层指标、质量报告、OPA Release Gate 和 Improvement Action；
- Qdrant 项目级 Dense + BM25 + RRF 混合检索。

### 11.2 已完成工程链路但等待真实业务证据

- API/UI 自动化已经用受控目标验收，真实项目仍需真实 OpenAPI、URL、账号和仓库；
- 49 条 AI TestCase 已同步为 Phoenix Dataset，但真实目标 Agent 契约、批准 YAML 和业务 Evaluator 尚未齐全；
- 当前正式发布准入应保持 deny，而不是用模拟结果补齐；
- Failure Triage 的 SkyWalking/数据库/源码全链路仍需完成受控验收；
- Hybrid RAG 已真实运行，但尚未用标注集证明检索指标达标。

### 11.3 明确不应声称的内容

- 不能说已经完成真实智能导购 Agent 的正式质量验收；
- 不能把设计覆盖率 100% 说成执行通过率 100%；
- 不能说 RAG 已达到某个 Recall@K，当前尚无标注集；
- 不能说 LLM Judge 已能替代人工，校准仍是前置条件；
- 不能说 Failure Triage 已能自动确定所有根因；
- 不能把模拟 Trace ID 说成完整 Agent Trace。

## 12. 代表性真实验收结果

以下数字可以在面试中使用，但要说明对应范围：

- 一份 16 页中文 AI 售后 PRD 的 Phoenix 技术尖峰产生 33 个 Span：1 Agent、20 Chain、4 LLM、8 Tool；
- 该次尖峰发现 20 个待确认问题和 48 条引用；产品入口的另一轮真实分析持久化了 12 个待确认问题和 43 条 Docling 校准引用；
- 20 条受控单缺陷需求样本的预置缺陷检出率为 19/20，即 95%；同时暴露 1 次证据 Gate 失败和明显的过度报告问题，因此结论是 review，而不是通过；
- 一个真实 Approved TestCase v2 包含 68 条用例，其中 49 条 AI 用例覆盖 9 个 AI 维度；这证明设计覆盖，不证明目标 Agent 达标；
- 质量报告曾记录需求覆盖 36/36、执行完整率 2/68、执行通过率 3/3；执行样本很少，因此发布不能据此放行；
- 最新正式 OPA 准入为 deny，原因是 49 条 AI 用例缺少与当前 Approved 版本一致的 Phoenix 通过证据；
- RAG 升级后 Qdrant 集合保持 green，原有 5 个点保留，并完成真实 Dense + BM25 + RRF 查询；
- 当前代码基线验证为 33 个测试文件、161 条自动测试通过，lint、客户端构建和服务端构建通过。

## 13. 关键技术难点与解决方式

### 13.1 AI 输出结构正确但业务不完整

问题：模型可以返回合法 JSON，却遗漏规则分支、伪造引用或生成重复用例。

解决：Schema 只做第一层；再增加来源 ID、逐字引用、覆盖矩阵、条件到用例一对一、Gherkin 语法和知识 chunk 白名单等确定性 Gate；最后由人工审批。

### 13.2 冻结资产与新输入冲突

问题：模拟业务规则更新后，旧 Baseline 仍写着默认数量、单位换算和品牌别名未定义。

解决：系统拒绝加载与冻结基线冲突的模拟参考模型，要求使用最新 PRD 重新分析和冻结新版本。这样保证不可变资产没有被“悄悄修正”。

### 13.3 设计覆盖和执行证据混淆

问题：早期 OPA 策略只看到 AI 维度覆盖就给出 allow，但并没有当前 Approved TestCase 对应的 Phoenix Experiment。

解决：升级策略，要求 Dataset Version、Experiment、Evaluator、通过状态和 TestCase Version 全部匹配。历史错误决策保留审计，最新结果变为 deny。

### 13.4 RAG 全局串数据

问题：原知识检索虽然文档有项目绑定，但查询没有强制按项目过滤，理论上可能召回其他项目内容。

解决：查询前从 PostgreSQL 解析当前项目已绑定且 indexed 的 document ID，并在 Dense 和 BM25 两路 prefetch 上同时添加 Qdrant filter；未绑定知识时不向 Agent 暴露搜索工具。

### 13.5 RAG 只做 Dense，关键词和编号召回不足

问题：接口字段、规则 ID、品牌编码等精确词对纯向量检索不友好。

解决：升级 Qdrant 1.20.1，使用 multilingual BM25 和 Dense 两路召回，再用原生 RRF 融合。现阶段不拍脑袋调权重，下一步通过标注 Dataset 做指标比较。

### 13.6 LLM Judge 的可信度

问题：用另一个大模型评分可能有偏差、漂移和不可解释性。

解决：优先代码判定；LLM Judge 只处理语义性指标，必须记录 Prompt 和模型版本，与人工标签校准，并保留抽检。发布门禁消费的是已关联证据，不消费一个无来源总分。

### 13.7 失败诊断容易把猜测当根因

问题：只有 HTTP 500 或 UI 超时时，大模型很容易编造后端、数据库或代码原因。

解决：事实必须引用 evidence ref；没有 Trace/日志/数据库/源码时只能输出候选原因；文件行号必须来自与部署 Commit 一致的源码查询结果。

## 14. 为什么选择这些技术

| 技术 | 选择原因 | TestMesh 使用边界 |
| --- | --- | --- |
| TypeScript + React | 前后端统一语言，适合结构化 Schema 和平台 UI | 领域 API、工作台、编排和关系层 |
| Zod | 运行时结构校验和 TypeScript 类型协同 | 输入输出 Schema，不代替业务 Gate |
| PostgreSQL | 适合版本化业务事实、审批和关系查询 | 业务数据和 LangGraph Checkpoint |
| Deep Agents | 提供正式 Agent Harness、Skills、工具和权限 | 不自研 Agent Loop |
| LangGraph | 支持状态、Checkpoint、interrupt/resume | 人工审批和可恢复工作流 |
| Docling | 支持 PDF/Office/OCR/表格/版面和 provenance | 复杂文档唯一解析入口 |
| Qdrant | 向量、全文 BM25、payload filter 和 RRF | 可重建项目知识索引 |
| Phoenix | OpenInference Trace、Dataset、Experiment、Evaluator | 唯一 AI 评测平台 |
| Schemathesis | OpenAPI 属性和契约测试 | API 契约执行器 |
| Hurl | 可审查的确定性 API 流程与断言 | API 场景执行器 |
| Playwright | 成熟 UI Runner、Trace 和截图 | UI 执行器 |
| OPA/Rego | 策略与业务代码分离，可保存输入输出证据 | 发布准入唯一执行器 |

## 15. 数据一致性与可追溯设计

### 15.1 不可覆盖版本

批准后的 Baseline、Test Model、TestCondition、TestCase、Dataset Version 和 Quality Plan 都不可原地修改。变更需要生成新版本，并保持历史决策。

### 15.2 稳定关联 ID

每个下游资产保存上游 ID，例如 TestCase 保存 primary condition 和 trace refs；Experiment Example 保存 Sample、TestCase、Condition 和 Model Version；Quality Gate 保存计划版本、事实快照和策略版本。

### 15.3 事实来源分工

- PostgreSQL：业务资产、版本、审批和关系；
- Phoenix：Dataset、Experiment、Eval 和 Trace；
- Runner：真实执行结果和原始工件；
- Qdrant：可重建检索索引；
- OPA：策略评估结果；
- TestMesh：把这些事实关联起来，不复制外部系统完整模型。

## 16. 安全与企业边界

- API Key 只从服务端环境变量读取；
- 上传文件有格式、数量和大小限制；
- 数据库敏感 Header 不持久化；
- 项目知识按 document ID 隔离；
- Agent 工具按 Profile 和权限白名单暴露；
- Failure Triage 的数据库和源码能力只读；
- Phoenix 默认仅绑定本机，并关闭遥测、Agent Assistant、MCP、Web 访问和服务端 Bash；
- 不自动切换模型、外部服务或解析器，以免数据边界失控。

## 17. 测试策略

### 17.1 测试金字塔

- 单元测试：Schema、校验器、转换、Gate、策略输入和 RAG 查询结构；
- 集成测试：PostgreSQL 持久化和恢复、Runner 接口、OPA 策略、Qdrant；
- 受控端到端：模拟 API、UI 和 AI 目标；
- 真实样本验收：真实 PRD、真实 OpenAPI、真实目标 Agent 和真实人工标签；
- 回归评测：Phoenix Dataset/Experiment 比较 Prompt、模型或 Agent 版本。

### 17.2 失败不抹平

失败 Experiment、错误 Gate 和历史 deny 都应保留。它们既是审计证据，也是发现方法问题的样本。项目中曾保留一次 20/20 在 Agent 前失败的 Phoenix Experiment，用于说明错误的 task 参数契约，而不是删除后只展示成功结果。

## 18. 当前下一步

按价值和依赖排序：

1. 用最新智能导购 V1.0 PRD 重新完成需求分析、人工评审和 Baseline；
2. 审核并冻结 M-01～M-04 Test Model；
3. 生成、审核并冻结 TestCondition 和原子 TestCase；
4. 补齐真实目标 Agent API/工具契约及 OpenInference Trace；
5. 建立并人工审核 Dataset Sample；
6. 校准代码 Evaluator 和必要的 LLM Judge；
7. 运行 Phoenix Experiment，并回链当前 Approved 版本；
8. 重新执行 OPA Release Gate；
9. 建立 RAG 相关性标注集，比较 Dense、BM25 和 Hybrid；
10. 完成 SkyWalking、只读数据库和源码证据的 Failure Triage 全链路验收。

## 19. 常见面试问题与回答

### Q1：TestMesh 和普通测试管理平台有什么区别？

普通测试管理平台主要管理用例和执行结果。TestMesh 更强调 Agent/AI 应用的质量证据：Prompt、Dataset、Experiment、Trace、工具调用、Evaluator 和人工标签，同时把这些证据与 Requirement Baseline 和发布策略关联。它也不试图替换成熟 TMS，而是解决跨 AI 评测和自动化工具的业务追溯问题。

### Q2：为什么不直接从 PRD 生成 TestCase？

因为中间缺少可审核的行为模型和测试条件时，模型很容易遗漏状态、异常和组合分支，也容易生成重复用例。Test Model 负责描述系统应如何工作，TestCondition 负责拆出独立验证目标，TestCase 才负责执行表达。分层后可以在更低成本阶段发现缺口。

### Q3：如何防止大模型幻觉？

不能完全依靠 Prompt。平台限制输入来源，要求 source/chunk ID，使用结构化输出，对引用、覆盖、版本和语义做确定性 Gate，再加人工审批；执行阶段再用真实 Runner、业务状态和 Trace 验证。

### Q4：RAG 为什么选择 Hybrid Search？

Dense 擅长语义相似，BM25 擅长规则 ID、字段名、编码和精确关键词。测试资料同时存在自然语言和大量结构化术语，因此两路召回后用 RRF 融合更稳健。项目暂时不调整权重或上 reranker，因为没有相关性标注集时调参没有证据。

### Q5：为什么 Phoenix 不自己实现？

Dataset、Experiment、Trace、Evaluator 调度和比较是通用平台能力，自研成本高且容易不完整。TestMesh 只需要记录企业业务 ID、批准状态、风险容忍度和准入关系。Phoenix 作为事实来源更符合薄控制层原则。

### Q6：LLM 输出不稳定，回归测试怎么做？

先把可确定部分转成代码断言，例如 Schema、字段值、工具名、参数范围和状态；语义部分用带人工标签的 Dataset 和校准 Evaluator；每次运行固定模型、Prompt、Dataset 和配置版本，比较样本级结果而不是只比较平均分，并设置硬门槛和人工复核区间。

### Q7：如何测试多轮对话？

把会话状态显式建模，验证每一轮的输入、状态更新、保留/覆盖/清除逻辑、工具参数和最终回复。每个样本拥有独立 session，不能跨样本泄漏；Experiment 证据需要同时保存轮次输入、状态和工具轨迹。

### Q8：质量门禁为什么用 OPA？

发布规则会频繁调整，而且应与业务代码分离。OPA 可以对结构化质量事实执行确定性策略，并保存策略版本、输入和输出。这样能审计“为什么 allow/deny”，也避免让 LLM 直接决定是否发布。

### Q9：如何判断项目真的完成，而不是页面能点？

完成标准包含真实样本、真实依赖、真实执行结果、持久化恢复、证据回链和自动检查。受控模拟只能证明工程链路，不能代替真实业务验收。项目文档会明确标记 simulated、controlled 或 waiting real contract。

### Q10：项目最大的教训是什么？

最大的教训是“结构化输出不等于工程正确，设计覆盖不等于质量通过”。一次历史 OPA allow 就暴露了这一点：虽然 9 个 AI 维度都有用例，但没有当前版本的 Experiment 证据。修复后策略要求版本一致的 Dataset、Experiment、Evaluator 和通过结果，最新结论正确变为 deny。

### Q11：如果真实业务接入，哪些部分可以替换？

替换 PRD、业务规则、项目知识、Agent API/工具契约、真实数据样本和质量阈值；保留 Requirement→Model→Condition→Case→Dataset→Experiment→Gate 的资产链、审批机制、Schema/Gate、Phoenix/OPA 集成和执行器适配。

### Q12：为什么要把 TestMesh Agent 和被测 Agent 分开？

TestMesh Agent 是测试资产生成和分析工具，被测 Agent 是质量评估对象。二者的 Prompt、版本、Trace、风险和成功标准不同。如果混在一起，会把测试工具的正确性误当成目标业务 Agent 的正确性。

## 20. STAR 项目案例

### 20.1 发布门禁误放行纠偏

**Situation**：质量计划已经覆盖 9 个 AI 维度，但目标 Agent 尚无当前 Approved TestCase 版本对应的 Phoenix Experiment。早期策略却给出了 allow。  
**Task**：确保设计覆盖和执行证据成为两道独立门槛。  
**Action**：分析质量事实模型，增加 Approved Version、Dataset Version、Experiment、Evaluator、样本覆盖和通过状态的关联检查；保留历史错误决策用于审计；增加正反策略测试。  
**Result**：最新门禁正确返回 deny，并明确列出 49 条 AI TestCase 的证据缺口，避免模拟数据或旧实验导致发布误判。

### 20.2 RAG 架构升级与项目隔离

**Situation**：原系统只有 Dense 检索，而且项目知识绑定没有在查询层形成硬隔离。  
**Task**：提高规则 ID、字段名等精确内容的召回，同时阻止跨项目召回。  
**Action**：调研 LlamaIndex、Haystack、Ragas 和 Qdrant 后，选择最小改造路径；升级 Qdrant 1.20.1，增加 multilingual BM25、Dense prefetch 和原生 RRF；对两路查询同时应用 document ID filter；未绑定知识时不暴露 Agent 搜索工具。  
**Result**：原集合无损升级并保持 green，真实 Hybrid Query 返回结果；新增自动化测试验证索引、两路召回、RRF 和项目过滤。后续指标评测被明确留到标注集阶段，不夸大效果。

### 20.3 真实文档证据回链

**Situation**：模型可能改写原文、产生错误页码，或者在多来源场景中给出没有依据的优先级。  
**Task**：让需求分析结果能被人工核对和审计。  
**Action**：使用 Docling 元素 provenance 作为真值；服务端按元素编号回填准确页码和逐字原文；来源优先级只在多来源时校验；无证据引用由 Gate 拒绝。  
**Result**：真实 16 页中文 PRD 成功形成带准确引用的分析结果和 Phoenix Trace，并发现、修复了超时、引用改写、页码偏差和追踪器加载顺序问题。

### 20.4 失败诊断防幻觉

**Situation**：UI 测试出现两个 30 秒超时，但只有 Runner 和页面 Trace，没有后端日志、数据库或源码证据。  
**Task**：生成有帮助但不伪造根因的诊断。  
**Action**：设计事实、假设、反证、missing evidence 和 source location 分层 Schema；完成门要求事实必须带 evidence ref，located 必须有更强证据。  
**Result**：Agent 正确返回 suspected/unknown，列出前端未渲染、定位器不匹配和环境路由异常三类候选，并明确要求补充 Trace、源码和日志，没有虚构后端或数据库根因。

## 21. 简历表述参考

### 21.1 项目描述

设计并实现面向 Agent/生成式 AI 应用的质量保障工作台 TestMesh，建立从 Requirement Baseline、Test Model、TestCondition、TestCase 到 Dataset、Experiment、Trace、质量报告和 OPA 发布准入的可追溯工程闭环。

### 21.2 可选要点

- 基于 Deep Agents、LangGraph 和 PostgreSQL 实现可中断、可恢复、带人工审批的 AI 测试资产工作流，通过 Schema、确定性 Gate 和不可覆盖版本约束模型输出。
- 集成 Docling 完成 PDF/Office/OCR/表格解析和原文 provenance 回链，真实中文 PRD 分析接入 Phoenix OpenInference Trace。
- 设计 M-01 语义参数、M-02 业务决策、M-03 会话状态、M-04 Agent 交互四类模型，将冻结需求系统化转换为 TestCondition 和原子 TestCase。
- 基于 Phoenix 构建 Dataset、Experiment、Evaluator 和 Trace 评测底座，区分代码断言、字段级匹配、LLM Judge 校准和人工抽检。
- 基于 Qdrant 1.20 实现项目级 Dense + multilingual BM25 + RRF 混合检索，并通过 payload filter 消除跨项目知识召回风险。
- 基于 OPA/Rego 实现可审计发布门禁，将设计覆盖和真实执行/AI 评测证据分离，识别并修复无当前 Experiment 证据却错误放行的问题。
- 集成 Schemathesis、Hurl 和 Playwright，统一回链 Approved TestCase、TestRun、Trace 和失败诊断证据。

不要在简历中把智能导购描述成真实线上业务，也不要写未经标注集验证的 RAG 指标。

## 22. 演示建议

面试现场建议只演示一条清晰主线，不要逐个展示所有菜单：

1. 打开项目和 Quality Plan，解释发布目标和当前门禁；
2. 展示带原文引用的需求分析与冻结 Baseline；
3. 展示 M-01～M-04 Test Model 及其批准状态；
4. 展示 TestCondition 到 TestCase 的一对一追溯；
5. 选择一条 AI 用例，说明 oracle、Evaluator、threshold 和 Dataset requirement；
6. 打开 Phoenix，展示 Dataset/Experiment/Trace 的职责；
7. 返回 TestMesh 展示分层质量指标和 OPA deny 原因；
8. 最后展示 RAG 项目绑定和 Hybrid 检索架构，而不是只展示搜索结果。

如果时间只有 5 分钟，优先演示“Baseline → Model → Case → Phoenix Evidence → OPA Gate”。

## 23. 可主动提出的反思

- 当前前后端仍在同一仓库和同一服务进程中，未来需要按团队和负载拆分领域服务与异步任务；
- AI 资产链较长，产品交互需要继续降低审批负担，并提供批量审核和差异视图；
- 当前模拟业务适合验证流程，但无法代表真实分布，需要尽快用真实 Agent 契约和生产风险样本建立评估集；
- RAG 有真实工程验收但缺检索标注集，不能只凭主观搜索结果判断质量；
- LLM Judge 的校准、漂移监控和跨模型一致性仍需要持续建设；
- 质量门禁必须防止指标游戏，不能用单一综合分掩盖关键证据缺失。

## 24. 术语速查

| 术语 | 含义 |
| --- | --- |
| Requirement Baseline | 人工评审并冻结的需求真值版本 |
| Test Model | 对业务行为、状态、决策、交互、风险和覆盖的结构化描述 |
| TestCondition | 可独立判定的测试目标，不包含完整执行步骤 |
| TestCase | 对 TestCondition 的原子执行表达 |
| Dataset | 版本化评估样本集合 |
| Experiment | 固定目标版本和 Dataset 的一次批量运行 |
| Evaluator | 对单样本或运行结果进行确定性或语义评分的组件 |
| Trace | Agent、LLM、Tool 和 Chain 的执行轨迹 |
| Oracle | 判定预期结果是否满足的依据和方法 |
| Groundedness | 回复是否被提供的上下文或证据支持 |
| RRF | Reciprocal Rank Fusion，对多个检索排名进行融合 |
| Release Gate | 基于质量事实决定 allow/review/deny 的发布门禁 |
| Evidence Gate | 对来源、引用、覆盖和执行证据做确定性检查 |

## 25. 最后总结

面试中最重要的不是说 TestMesh 功能很多，而是讲清楚三件事：

1. **AI 测试对象发生了变化**：除了最终输出，还必须测试上下文、工具、业务状态、Groundedness 和轨迹；
2. **AI 生成不能代替工程约束**：Prompt、Schema、确定性 Gate、人工审批和真实执行证据缺一不可；
3. **平台价值在于质量关系和决策闭环**：成熟组件负责执行，TestMesh 负责让需求、资产、运行证据和发布决定处于同一条可追溯链路中。

如果被追问项目是否已经完整生产化，最准确的回答是：核心工程链路和多个成熟组件集成已经实现并有真实或受控验收；模拟智能导购用于跑通方法，不代表真实业务质量结论；当前最重要的下一步是接入真实目标 Agent 契约和人工标注 Dataset，完成与当前 Approved TestCase 版本一致的 Phoenix Experiment，再由 OPA 做正式准入。
