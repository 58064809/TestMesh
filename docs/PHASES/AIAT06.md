# AIAT06 — Evaluator 校准与分层 AI 质量证据

## 决策

批量执行不能先于 Evaluator 校准。未经校准的 LLM Judge 或规则 Evaluator 产生再多结果，也不能证明被测 AI 应用或 TestMesh Agent 的质量。

TestMesh 采用 Phoenix 的 Dataset、Experiment、Annotation 与 Evaluator 能力，不建设第二套评测运行平台。TestMesh 只保存校准业务 ID、不可变哈希、指标快照、门槛结论和 Phoenix 证据链接。

## 依据

- NIST AI RMF 要求 TEVV 过程客观、可重复、可扩展并记录测量方法、不确定性、基准比较与独立复核：[NIST AI RMF 1.0](https://www.nist.gov/publications/artificial-intelligence-risk-management-framework-ai-rmf-10)。
- NIST 将鲁棒性/泛化定义为系统在多种情况中维持性能，并要求使用代表预期使用条件的测试集、分层报告结果：[NIST AI Risks and Trustworthiness](https://airc.nist.gov/airmf-resources/airmf/3-sec-characteristics/)。
- Phoenix 明确支持 Human、LLM、Code 三类 Annotation，并建议以人工标注校准自动 Evaluator：[Phoenix Annotations](https://arize.com/docs/phoenix/tracing/concepts-tracing/concepts-annotations)。
- Phoenix 建议生产判断优先使用二元或有限多类别标签；连续评分容易随提示词和模型波动：[Phoenix Eval Data Types](https://arize.com/docs/phoenix/learn/evaluation/eval-data-types)。
- Phoenix Dataset 原生保存 input、expected output、metadata、splits 和版本，可用于固定评估集与切片比较：[Phoenix Datasets](https://arize.com/docs/phoenix/learn/datasets-and-experiments/datasets-concepts)。
- OWASP 指出 Prompt Injection 无法被完全消除，因此鲁棒性验证必须同时检查最小权限、输出校验和高风险人工确认，而不是只比较回复文本：[OWASP Prompt Injection](https://genai.owasp.org/glossary/prompt-injection/)。

## Evaluator 校准流程

1. 在 Phoenix 建立独立金标准 Dataset Version。
2. 样本覆盖通过/失败、常规/边界、泛化/扰动、高/低风险和至少两个业务切片。
3. 人工标注使用类别标签；分歧必须仲裁并记录说明。
4. 每个样本对同一 Evaluator 至少重复执行 3 次。
5. TestMesh 登记 Phoenix Dataset/Version/Experiment ID 和逐样本人工标签、Evaluator 重复标签。
6. TestMesh 计算 Accuracy、Macro-F1、逐类别 Precision/Recall/F1、重复一致率、人工一致率、双人复核覆盖率和最差切片准确率。
7. 校准指标未达到版本化门槛时保存失败证据，但不得解除批量 Experiment 阻断。

默认初始门槛是 TestMesh 的工程候选值，不是行业统一标准：样本数 ≥20、Accuracy ≥85%、Macro-F1 ≥80%、最差类别 Recall ≥75%、重复一致率 ≥90%、最差切片 Accuracy ≥70%、双人复核覆盖率 ≥20%。质量计划积累真实数据后应版本化调整。

## 双对象 × 四层证据

两个评测对象：

- `testmesh`：需求分析、用例设计、脚本生成、失败诊断等 TestMesh Agent。
- `target_application`：被测业务 AI、对话系统或 Agent。

四个证据层：

| 层级 | 核心问题 | 主要证据 |
| --- | --- | --- |
| Agent 决策层 | 意图、规划、路由、澄清、拒绝和停止条件是否正确 | 决策状态、规划事件、Trace |
| 工具执行层 | 工具、参数、顺序、权限、重试、幂等与错误处理是否正确 | OpenInference tool spans、请求响应、日志 |
| 业务结果层 | 数据库、缓存、消息、工单、订单等真实副作用是否正确 | 只读查询、业务 API、事件和状态快照 |
| 最终回复层 | 回复是否正确、完整、有依据、守约束且安全 | 输出、reference/context、Code/LLM/Human Eval |

最终回复通过不能替代前三层通过；工具返回成功也不能替代业务结果正确。不存在的层必须显式记录不适用原因。

## 泛化与鲁棒性

样本通过 `variantGroupId + baselineSampleId` 成组，记录扰动族、期望关系、评测切片、来源与 held-out 状态。支持同义改写、错别字噪声、格式结构、无关上下文、长度边界、语气角色、实体值变化、语言地区、顺序变化、否定冲突、多轮漂移、分布外输入、提示注入、工具依赖故障和重复运行。

三种期望关系：关键结论保持、按输入变化受控改变、超出能力时安全失败。报告必须给出变体保持率与最差切片，不能只给总体平均分。

## 当前状态

当前没有真实目标 AI 校准集和人工金标准，因此 Evaluator 校准列表为空，批量 Phoenix Experiment 保持阻断。页面提供登记入口，但示例结构不会写入数据库，也不能作为准入证据。
