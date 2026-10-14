import type { RequirementAnalysis } from "../requirement-analysis/schema.js";
import type { AnalysisReviewRecord } from "../requirement-analysis/postgres-store.js";

export type AiQualityProfileStatus = "pending" | "approved" | "retired";

export interface AiQualityCriteria {
  minimumOpenQuestions: number;
  requiredIssueTypes: Array<"missing" | "ambiguity" | "conflict">;
  requiredTopicGroups: string[][];
  maximumAgentLatencyMs: number;
  maximumTotalTokens: number;
  minimumControlledRecall?: number;
  minimumControlledRunSuccess?: number;
  maximumOverreportingReviewRate?: number;
}

export interface ControlledBenchmarkEvidence {
  datasetId: string;
  datasetVersionId: string;
  experimentId: string;
  benchmarkVersion: string;
  dataClass: "controlled-synthetic";
  totalRuns: number;
  successfulRuns: number;
  detectedRuns: number;
  overreportingReviewRuns: number;
  averageOpenQuestions: number;
  latencyP50Ms: number;
  latencyP95Ms: number;
  totalTokens: number;
}

export interface PhoenixEvidence {
  endpoint: string;
  projectName: string;
  datasetId: string;
  experimentId: string;
  traceId: string;
  controlledBenchmark?: ControlledBenchmarkEvidence;
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

export function assessControlledBenchmarkReadiness(
  criteria: AiQualityCriteria,
  controlled?: ControlledBenchmarkEvidence,
): string[] {
  const requiresControlledEvidence = criteria.minimumControlledRecall !== undefined
    || criteria.minimumControlledRunSuccess !== undefined
    || criteria.maximumOverreportingReviewRate !== undefined;
  if (!requiresControlledEvidence) return [];
  if (!controlled) return ["当前配置要求受控基准，但尚未关联 Phoenix 实验证据"];

  const blockers: string[] = [];
  const recall = controlled.detectedRuns / controlled.totalRuns;
  const runSuccess = controlled.successfulRuns / controlled.totalRuns;
  const overreporting = controlled.overreportingReviewRuns / controlled.totalRuns;
  if (criteria.minimumControlledRecall !== undefined && recall < criteria.minimumControlledRecall) {
    blockers.push(`受控缺陷检出率 ${(recall * 100).toFixed(1)}% 低于门槛 ${(criteria.minimumControlledRecall * 100).toFixed(1)}%`);
  }
  if (criteria.minimumControlledRunSuccess !== undefined && runSuccess < criteria.minimumControlledRunSuccess) {
    blockers.push(`受控实验运行成功率 ${(runSuccess * 100).toFixed(1)}% 低于门槛 ${(criteria.minimumControlledRunSuccess * 100).toFixed(1)}%`);
  }
  if (criteria.maximumOverreportingReviewRate !== undefined && overreporting > criteria.maximumOverreportingReviewRate) {
    blockers.push(`过度报告复核率 ${(overreporting * 100).toFixed(1)}% 高于门槛 ${(criteria.maximumOverreportingReviewRate * 100).toFixed(1)}%`);
  }
  return blockers;
}

/**
 * Builds an evidence profile for the current requirement-analysis benchmark.
 * It intentionally leaves recall, robustness and generalisation unknown until
 * Phoenix contains labelled missed issues and repeated/mutated examples.
 */
export function assessQuality(
  document: RequirementAnalysis,
  reviews: AnalysisReviewRecord[],
  controlled?: ControlledBenchmarkEvidence,
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
  const controlledRecall = controlled ? controlled.detectedRuns / controlled.totalRuns : null;
  const controlledRunSuccess = controlled ? controlled.successfulRuns / controlled.totalRuns : null;
  const overreportingReviewRate = controlled ? controlled.overreportingReviewRuns / controlled.totalRuns : null;

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
        status: controlledRecall === null ? "unknown" : controlledRecall >= 0.9 ? "passed" : "warning",
        value: controlledRecall === null ? "未知" : `${percent(controlledRecall)}（${controlled!.detectedRuns}/${controlled!.totalRuns}）`,
        target: "候选门槛 ≥ 90%",
        explanation: controlled
          ? `基于 ${controlled.benchmarkVersion} 的受控单缺陷样本；这是合成基准召回率，不等于真实业务召回率。`
          : "当前只评审 AI 找到的问题，没有登记人工发现但 AI 漏掉的问题，因此不能计算召回率。",
      },
      {
        id: "controlled-run-success",
        name: "受控实验运行成功率",
        status: controlledRunSuccess === null ? "unknown" : controlledRunSuccess === 1 ? "passed" : "warning",
        value: controlledRunSuccess === null ? "未知" : `${percent(controlledRunSuccess)} 运行成功（${controlled!.successfulRuns}/${controlled!.totalRuns}）`,
        target: "必须 100%",
        explanation: controlled
          ? `已覆盖 ${controlled.totalRuns} 种受控缺陷；其中 1 次被生产证据门禁拒绝，失败没有被降级为通过。`
          : "尚未运行主体删除、数值边界、规则冲突、状态缺口等受控基准实验。",
      },
      {
        id: "overreporting-review-rate",
        name: "过度报告复核率",
        status: overreportingReviewRate === null ? "unknown" : overreportingReviewRate <= 0.5 ? "passed" : "warning",
        value: overreportingReviewRate === null ? "未知" : `${percent(overreportingReviewRate)}（${controlled!.overreportingReviewRuns}/${controlled!.totalRuns}）`,
        target: "候选门槛 ≤ 50%",
        explanation: controlled
          ? `单缺陷样本平均报告 ${controlled.averageOpenQuestions.toFixed(2)} 个问题；超过 3 个即进入人工复核，不直接判定为误报。`
          : "尚未在单缺陷样本上统计额外问题数量。",
      },
      {
        id: "sample-coverage",
        name: "样本覆盖度",
        status: "unknown",
        value: controlled ? `1 份真实 PRD + ${controlled.totalRuns} 条受控样本` : "1 份中文售后 PRD",
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
      controlled ? "受控样本召回率已知，但 AI 漏掉多少真实业务问题仍然未知。" : "AI 漏掉了多少真实问题（召回率）。",
      "换业务、换文档格式或改写表达后是否仍然稳定（泛化与鲁棒性）。",
      "新版本相对旧版本是否退化（缺少同一评估集上的重复实验）。",
      "生成的测试用例能否持续发现真实缺陷（尚无真实项目故障或缺陷回流）。",
    ],
    nextActions: [
      "把当前人工评审结果固化为 Phoenix Dataset 的第一个人工标注样本。",
      controlled
        ? "人工复核受控样本中额外报告的问题，区分有效补充和真实误报，校准精确率门槛。"
        : "从现有 PRD 制作可追溯的缺陷变异集：缺主体、边界值变化、规则冲突、状态转移遗漏和不可验证表述。",
      controlled
        ? "修复 AMBIGUITY-NORMAL-004 暴露的无来源条目问题后重跑同一 Dataset，不删除失败实验。"
        : "同一 Agent 版本至少重复运行 3 次，记录召回率、确认率、重复率、引用完整率、Token 和时延分布。",
      "以后获得真实需求、线上失败或人工补充问题时，优先回流为评估样本，不把演示数据冒充生产结论。",
    ],
  };
}
