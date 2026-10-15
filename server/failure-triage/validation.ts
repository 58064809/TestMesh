import type { FailureEvidence, FailureTriage } from "./schema.js";

export class FailureTriageValidationError extends Error {}

export function validateFailureTriage(result: FailureTriage, evidence: FailureEvidence[]): void {
  const byId = new Map(evidence.map((item) => [item.id, item]));
  const ensureRefs = (refs: string[], label: string) => {
    for (const ref of refs) {
      if (!byId.has(ref)) throw new FailureTriageValidationError(`${label} 引用了不存在的证据 ${ref}`);
    }
  };

  for (const fact of result.facts) ensureRefs(fact.evidence_refs, "事实");
  for (const hypothesis of result.hypotheses) {
    ensureRefs(hypothesis.supporting_evidence_refs, "候选原因");
    ensureRefs(hypothesis.contradicting_evidence_refs, "候选原因反证");
  }
  for (const location of result.source_locations) {
    ensureRefs(location.evidence_refs, "源码位置");
    if (!location.evidence_refs.some((ref) => byId.get(ref)?.category === "source_code")) {
      throw new FailureTriageValidationError(`源码位置 ${location.file} 没有真实源码证据`);
    }
  }
  for (const finding of result.database_findings) {
    ensureRefs(finding.evidence_refs, "数据库结论");
    if (!finding.evidence_refs.some((ref) => byId.get(ref)?.category === "database")) {
      throw new FailureTriageValidationError("数据库结论没有真实数据库查询证据");
    }
  }
  ensureRefs(result.submission_draft.attachment_evidence_refs, "缺陷附件");

  if (result.status === "located") {
    const referenced = new Set(result.facts.flatMap((fact) => fact.evidence_refs));
    const referencedEvidence = [...referenced].map((ref) => byId.get(ref)!);
    const diagnosticCategories = new Set(["telemetry", "database", "middleware", "source_code"]);
    const hasDiagnosticEvidence = referencedEvidence.some((item) => diagnosticCategories.has(item.category));
    const hasScriptEvidence = result.failure_layer === "test_script"
      && referencedEvidence.some((item) => item.category === "source_code")
      && referencedEvidence.some((item) => item.category === "runner" || item.category === "artifact");
    if (!hasDiagnosticEvidence && !hasScriptEvidence) {
      throw new FailureTriageValidationError("located 必须引用调用链/日志、数据库、中间件或源码定位证据；仅有失败断言不能确认根因");
    }
  }

  if (result.status === "insufficient_evidence" && result.missing_evidence.length === 0) {
    throw new FailureTriageValidationError("证据不足时必须说明仍缺少什么证据");
  }
}
