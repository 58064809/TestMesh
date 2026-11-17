# TestMesh AI 测试工程闭环

## 目标

TestMesh 以质量计划为治理入口，把 AI 辅助需求分析、用例生成、脚本编写、数据构造、执行编排、断言判定、缺陷定位、证据归档、质量评估和报告生成连接为一条可人工修正、可度量、可审计的质量链。TestMesh 只保存业务关联、人工决策、质量事实和外部工具引用，不复制 Docling、Runner、SkyWalking 或 Phoenix 的平台能力。

## 统一资产链

`Source → RequirementAnalysis → RequirementBaseline → ApprovedTestModel → ApprovedTestCase → AutomationScenario/Artifact → TestRun → Assertion/Evaluation → FailureTriage → QualityReport → ReleaseGate → ImprovementAction`

每个下游资产必须引用上游冻结版本。候选内容不能绕过人工评审进入执行或发布准入；人工修正必须保留修改前后、原因、人员和时间。

## 能力、证据与度量

| 环节 | TestMesh 责任 | 复用成熟能力 | 必须归档的证据 | 核心指标 | 当前状态 |
| --- | --- | --- | --- | --- | --- |
| 需求分析 | 结构化问题、原文引用、人工修正、冻结基线 | Docling；受控 Agent 工作流 | 文件 SHA-256、source ref、候选项、评审与 amendment、Baseline | 人工决策率、修正数、引用完整性、基线状态 | 已实现 |
| 测试建模 | 从冻结基线建立质量、业务、风险、覆盖和 AI 分层模型，人工修正后冻结 | Deep Agents Skills；Docling/Qdrant 证据 | Test Model、amendment、批准人、Approved Test Model | 模型覆盖完整度、来源完整性、模型修正数 | 已实现首个闭环 |
| 用例生成 | 只读取 Approved Test Model 生成统一 TestCase，人工评审后冻结 | Cucumber/Gherkin、fast-check、ACTS、GraphWalker、Phoenix Evals | model version、test condition、technique、source/trace/risk refs、评审、Approved TestCase | 需求覆盖、AI 维度覆盖、接受率、追溯完整度 | 已实现；外部 RAG 数据待接入 |
| 数据构造 | 描述等价类、边界、组合、会话数据和预期状态；真实敏感数据不交给模型自由生成 | fast-check、ACTS、项目数据源 | TestCase `test_data`、Dataset ID/Version、生成规则、数据来源与脱敏标记 | 测试数据设计覆盖率、Schema 合法率、边界/组合覆盖率 | 设计覆盖已度量；真实 Dataset 生产链待接入 |
| 脚本编写 | 根据 Approved TestCase 与真实契约生成候选脚本/YAML，校验后人工批准 | FastAPI/Pydantic、httpx、Schemathesis、Playwright | 用例版本、契约版本、候选脚本版本、校验结果、批准人 | 校验通过率、用例到脚本覆盖率、人工修改率 | YAML 引擎与校验已实现；FastAPI 场景持久化/审批/UI 迁移中 |
| 执行编排 | 使用项目环境配置运行，通过变量、foreach、if/elif/else 组织步骤；保存不可篡改结果 | httpx、Schemathesis、Playwright；Testcontainers 规划中 | 环境 ID、Runner/依赖版本、输入、开始结束时间、状态、重试与产物 | 完成率、通过率、错误率、耗时、失败重试率 | API 引擎隔离验证通过；真实业务环境待验收 |
| 断言判定 | 区分确定性断言、契约断言和 AI 评估；逐条保留预期、实际与失败原因 | JSONPath/Regex/SQL、Schemathesis、Phoenix Evaluator | assertion/evaluator 名称与版本、expected、actual、evidence refs、判定 | 断言设计覆盖率、Evaluator 覆盖率、误报复核率 | 设计覆盖已度量；FastAPI 统一 TestRun 断言持久化待完成 |
| 缺陷定位 | 只基于执行证据、调用链、数据库和源码形成事实、假设和缺失证据；人工确认后提交 | SkyWalking TraceQL、项目只读数据库、源码仓库、Agent | failed TestRun、trace/span、query summary、source location、事实引用、人工确认 | 失败定位覆盖率、已定位率、证据源覆盖、平均定位耗时、Top-k 准确率 | 结构化诊断与证据校验已实现；PG/MySQL/SkyWalking 真实环境待验收 |
| 质量评估 | 对 Agent/AI 应用运行 Dataset、Experiment、Evaluator，并与 Approved TestCase 版本绑定 | OpenTelemetry、OpenInference、Arize Phoenix | Dataset/Version、Experiment、Trace、Evaluator、被评用例 ID、状态 | AI 维度覆盖率、被评用例数、幻觉/准确性/工具调用等指标、回归差异 | 已建立引用和准入校验；真实实验持续补充 |
| 报告与准入 | 从冻结快照确定性生成报告；OPA 依据事实作 allow/review/deny；问题进入改进闭环 | OPA/Rego | 报告快照、Markdown、SHA-256、策略版本、OPA 输入输出、风险接受、改进验证证据 | 发布准入结果、未关闭改进项、证据缺口 | 已实现并归档，不由 AI 补造缺失结论 |

## 指标解释边界

- 没有分母或没有真实运行数据时，指标表示“当前无可用样本”，不得解释为质量良好。
- `testDataSpecificationCoveragePct` 只表示 Approved TestCase 是否定义测试数据，不等于数据生成正确。
- `assertionDesignCoveragePct` 只表示用例具备可执行的预期设计，不等于断言已在 Runner 中执行。
- `failureTriageCoveragePct` 表示失败 TestRun 是否产生定位记录；`locatedFailureRatePct` 表示这些记录中有多少达到“已定位”。
- 外部平台结果只保存 ID、版本、状态和必要摘要；需要复核时回到原平台查看原始 Trace、Experiment 或报告。

## 质量度量目录

报告把指标分为“可计算”和“暂无数据”两种状态，并同时给出分子、分母、计算口径和证据来源。

| 指标 | 口径 | 当前数据源 |
| --- | --- | --- |
| 需求覆盖率 | 已覆盖或有批准排除理由的需求 / 需求基线总数 | Requirement Baseline、Approved TestCase coverage |
| 执行完整率 | 至少被一个 TestRun 覆盖的 Approved TestCase / Approved TestCase 总数 | Schemathesis、FastAPI YAML、Playwright TestRun 关联 |
| 执行通过率 | 通过测试项 / 已执行测试项 | TestRun |
| 追溯完整度 | 具备 Requirement、Source、TestPoint 引用的用例 / Approved TestCase 总数 | Approved TestCase |
| 测试数据设计覆盖率 | 已定义 test_data 的用例 / Approved TestCase 总数 | Approved TestCase |
| 断言设计覆盖率 | 具备明确预期或 Oracle 的用例 / Approved TestCase 总数 | Approved TestCase |
| AI 用例评测完整率 | Phoenix 已评测 AI 用例 / AI 用例总数 | Phoenix Dataset/Experiment 引用 |
| 失败定位覆盖率 | 已产生 FailureTriage 的失败 TestRun / 失败 TestRun 总数 | TestRun、FailureTriage |
| 缺陷逃逸率 | 发布后发现的有效缺陷 / 发布前与发布后发现的有效缺陷总数 | 待接入缺陷平台和发布版本；没有真实数据时显示“暂无数据” |
| 缺陷重开率 | 被重开的缺陷 / 已关闭缺陷 | 待接入 Jira、MeterSphere 等缺陷生命周期 |
| 严重缺陷关闭率 | 已关闭的 blocker/critical 缺陷 / blocker/critical 缺陷总数 | 待接入缺陷平台 |
| 平均缺陷定位时长 | 人工确认定位时间 - 失败发生时间 | 待补 FailureTriage 人工确认时间 |
| 不稳定用例率 | 相同版本和环境下结果发生非预期波动的用例 / 重复执行用例总数 | 待建立重复执行与 flaky 判定 |
| 生产事故率 | 关联发布后的生产事故数 / 发布次数 | 待接入发布与生产事故记录 |

缺陷逃逸率不使用“生产缺陷 / 全部缺陷”这种未限定版本和有效状态的模糊口径；必须绑定发布批次，并排除无效、重复和非本版本缺陷。

## 发布闭环

1. 质量计划冻结目标、风险、范围、证据要求和门槛。
2. Requirement Baseline、Approved Test Model 与 Approved TestCase 依次完成人工批准。
3. 没有冻结测试模型时禁止生成 TestCase；自动化候选物通过结构校验和人工审核后才能执行。
4. TestRun 保存确定性断言与外部评估引用；失败进入 FailureTriage。
5. 质量快照计算覆盖、评审、数据、断言、执行、诊断、AI 评估和改进指标。
6. 质量报告保存生成时快照、正文和 SHA-256，历史报告不可被新数据覆盖。
7. OPA/Rego 使用同一批质量事实作正式发布判断。
8. `review` 只能进行有责任人、有理由、可失效的风险接受；`deny` 必须修复。
9. 准入问题、缺陷定位和复盘结论形成改进项，验证证据完成后才能关闭，并进入下一轮质量计划。

## 当前不能宣称完成的事项

- FastAPI YAML 场景尚未完成项目配置绑定、不可变版本、统一 TestRun 持久化和 React 产品入口迁移。
- PG、MySQL 和 SkyWalking 适配器已通过隔离测试，但尚缺真实公司环境验收。
- 测试数据目前有设计覆盖度，没有真实 Dataset 生产、脱敏、版本和质量校验全链。
- 缺陷定位还缺标准缺陷集，因此不能宣称 Top-k 定位准确率或平均定位时间达标。
- Phoenix 只有与当前 Approved TestCase 版本绑定并覆盖全部目标用例的已通过 Experiment，才可作为发布准入证据。
