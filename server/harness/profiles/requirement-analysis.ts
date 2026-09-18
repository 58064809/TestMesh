import { StageProfileSchema, type StageProfile } from "../contracts.js";

export const REQUIREMENT_ANALYSIS_PROFILE_VERSION = "1.0.0";

export const RequirementAnalysisStageProfile: StageProfile = StageProfileSchema.parse({
  id: "requirement_analysis",
  version: REQUIREMENT_ANALYSIS_PROFILE_VERSION,
  description: "在正式需求评审前，对完整需求上下文进行结构化预分析并保留可核对来源",
  context: [
    { id: "current_sources", description: "当前 PRD、流程图、截图和补充说明的来源引用", required: true },
    { id: "previous_baseline", description: "需求变更时的上一份冻结基线", required: false },
    { id: "human_decisions", description: "此前人工确认并允许本次复用的业务决策", required: false },
  ],
  knowledge: [
    { id: "project_glossary", description: "项目业务术语", required: false },
    { id: "approved_domain_rules", description: "已确认领域规则", required: false },
    { id: "historical_decisions", description: "历史已确认业务决策", required: false },
    { id: "source_priority_rules", description: "有明确依据的来源优先级规则", required: false },
  ],
  skills: [
    { id: "requirement-extraction", description: "提取明确需求项", required: true, version: "1.0.0", activation: "always" },
    { id: "business-rule-analysis", description: "识别业务规则及适用范围", required: true, version: "1.0.0", activation: "always" },
    { id: "flow-analysis", description: "存在流程信息时分析业务流程", required: false, version: "1.0.0", activation: "conditional" },
    { id: "state-analysis", description: "存在状态信息时分析状态及迁移", required: false, version: "1.0.0", activation: "conditional" },
    { id: "ambiguity-detection", description: "识别缺失、歧义和冲突", required: true, version: "1.0.0", activation: "always" },
    { id: "source-conflict-analysis", description: "跨来源保留冲突双方证据", required: true, version: "1.0.0", activation: "always" },
  ],
  tools: [
    { id: "read_file", description: "按需读取当前阶段已选择的 Skill", required: true, version: "1.0.0", mutating: false, approval: "never" },
    { id: "read_source", description: "按来源 ID 读取原文或图片", required: true, version: "1.0.0", mutating: false, approval: "never" },
    { id: "locate_source", description: "获得页码、段落或图片定位", required: true, version: "1.0.0", mutating: false, approval: "never" },
    { id: "validate_reference", description: "核对引用是否属于当前任务来源", required: true, version: "1.0.0", mutating: false, approval: "never" },
    { id: "search_knowledge", description: "检索获准的项目知识", required: false, version: "1.0.0", mutating: false, approval: "never" },
  ],
  policies: [
    { id: "no_fabrication", description: "不存在的信息保持为空，不编造业务规则、流程或状态", enforcement: "guardrail" },
    { id: "inference_labeled", description: "推断结论标记为 inferred", enforcement: "completion_gate" },
    { id: "conflict_not_decided", description: "跨来源冲突保留双方证据并交给人工决策", enforcement: "completion_gate" },
    { id: "important_result_has_source", description: "重要结论关联可核对来源", enforcement: "completion_gate" },
    { id: "source_priority_explicit_only", description: "仅使用有明确证据的来源优先级规则", enforcement: "completion_gate" },
    { id: "baseline_read_only", description: "上一份需求基线只读，不能被本次分析覆盖", enforcement: "permission" },
  ],
  output_schema: {
    name: "RequirementAnalysis",
    version: "1.0.0",
  },
  completion_criteria: [
    { id: "schema_valid", description: "固定十字段 RequirementAnalysis 结构合法", evidence_required: false },
    { id: "references_valid", description: "所有 source_refs 均属于当前任务来源", evidence_required: true },
    { id: "source_locations_valid", description: "来源定位与文件能力一致", evidence_required: true },
    { id: "issues_valid", description: "缺失、歧义、冲突分类及证据数量合法", evidence_required: true },
    { id: "source_priority_valid", description: "来源优先级没有被擅自假设", evidence_required: true },
  ],
});
