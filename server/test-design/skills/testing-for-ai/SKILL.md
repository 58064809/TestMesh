---
name: testing-for-ai
description: 为 AI/Agent 功能规划意图识别、参数提取、多轮上下文、约束保持、回答正确性、幻觉、工具调用、安全拒答与鲁棒性测试，并映射到 Phoenix Dataset/Experiment/Evaluator。
---

# Testing for AI 测试设计

本 Skill 只在批准基线明确涉及 AI、LLM、Agent、智能问答、意图路由、RAG 或工具调用时使用。不要把普通确定性业务功能强行转成 AI 评测。

## 必须分析的质量维度

## 双对象、四层证据模型

所有 Testing for AI 用例先声明评测对象：`testmesh`（TestMesh 自身的需求分析、用例设计、脚本生成、缺陷定位等 Agent）或 `target_application`（被测业务 AI/Agent）。两类对象使用相同的证据纪律，不能因为 TestMesh 是测试工具就跳过自测。

每条用例再声明一个或多个评测层：

1. `agent_decision`：意图/任务识别、规划、路由、是否澄清、是否拒绝、工具选择和停止条件。证据来自结构化决策、状态、规划事件或 Trace，不从最终回复反推。
2. `tool_execution`：实际调用的工具、顺序、参数、权限、次数、重试、幂等和错误处理。证据来自 OpenInference tool spans、请求响应和执行日志。
3. `business_outcome`：数据库、缓存、消息、工单、订单状态或其他业务副作用是否正确且一致。证据来自受治理的只读查询、业务 API、事件或状态快照；“接口返回成功”不能代替业务结果。
4. `final_response`：最终回复的正确性、完整性、Groundedness、约束保持、安全性和可理解性。证据来自输出、reference/context 以及 Code/LLM/Human Evaluator。

四层必须逐层考虑。确实不存在某层时记录 `not_applicable` 及理由；不得把最终回复通过当成前三层通过，也不得用工具调用成功证明业务状态正确。

1. **意图识别**：同义表达、口语、错别字、混合意图、未知意图和意图边界；预期包括正确路由、澄清或安全拒绝。
2. **多轮上下文**：指代、省略、话题切换、回到旧话题、上下文冲突、长对话和会话隔离；检查关键事实能否保持且不同用户上下文不能串线。
3. **约束保持**：系统指令、业务规则、角色权限、输出格式和禁止行为在多轮、干扰信息及工具返回后仍需保持。
4. **回复准确性**：有确定答案时优先采用 exact match、结构化字段、reference answer 或代码 Evaluator；开放答案才使用人工审核或经过验证的 LLM Judge。
5. **Groundedness / 幻觉**：回答中的事实必须被输入上下文、检索文档或工具结果支持；资料不足时应澄清或承认未知，不能编造政策、订单、金额、链接和来源。
6. **参数提取**：只在基线或接口/工具契约证明被测系统需要槽位、结构化输出或工具参数时启用；区分语义提取、结构与业务校验、工具参数映射三层证据。
7. **工具使用**：验证工具选择、参数、调用顺序、错误处理、幂等性以及工具结果到最终回复的传递，不以“最终文字看起来合理”替代工具轨迹检查。
8. **安全拒答**：越权请求、提示注入、敏感信息和高风险操作应拒绝或进入人工确认；正常请求不能过度拒绝。
9. **泛化、鲁棒性与一致性**：泛化验证系统在未参与提示词/规则调试的 held-out 业务切片上是否仍有效；鲁棒性验证输入或运行条件发生合理扰动时性能能否保持，超出能力边界时能否安全失败；一致性验证同一版本、相同输入多次执行时关键标签、工具轨迹和业务动作是否稳定。不得用“回复文字不同”直接判失败，也不得用平均分掩盖最差切片。

### 泛化与鲁棒性变体协议

先建立人工确认的基准样本，再按一个变体只改变一个主要因素的原则形成变体组。每条变体必须记录 `variantGroupId`、`baselineSampleId`、`perturbationFamily`、`expectedRelation`、`evaluationSlice`、样本来源和是否 held-out。

- `paraphrase`：同义改写、口语化、句式变化。
- `typo_noise`：错别字、空格、标点、大小写和轻度字符噪声。
- `format_structure`：列表、JSON、Markdown、换行和字段顺序变化。
- `irrelevant_context`：加入无关背景，但不能改变任务事实。
- `length_boundary`：极短、省略、长上下文以及接近上下文窗口的输入。
- `tone_persona`：礼貌、急躁、抱怨、专业或非专业表达。
- `entity_value_shift`：更换订单、金额、时间、商品等实体，期望应随事实受控变化。
- `language_locale`：语言、方言、地区格式、时间和金额表达变化。
- `order_reordering`：条件和事实顺序变化。
- `negation_conflict`：否定、纠正、前后冲突和撤销。
- `multi_turn_drift`：话题切换、上下文拉长、回到旧任务和会话隔离。
- `out_of_distribution`：超出已知业务、知识或工具能力边界，必须澄清、拒绝或转人工。
- `prompt_injection`：直接或间接注入；重点验证权限、工具白名单、敏感信息和人工确认，不宣称能消除该风险。
- `tool_dependency_failure`：工具超时、错误、空结果、部分成功和不可信返回。
- `repeatability`：同版本同样本至少重复 3 次，比较关键类别和业务动作，不要求逐字一致。

期望关系只能是：`invariant`（关键语义/路由/动作保持）、`controlled_change`（输入事实变化后结果按 Oracle 受控变化）、`fail_safe`（超出边界时不编造、不越权并提供安全恢复路径）。

Phoenix Dataset 使用 metadata 保存变体组和切片，Experiment 使用 repetitions 执行重复试验；报告至少给出基准通过率、变体通过率、鲁棒保持率、最差切片通过率、重复一致率、工具轨迹一致率和相对已批准版本的退化率。TestMesh 只保存这些业务门槛及 Phoenix 证据链接。

### Evaluator 校准先于批量执行

- 确定性字段、Schema、工具参数和状态优先使用 Phoenix Code Evaluator；主观语义才使用 LLM Judge。
- 为每个 Evaluator 建立独立 Phoenix 金标准 Dataset，必须同时包含通过/失败、常规/边界、泛化/扰动和高风险样本，不能只用全通过样本。
- 人工标注与 Evaluator 输出使用有限类别标签；连续分数不得直接作为发布准入结论。
- 每个金标准样本的 Evaluator 至少重复运行 3 次；有人工分歧时必须仲裁并保留说明。
- 校准报告必须包含 Accuracy、Macro-F1、逐类别 Precision/Recall/F1、人工一致性、Evaluator 重复一致性、最差切片准确率和混淆矩阵派生数据。
- 初始工程门槛由质量计划版本化配置，不冒充行业统一标准；校准不通过的 Evaluator 不得用于解除批量 Experiment 门禁。

## 参数提取专项

先输出 `parameter_extraction_assessment`：

- 没有证据表明存在参数提取能力：`not_applicable`，不得生成参数提取用例。
- 能力存在但缺少参数 Schema、归一化、上下文或工具契约：`blocked`，明确缺口，不猜字段、默认值或业务阈值。
- 契约足够：`applicable`，逐项规划以下 18 个 aspect；确实不适用的项目必须写明理由，不能静默遗漏。

`parameter_identification`、`value_accuracy`、`completeness`、`no_redundancy`、`type_conformance`、`semantic_normalization`、`ambiguity_handling`、`negation_exclusion`、`multi_value`、`conflict_resolution`、`context_inheritance`、`context_override`、`required_missing_clarification`、`business_constraint`、`noise_robustness`、`tool_parameter_mapping`、`repeatability`、`prompt_injection_resistance`。

每条参数提取用例只能以一个 aspect 为主要判定目标，并填写字段级协议：三层位置、槽位名、是否应出现、JSON 期望值、类型、匹配方式、归一化规则、容差、期望动作、`slot_delta/merged_slots/tool_arguments` 状态目标、固定参考时间、时区、语言、Schema 版本和风险等级。

- ID、枚举、整数和布尔量可用 exact；金额、单位和时间先 normalized；范围用 range；多值用 set；位置、名称和自然语言偏好使用 semantic 或人工复核。
- `missing`、`null`、业务 `default` 必须区分。缺少必填参数后是否澄清属于流程决策，不能与语义漏提混为一个错误。
- 多轮同时校验本轮 `slot_delta` 和合并后 `merged_slots`，覆盖继承、覆盖、撤销、任务切换与会话隔离。
- 必须固定 `reference_datetime/timezone/locale`，避免“明天”等相对时间随运行日期漂移。
- 工具映射检查实际调用事件，不能仅凭最终回复推断；不可信检索内容、文件或工具返回不能覆盖用户指令、Schema 与业务约束。
- 字段级结果、Precision/Recall/F1、Exact Match、Schema 合法率、无依据参数率、归一化/上下文/澄清/工具映射准确率交由 Phoenix Dataset/Experiment/Evaluator 保存和计算，TestMesh 只保存业务追溯 ID 与准入引用。

## TestCondition 与 TestCase 要求

- AI 测试条件使用对应 `ai_dimension`；用例使用 `scenario_type=ai_behavior`、`technique=ai_evaluation`。
- 每条 AI 用例必须声明 oracle、期望行为、Evaluator、阈值、Dataset 样本要求和执行证据要求。
- 可确定判断的内容优先使用 Phoenix code evaluator（exact match、contains、regex、JSON差异或自定义代码）。
- 正确性、相关性、faithfulness 等主观判断可以使用 Phoenix 经过基准验证的 Evaluator，但必须保存评分、标签和解释，并保留人工抽检。
- 多轮测试的输入必须保存完整 messages，而不是把最后一句单独作为样本。
- 幻觉测试必须提供允许依据的 context/reference，并验证输出是否有无依据声明。
- 一个用例只验证一个主要 AI 风险；不要在一条用例中混合意图、幻觉、安全和工具调用四种判定。

## 质量管理回链

AI TestCase 必须回链质量计划中的 AI 质量属性和风险，并在执行后产生 Phoenix Dataset Version、Experiment、Trace 与 Evaluation 证据。只有固定评估集上的版本比较才能进入发布准入；临时聊天体验不能作为准入证据。
