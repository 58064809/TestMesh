import { extensionOf, type SourceFile } from "./sources.js";

export interface SkillActivationDecision {
  skill_id: string;
  applicable: boolean;
  reason: string;
}

const ALWAYS_SKILLS = [
  "requirement-extraction",
  "business-rule-analysis",
  "ambiguity-detection",
  "source-conflict-analysis",
] as const;

export function selectRequirementAnalysisSkills(
  sources: SourceFile[],
): SkillActivationDecision[] {
  const inspectableText = sources
    .filter((source) => [".txt", ".md", ".json", ".html", ".xml"].includes(extensionOf(source.name)))
    .map((source) => source.buffer.toString("utf8"))
    .join("\n");
  const hasMultimodalOrOpaqueSource = sources.some(
    (source) => ![".txt", ".md", ".json", ".html", ".xml"].includes(extensionOf(source.name)),
  );
  const hasFlowSignal = /流程|步骤|分支|路径|flow|process|下一步|然后/i.test(inspectableText);
  const hasStateSignal = /状态|迁移|生命周期|流转|state|transition|status/i.test(inspectableText);

  return [
    ...ALWAYS_SKILLS.map((skillId) => ({
      skill_id: skillId,
      applicable: true,
      reason: "需求分析固定基础能力",
    })),
    {
      skill_id: "flow-analysis",
      applicable: hasFlowSignal || hasMultimodalOrOpaqueSource,
      reason: hasFlowSignal
        ? "文本出现流程信号"
        : hasMultimodalOrOpaqueSource
          ? "图片、PDF 或 Office 文件可能包含流程信息"
          : "当前可读文本没有流程信号",
    },
    {
      skill_id: "state-analysis",
      applicable: hasStateSignal || hasMultimodalOrOpaqueSource,
      reason: hasStateSignal
        ? "文本出现状态信号"
        : hasMultimodalOrOpaqueSource
          ? "图片、PDF 或 Office 文件可能包含状态信息"
          : "当前可读文本没有状态信号",
    },
  ];
}
