import type { RequirementAnalysis } from "../requirement-analysis/schema.js";
import type { AnalysisReviewRecord } from "../requirement-analysis/postgres-store.js";

export type AiQualityProfileStatus = "pending" | "approved" | "retired";

export interface AiQualityCriteria {
  minimumOpenQuestions: number;
  requiredIssueTypes: Array<"missing" | "ambiguity" | "conflict">;
  requiredTopicGroups: string[][];
  maximumAgentLatencyMs: number;
  maximumTotalTokens: number;
}

export interface PhoenixEvidence {
  endpoint: string;
  projectName: string;
  datasetId: string;
  experimentId: string;
  traceId: string;
}

export interface AiQualityProfile {
  id: string;
  name: string;
  version: string;
  status: AiQualityProfileStatus;
  targetName: string;
  targetVersion: string;
  environment: string;
  sourceAnalysisId: string;
  sourceFilename: string;
  sourceSha256: string;
  criteria: AiQualityCriteria;
  phoenix: PhoenixEvidence;
  approvedBy: string;
  approvalNote: string;
  approvedAt: string | null;
  createdAt: string;
}

export interface ProfileReadiness {
  ready: boolean;
  totalOpenQuestions: number;
  reviewedOpenQuestions: number;
  blockers: string[];
}

export type QualityMetricStatus = "passed" | "warning" | "unknown";

export interface QualityMetric {
  id: string;
  name: string;
  status: QualityMetricStatus;
  value: string;
  target: string;
  explanation: string;
}

export interface QualityAssessment {
  verdict: "insufficient-evidence" | "candidate";
  headline: string;
  confidence: "low" | "medium";
  metrics: QualityMetric[];
  known: string[];
  unknown: string[];
  nextActions: string[];
}

export function assessProfileReadiness(
  document: RequirementAnalysis,
  reviews: AnalysisReviewRecord[],
): ProfileReadiness {
  const openQuestions = document.open_questions;
  const latestByItem = new Map(reviews.map((review) => [review.itemId, review]));
  const unfinished = openQuestions.filter((item) => {
    const review = latestByItem.get(item.id);
    return !review || review.status === "clarify";
  });
  const reviewedOpenQuestions = openQuestions.length - unfinished.length;
  const blockers = unfinished.length
    ? [`仍有 ${unfinished.length} 条待确认问题未完成评审：${unfinished.map((item) => item.id).join("、")}`]
    : [];
  return {
    ready: blockers.length === 0,
    totalOpenQuestions: openQuestions.length,
    reviewedOpenQuestions,
    blockers,
  };
}

/**
 * Builds an evidence profile for the current requirement-analysis benchmark.
 * It intentionally leaves recall, robustness and generalisation unknown until
 * Phoenix contains labelled missed issues and repeated/mutated examples.
 */
export function assessQuality(
  document: RequirementAnalysis,
  reviews: AnalysisReviewRecord[],
): QualityAssessment {
  const latestByItem = new Map(reviews.map((review) => [review.itemId, review]));
  const decided = document.open_questions
    .map((item) => latestByItem.get(item.id))
    .filter((review): review is AnalysisReviewRecord => Boolean(review) && review!.status !== "clarify");
  const accepted = decided.filter((review) => review.status === "accepted").length;
  const merged = decided.filter((review) => review.status === "merged").length;
  const rejected = decided.filter((review) => review.status === "rejected").length;
  const confirmedRate = decided.length ? (accepted + merged) / decided.length : null;
  const duplicateRate = decided.length ? merged / decided.length : null;

  const citationEligible = document.open_questions.filter((item) => item.issue_type !== "missing");
  const citationComplete = citationEligible.filter((item) => (
    item.source_refs.length >= (item.issue_type === "conflict" ? 2 : 1)
  )).length;
  const citationRate = citationEligible.length ? citationComplete / citationEligible.length : 1;

  const percent = (value: number) => `${(value * 100).toFixed(1)}%`;
  const fullyReviewed = decided.length === document.open_questions.length;
  const qualityEvidenceReady = fullyReviewed && decided.length > 0;

  return {
    verdict: qualityEvidenceReady ? "candidate" : "insufficient-evidence",
    headline: qualityEvidenceReady
      ? "当前样本可用于候选基线，但不足以证明真实业务泛化质量"
      : "当前只能证明链路可运行，尚不能判断业务识别质量",
    confidence: qualityEvidenceReady ? "medium" : "low",
    metrics: [
      {
        id: "human-confirmed-rate",
        name: "人工确认率（精确率代理）",
        status: confirmedRate === null ? "unknown" : confirmedRate >= 0.85 ? "passed" : "warning",
        value: confirmedRate === null ? "待评审" : `${percent(confirmedRate)}（${accepted + merged}/${decided.length}）`,
        target: "候选门槛 ≥ 85%",
        explanation: `接受 ${accepted}、合并 ${merged}、驳回 ${rejected}；合并表示问题成立但存在重复。该指标不能替代召回率。`,
      },
      {
        id: "duplicate-rate",
        name: "重复问题率",
        status: duplicateRate === null ? "unknown" : duplicateRate <= 0.10 ? "passed" : "warning",
        value: duplicateRate === null ? "待评审" : `${percent(duplicateRate)}（${merged}/${decided.length}）`,
        target: "候选门槛 ≤ 10%",
        explanation: "衡量多个 AI 问题是否实际指向同一缺口；越低越好。",
      },
      {
        id: "citation-completeness",
        name: "可核验引用完整率",
        status: citationRate === 1 ? "passed" : "warning",
        value: `${percent(citationRate)}（${citationComplete}/${citationEligible.length}）`,
        target: "必须 100%",
        explanation: "歧义至少需要 1 条原文引用，冲突至少需要 2 条相互矛盾的引用；缺失类不强制伪造引用。",
      },
      {
        id: "defect-recall",
        name: "已知问题召回率",
        status: "unknown",
        value: "未知",
        target: "候选门槛 ≥ 90%",
        explanation: "当前只评审 AI 找到的问题，没有登记人工发现但 AI 漏掉的问题，因此不能计算召回率。",
      },
      {
        id: "robustness",
        name: "扰动鲁棒性 / 缺陷检出率",
        status: "unknown",
        value: "未知",
        target: "每类变异检出率 ≥ 90%",
        explanation: "尚未对主体删除、数值边界、规则冲突、状态缺口等已知变异运行基准实验。",
      },
      {
        id: "sample-coverage",
        name: "样本覆盖度",
        status: "unknown",
        value: "1 份中文售后 PRD",
        target: "起步 ≥ 20 个高质量样本，并覆盖主要文档类型与风险分层",
        explanation: "单一样本能验证集成链路，不能证明跨业务、跨格式和跨版本的稳定性。",
      },
    ],
    known: [
      "真实中文 PRD 已完成 Docling 解析、Agent 执行、结构化输出和原文证据回链。",
      "Phoenix 已保存 Dataset、Experiment、Trace 和代码评测证据，可复跑并比较版本。",
      "人工评审结果可计算确认率、驳回率和重复率，不再只看 AI 生成了多少条。",
    ],
    unknown: [
      "AI 漏掉了多少真实问题（召回率）。",
      "换业务、换文档格式或改写表达后是否仍然稳定（泛化与鲁棒性）。",
      "新版本相对旧版本是否退化（缺少同一评估集上的重复实验）。",
      "生成的测试用例能否持续发现真实缺陷（尚无真实项目故障或缺陷回流）。",
    ],
    nextActions: [
      "把当前人工评审结果固化为 Phoenix Dataset 的第一个人工标注样本。",
      "从现有 PRD 制作可追溯的缺陷变异集：缺主体、边界值变化、规则冲突、状态转移遗漏和不可验证表述。",
      "同一 Agent 版本至少重复运行 3 次，记录召回率、确认率、重复率、引用完整率、Token 和时延分布。",
      "以后获得真实需求、线上失败或人工补充问题时，优先回流为评估样本，不把演示数据冒充生产结论。",
    ],
  };
}
