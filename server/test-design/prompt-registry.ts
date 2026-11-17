import { PROMPT_VERSIONS } from "./asset-contracts.js";

export const TEST_DESIGN_PROMPT_REGISTRY = [
  {
    id: PROMPT_VERSIONS.testModel,
    stage: "test_model",
    loadsPrompt: true,
    inputSchema: "RequirementBaseline + approved PRD + governed knowledge evidence",
    outputSchema: "test-model/v1",
    responsibility: "建立业务、质量、AI、风险与覆盖模型；不得生成 TestCase",
  },
  {
    id: PROMPT_VERSIONS.testCondition,
    stage: "test_condition",
    loadsPrompt: true,
    inputSchema: "Approved TestModel + RequirementBaseline evidence",
    outputSchema: "test-condition-set/v1",
    responsibility: "把模型拆成可独立判定的测试条件；不得生成步骤或样本",
  },
  {
    id: PROMPT_VERSIONS.testCase,
    stage: "test_case",
    loadsPrompt: true,
    inputSchema: "Approved TestConditionSet + Approved TestModel evidence",
    outputSchema: "test-case-set/v1",
    responsibility: "逐条件生成原子 TestCase；不得改写批准条件",
  },
  { id: "none", stage: "approval", loadsPrompt: false, responsibility: "人工决策与确定性状态迁移" },
  { id: "none", stage: "dataset_export", loadsPrompt: false, responsibility: "按批准样本确定性冻结、导出与追溯" },
  { id: "evaluator-specific", stage: "evaluation", loadsPrompt: true, responsibility: "仅 LLM Judge 加载独立且经校准的 Evaluator Prompt；代码判定不加载" },
] as const;

