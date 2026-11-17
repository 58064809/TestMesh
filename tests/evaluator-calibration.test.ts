import { describe, expect, it } from "vitest";
import { EvaluatorCalibrationInputSchema, assessEvaluatorCalibration } from "../server/ai-quality/evaluator-calibration.js";

function calibrationRows(overrides?: { unstable?: boolean; wrongSlice?: boolean }) {
  return Array.from({ length: 20 }, (_, index) => {
    const gold = index % 2 === 0 ? "pass" : "fail";
    const slice = index < 10 ? "paraphrase" : "tool_failure";
    const predicted = overrides?.wrongSlice && slice === "tool_failure" ? (gold === "pass" ? "fail" : "pass") : gold;
    return {
      sampleId: `gold-${String(index + 1).padStart(3, "0")}`,
      slice,
      humanLabels: index < 4 ? [gold, gold] : [gold],
      adjudicatedLabel: gold,
      adjudicationNote: "",
      evaluatorLabels: overrides?.unstable && index === 0 ? [predicted, gold === "pass" ? "fail" : "pass", predicted] : [predicted, predicted, predicted],
    };
  });
}

function input(rows = calibrationRows()) {
  return EvaluatorCalibrationInputSchema.parse({
    evaluatorName: "intent_correctness",
    evaluatorVersion: "1.0.0",
    evaluatorKind: "llm_judge",
    targetDimensions: ["intent_recognition", "robustness_consistency"],
    evaluationSubjects: ["target_application"],
    evaluationLayers: ["agent_decision", "final_response"],
    phoenixDatasetId: "dataset-gold",
    phoenixDatasetVersionId: "dataset-gold-v1",
    phoenixExperimentId: "experiment-calibration-v1",
    calibratedBy: "路昭凡",
    rows,
  });
}

describe("Evaluator calibration gate", () => {
  it("passes only with representative gold labels, repeated agreement and slice evidence", () => {
    const result = assessEvaluatorCalibration(input());
    expect(result.passed).toBe(true);
    expect(result.accuracyPct).toBe(100);
    expect(result.macroF1Pct).toBe(100);
    expect(result.repeatAgreementPct).toBe(100);
    expect(result.doubleAnnotatedPct).toBe(20);
    expect(result.slices).toEqual(["paraphrase", "tool_failure"]);
  });

  it("blocks a judge that fails an entire robustness slice", () => {
    const result = assessEvaluatorCalibration(input(calibrationRows({ wrongSlice: true })));
    expect(result.passed).toBe(false);
    expect(result.worstSliceAccuracyPct).toBe(0);
    expect(result.blockers.join(" ")).toContain("最差切片准确率");
  });

  it("requires three evaluator repetitions per gold sample", () => {
    const rows = calibrationRows();
    rows[0].evaluatorLabels = ["pass", "pass"];
    expect(EvaluatorCalibrationInputSchema.safeParse({
      evaluatorName: "intent_correctness", evaluatorVersion: "1.0.0", evaluatorKind: "llm_judge",
      targetDimensions: ["intent_recognition"], phoenixDatasetId: "d", phoenixDatasetVersionId: "v",
      evaluationSubjects: ["target_application"], evaluationLayers: ["final_response"],
      phoenixExperimentId: "e", calibratedBy: "reviewer", rows,
    }).success).toBe(false);
  });
});
