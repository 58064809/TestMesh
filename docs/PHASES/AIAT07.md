# AIAT07 — AI 应用测试建模到 Dataset 设计

## 产品链路

`Approved Requirement Baseline → Approved Test Model → Approved TestCondition → Approved AI TestCase → Dataset Specification → 经人工审核的 Sample Set → Phoenix Dataset Version → 经校准的 Evaluator → Experiment`

传统 API 自动化和 AI 应用测试分开呈现。两者共用项目配置、YAML 执行底座、TestRun、追溯、失败诊断和质量报告。AI 应用测试额外管理会话输入、工具轨迹、Dataset、Evaluator 和 Experiment。

## 本阶段实现

- Dataset Specification 从冻结的 AI TestCase 确定性派生，列明来源 TestCondition、评测对象与证据层、Oracle、Evaluator、门槛、样本和执行证据要求。
- 一个 TestCase 可以关联多条独立 Sample。真实输入与期望由人工填写或修正，逐条审核后才能冻结。
- 样本引用的原文证据、评测对象和证据层必须属于所关联 Approved TestCase；同一用例的重复输入阻止冻结。
- 页面将 Dataset 设计与样本、Evaluator 校准、Experiment、评测配置按步骤展示。Phoenix 仍是 Dataset Version 和 Experiment 的事实来源。
- Phoenix Experiment 的每一行 Example 将样本 ID 与 `input` 传入已批准 FastAPI AI YAML 场景，脚本必须在实际步骤中引用 `${dataset_input...}`；样本执行与内联 `data_driven` 不可叠加。TestRun 保存 `dataset_sample_id` 与输入变量，Phoenix Example 元数据携带 Approved Test Model Version、模型元素、TestCondition、TestCase、风险和 Evaluator 名称。未绑定样本输入的场景不能进入 Experiment。

## 当前验收边界

清理旧测试数据后，当前没有 Approved Test Model、Approved AI TestCase 或真实目标 Agent 契约。页面应呈现空态；不能生成真实评测样本或宣称 AI 应用质量通过。后续在模型、用例与契约批准后填充样本并执行真实验收。

2026-11-12 增加版本化的[智能导购受控模拟](../../examples/ai-application/README.md)。独立目标服务与三轮 YAML 已通过真实本机 HTTP：3 个请求步骤及 1 个 Trace ID 格式检查步骤通过，失败 0；验证了跨轮次约束继承、完整工具筛选参数、仅推荐固定夹具中两款商品。模拟服务只生成符合格式的 Trace ID，没有 OpenInference Span；此为隔离工程调试，未写入正式 Approved TestCase、Phoenix Dataset 或发布准入事实。

2026-11-16 开始按完整方法资料收敛落地。Test Model 契约升级为 `test-model/v2`，新增四个通用行为模型视图：M-01 语义与参数、M-02 业务决策、M-03 会话状态、M-04 Agent 交互。四个视图由所选冻结基线和受治理知识生成，不包含羽毛球拍等硬编码业务内容。模型阶段的候选条件仅用于覆盖自检，正式 TestCondition 仍由独立 Prompt、Schema、人工批准和不可覆盖版本管理，页面不再把两者展示为同一资产。智能导购基线及其全部下游结果继续明确标记为 `simulated`，只验证流程方向和可替换接口，不构成真实业务验收证据。

同日已在本机建立独立项目“智能导购模拟”和 `sim-v1` 质量计划草稿，并以模拟契约生成需求分析候选稿（10 条需求、7 条规则、7 个待确认问题）。OpenAPI JSON 原文件经 LangChain 文本分块进入现有 Qdrant 知识库，项目绑定后通过 OpenAPI 校验和实际检索。普通 JSON 此前被错误交给 Docling HybridChunker；已按文件格式修正为成熟的 LangChain `RecursiveCharacterTextSplitter`，Docling 继续处理文档类来源。当前仍缺人工批准的需求基线、模型、用例、Dataset、Evaluator，以及真正的 OpenInference Span；Agent 契约就绪检查应保持未通过，不能把合成 Trace ID 当作 Span。

2026-11-17 增加显式的 `simulation-reference/v1` 参考资产入口，只用于在受控模拟基线上演练 M-01～M-04 和下游审批链。该入口不是 OpenAI 生成失败后的静默兜底；真实项目始终走版本化 Prompt。参考资产在写库前同时经过 Schema、追溯和语义前置门禁，并始终保存为待人工批准的 `draft`。核对现有冻结基线后发现其原文仍明确写着默认数量、单位换算、品牌别名和冲突规则“未定义”，与后来提供的智能导购 V1.0 产品决策冲突；因此系统会拒绝加载参考模型并要求使用最新 PRD 重新分析、评审和冻结新基线。开发过程中误写入的冲突草稿已删除，未产生批准版本或下游资产。
