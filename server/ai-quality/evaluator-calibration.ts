import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { AiQualityPostgresStore, EvaluatorCalibrationRecord } from "./postgres-store.js";

const CalibrationRowSchema = z.object({
  sampleId: z.string().trim().min(1),
  slice: z.string().trim().min(1),
  humanLabels: z.array(z.string().trim().min(1)).min(1),
  adjudicatedLabel: z.string().trim().min(1),
  adjudicationNote: z.string().trim().default(""),
  evaluatorLabels: z.array(z.string().trim().min(1)).min(3, "每个金标准样本至少重复执行 Evaluator 3 次"),
}).strict().superRefine((value, context) => {
  const labels = new Set(value.humanLabels);
  if (labels.size > 1 && !value.adjudicationNote) {
    context.addIssue({ code: "custom", path: ["adjudicationNote"], message: "人工标注不一致时必须填写仲裁说明" });
  }
  if (!value.humanLabels.includes(value.adjudicatedLabel) && !value.adjudicationNote) {
    context.addIssue({ code: "custom", path: ["adjudicatedLabel"], message: "仲裁标签不在原标注中时必须说明原因" });
  }
});

export const EvaluatorCalibrationInputSchema = z.object({
  evaluatorName: z.string().trim().regex(/^[a-z][a-z0-9_-]{2,79}$/),
  evaluatorVersion: z.string().trim().min(1).max(80),
  evaluatorKind: z.enum(["code", "llm_judge"]),
  targetDimensions: z.array(z.string().trim().min(1)).min(1),
  evaluationSubjects: z.array(z.enum(["testmesh", "target_application"])).min(1),
  evaluationLayers: z.array(z.enum(["agent_decision", "tool_execution", "business_outcome", "final_response"])).min(1),
  phoenixDatasetId: z.string().trim().min(1),
  phoenixDatasetVersionId: z.string().trim().min(1),
  phoenixExperimentId: z.string().trim().min(1),
  calibratedBy: z.string().trim().min(1).max(100),
  calibrationNote: z.string().trim().max(2_000).default(""),
  thresholds: z.object({
    minimumSamples: z.number().int().min(10).max(10_000).default(20),
    minimumAccuracyPct: z.number().min(0).max(100).default(85),
    minimumMacroF1Pct: z.number().min(0).max(100).default(80),
    minimumPerLabelRecallPct: z.number().min(0).max(100).default(75),
    minimumRepeatAgreementPct: z.number().min(0).max(100).default(90),
    minimumWorstSliceAccuracyPct: z.number().min(0).max(100).default(70),
    minimumDoubleAnnotatedPct: z.number().min(0).max(100).default(20),
  }).strict().default({
    minimumSamples: 20, minimumAccuracyPct: 85, minimumMacroF1Pct: 80,
    minimumPerLabelRecallPct: 75, minimumRepeatAgreementPct: 90,
    minimumWorstSliceAccuracyPct: 70, minimumDoubleAnnotatedPct: 20,
  }),
  rows: z.array(CalibrationRowSchema).min(1),
}).strict();

type CalibrationInput = z.infer<typeof EvaluatorCalibrationInputSchema>;

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function pct(numerator: number, denominator: number): number {
  return denominator ? round(numerator / denominator * 100) : 0;
}

function majority(labels: string[]): string {
  const counts = new Map<string, number>();
  for (const label of labels) counts.set(label, (counts.get(label) ?? 0) + 1);
  const sorted = [...counts.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
  return sorted.length > 1 && sorted[0][1] === sorted[1][1] ? "__tie__" : sorted[0][0];
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export interface EvaluatorCalibrationAssessment {
  sampleCount: number;
  labels: string[];
  slices: string[];
  accuracyPct: number;
  macroF1Pct: number;
  minimumPerLabelRecallPct: number;
  repeatAgreementPct: number;
  worstSliceAccuracyPct: number;
  doubleAnnotatedPct: number;
  humanAgreementPct: number;
  perLabel: Record<string, { precisionPct: number; recallPct: number; f1Pct: number; support: number }>;
  sliceAccuracy: Record<string, number>;
  blockers: string[];
  passed: boolean;
}

export function assessEvaluatorCalibration(input: CalibrationInput): EvaluatorCalibrationAssessment {
  const predictions = input.rows.map((row) => ({ ...row, predicted: majority(row.evaluatorLabels) }));
  const labels = [...new Set(input.rows.map((row) => row.adjudicatedLabel))].sort();
  const slices = [...new Set(input.rows.map((row) => row.slice))].sort();
  const correct = predictions.filter((row) => row.predicted === row.adjudicatedLabel).length;
  const perLabel = Object.fromEntries(labels.map((label) => {
    const truePositive = predictions.filter((row) => row.predicted === label && row.adjudicatedLabel === label).length;
    const falsePositive = predictions.filter((row) => row.predicted === label && row.adjudicatedLabel !== label).length;
    const falseNegative = predictions.filter((row) => row.predicted !== label && row.adjudicatedLabel === label).length;
    const precision = pct(truePositive, truePositive + falsePositive);
    const recall = pct(truePositive, truePositive + falseNegative);
    return [label, {
      precisionPct: precision, recallPct: recall,
      f1Pct: precision + recall ? round(2 * precision * recall / (precision + recall)) : 0,
      support: truePositive + falseNegative,
    }];
  }));
  const sliceAccuracy = Object.fromEntries(slices.map((slice) => {
    const rows = predictions.filter((row) => row.slice === slice);
    return [slice, pct(rows.filter((row) => row.predicted === row.adjudicatedLabel).length, rows.length)];
  }));
  const macroF1Pct = round(Object.values(perLabel).reduce((sum, item) => sum + item.f1Pct, 0) / Math.max(labels.length, 1));
  const minimumPerLabelRecallPct = Math.min(...Object.values(perLabel).map((item) => item.recallPct));
  const repeatAgreementPct = pct(input.rows.filter((row) => new Set(row.evaluatorLabels).size === 1).length, input.rows.length);
  const worstSliceAccuracyPct = Math.min(...Object.values(sliceAccuracy));
  const doubleAnnotatedPct = pct(input.rows.filter((row) => row.humanLabels.length >= 2).length, input.rows.length);
  const allHumanLabels = input.rows.flatMap((row) => row.humanLabels.map((label) => ({ label, gold: row.adjudicatedLabel })));
  const humanAgreementPct = pct(allHumanLabels.filter((item) => item.label === item.gold).length, allHumanLabels.length);
  const accuracyPct = pct(correct, input.rows.length);
  const blockers = [
    ...(input.rows.length < input.thresholds.minimumSamples ? [`金标准样本 ${input.rows.length} 少于门槛 ${input.thresholds.minimumSamples}`] : []),
    ...(labels.length < 2 ? ["金标准必须至少包含两个结果类别，不能只用全通过样本校准"] : []),
    ...(slices.length < 2 ? ["金标准必须至少覆盖两个业务或风险切片"] : []),
    ...(accuracyPct < input.thresholds.minimumAccuracyPct ? [`准确率 ${accuracyPct}% 低于 ${input.thresholds.minimumAccuracyPct}%`] : []),
    ...(macroF1Pct < input.thresholds.minimumMacroF1Pct ? [`Macro-F1 ${macroF1Pct}% 低于 ${input.thresholds.minimumMacroF1Pct}%`] : []),
    ...(minimumPerLabelRecallPct < input.thresholds.minimumPerLabelRecallPct ? [`最差类别召回率 ${minimumPerLabelRecallPct}% 低于 ${input.thresholds.minimumPerLabelRecallPct}%`] : []),
    ...(repeatAgreementPct < input.thresholds.minimumRepeatAgreementPct ? [`重复判定一致率 ${repeatAgreementPct}% 低于 ${input.thresholds.minimumRepeatAgreementPct}%`] : []),
    ...(worstSliceAccuracyPct < input.thresholds.minimumWorstSliceAccuracyPct ? [`最差切片准确率 ${worstSliceAccuracyPct}% 低于 ${input.thresholds.minimumWorstSliceAccuracyPct}%`] : []),
    ...(doubleAnnotatedPct < input.thresholds.minimumDoubleAnnotatedPct ? [`双人复核覆盖率 ${doubleAnnotatedPct}% 低于 ${input.thresholds.minimumDoubleAnnotatedPct}%`] : []),
  ];
  return {
    sampleCount: input.rows.length, labels, slices, accuracyPct, macroF1Pct,
    minimumPerLabelRecallPct, repeatAgreementPct, worstSliceAccuracyPct,
    doubleAnnotatedPct, humanAgreementPct, perLabel, sliceAccuracy,
    blockers, passed: blockers.length === 0,
  };
}

export class EvaluatorCalibrationService {
  constructor(private readonly store: AiQualityPostgresStore) {}

  list(): Promise<EvaluatorCalibrationRecord[]> {
    return this.store.listEvaluatorCalibrations();
  }

  async calibrate(input: CalibrationInput): Promise<EvaluatorCalibrationRecord> {
    const metrics = assessEvaluatorCalibration(input);
    const contentSha256 = createHash("sha256").update(canonical({
      evaluatorName: input.evaluatorName, evaluatorVersion: input.evaluatorVersion,
      evaluationSubjects: input.evaluationSubjects, evaluationLayers: input.evaluationLayers,
      datasetVersionId: input.phoenixDatasetVersionId, experimentId: input.phoenixExperimentId,
      thresholds: input.thresholds, rows: input.rows,
    })).digest("hex");
    return this.store.saveEvaluatorCalibration({
      id: randomUUID(), evaluatorName: input.evaluatorName, evaluatorVersion: input.evaluatorVersion,
      evaluatorKind: input.evaluatorKind, targetDimensions: input.targetDimensions,
      evaluationSubjects: input.evaluationSubjects, evaluationLayers: input.evaluationLayers,
      phoenixDatasetId: input.phoenixDatasetId, phoenixDatasetVersionId: input.phoenixDatasetVersionId,
      phoenixExperimentId: input.phoenixExperimentId, contentSha256, sampleCount: input.rows.length,
      metrics: metrics as unknown as Record<string, unknown>, thresholds: input.thresholds,
      passed: metrics.passed, calibratedBy: input.calibratedBy, calibrationNote: input.calibrationNote,
    });
  }
}
