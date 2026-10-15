import { randomUUID } from "node:crypto";
import type { DomainStore } from "../store.js";
import type { TestDesignPostgresStore } from "../test-design/postgres-store.js";
import { MODEL } from "../requirement-analysis/config.js";
import { resolvePhoenixTraceUrl } from "../observability/phoenix.js";
import { createOpenAIFailureTriageModel, runFailureTriageAgent } from "./agent.js";
import { buildFailureEvidence, resolveFailureContext } from "./evidence.js";
import type { FailureTriagePostgresStore } from "./postgres-store.js";
import type { FailureDiagnosisRequest, FailureEvidence } from "./schema.js";

export class FailureTriageService {
  constructor(
    private readonly runStore: DomainStore,
    private readonly triageStore: FailureTriagePostgresStore,
    private readonly testDesignStore: TestDesignPostgresStore,
  ) {}

  async analyze(input: { request: FailureDiagnosisRequest; apiKey: string; requestedBy?: string }) {
    const taskId = randomUUID();
    const context = resolveFailureContext(this.runStore, input.request);
    const evidence = buildFailureEvidence(this.runStore, context);
    await this.appendApprovedTestCases(context.approvedVersionId, context.approvedTestCaseIds, evidence);
    const candidate = await runFailureTriageAgent({
      taskId,
      context,
      evidence,
      model: createOpenAIFailureTriageModel(input.apiKey),
      requestedBy: input.requestedBy,
    });
    const record = await this.triageStore.create({
      taskId,
      context,
      evidence,
      result: candidate.result,
      model: MODEL,
      trace: candidate.observability,
    });
    return {
      record,
      usage: candidate.usage,
      traceUrl: candidate.observability ? await resolvePhoenixTraceUrl(candidate.observability) : "",
    };
  }

  private async appendApprovedTestCases(versionId: string, ids: string[], evidence: FailureEvidence[]): Promise<void> {
    if (!versionId || ids.length === 0) return;
    const approved = await this.testDesignStore.getApprovedVersionById(versionId);
    const wanted = new Set(ids);
    const testCases = approved.snapshot.test_cases.filter((item) => wanted.has(item.id));
    if (testCases.length === 0) throw new Error("失败 TestRun 关联的 Approved TestCase 在冻结版本中不存在");
    evidence.unshift({
      id: "EVD-APPROVED-TESTCASES",
      category: "test_case",
      title: `Approved TestCase v${approved.record.version}`,
      locator: `approved-test-case-version:${approved.record.id}`,
      direct: true,
      content: JSON.stringify(testCases.map((item) => ({
        id: item.id, title: item.title, objective: item.objective, preconditions: item.preconditions,
        test_data: item.test_data, steps: item.steps, gherkin: item.gherkin, trace_refs: item.trace_refs,
      })), null, 2),
    });
  }
}
