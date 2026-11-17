import { MODEL } from "../requirement-analysis/config.js";
import path from "node:path";
import type { DocumentParser } from "../document-parsing/docling.js";
import type { RequirementAnalysisPostgresStore } from "../requirement-analysis/postgres-store.js";
import { resolvePhoenixTraceUrl } from "../observability/phoenix.js";
import { createOpenAITestDesignModel, runTestDesignAgent } from "./agent.js";
import type { TestDesignPostgresStore } from "./postgres-store.js";
import { BaselineSnapshotSchema } from "./schema.js";
import type { TestModelPostgresStore } from "./test-model-store.js";
import type { TestConditionPostgresStore } from "./test-condition-store.js";

export class TestDesignService {
  constructor(
    private readonly requirementStore: RequirementAnalysisPostgresStore,
    private readonly testDesignStore: TestDesignPostgresStore,
    private readonly documentParser: DocumentParser,
    private readonly testModelStore: TestModelPostgresStore,
    private readonly testConditionStore: TestConditionPostgresStore,
  ) {}

  async generate(input: { baselineId: string; approvedTestModelVersionId: string; approvedTestConditionVersionId: string; apiKey: string; requestedBy?: string; regenerate?: boolean }) {
    const existing = await this.testDesignStore.findByBaseline(input.baselineId);
    if (existing && !input.regenerate) return { record: existing, reused: true };
    const { record: baselineRecord, snapshot, file } = await this.requirementStore.getBaseline(input.baselineId);
    const baseline = BaselineSnapshotSchema.parse(snapshot);
    const approvedModel = await this.testModelStore.getApprovedVersion(input.approvedTestModelVersionId);
    if (approvedModel.record.baselineId !== input.baselineId) throw new Error("Approved Test Model 与所选需求基线不一致");
    const approvedConditions = await this.testConditionStore.getApprovedVersion(input.approvedTestConditionVersionId);
    if (approvedConditions.record.baselineId !== input.baselineId || approvedConditions.record.approvedTestModelVersionId !== input.approvedTestModelVersionId) {
      throw new Error("Approved TestCondition 与所选需求基线或测试模型不一致");
    }
    const parsedPrd = await this.documentParser.parse({
      filename: baselineRecord.prdFilename,
      mimeType: mimeTypeFor(baselineRecord.prdFilename),
      bytes: file,
    });
    if (!parsedPrd.markdown.trim()) throw new Error("Docling 未返回获批 PRD 正文，测试设计已停止");
    const candidate = await runTestDesignAgent({
      baselineId: input.baselineId,
      baseline,
      prdMarkdown: parsedPrd.markdown,
      model: createOpenAITestDesignModel(input.apiKey),
      approvedModel: approvedModel.snapshot,
      requestedBy: input.requestedBy,
    });
    const approvedConditionIds = new Set(approvedConditions.snapshot.conditions.map((item) => item.id));
    const generatedConditionIds = new Set(candidate.result.test_conditions?.map((item) => item.id) ?? []);
    if (approvedConditionIds.size !== generatedConditionIds.size || [...approvedConditionIds].some((id) => !generatedConditionIds.has(id))) {
      throw new Error("生成的 TestCase 未严格使用已批准 TestCondition，已拒绝保存");
    }
    const record = existing?.status === "draft"
      ? await this.testDesignStore.replaceDraft(existing.id, {
        approvedTestModelVersionId: input.approvedTestModelVersionId,
        approvedTestConditionVersionId: input.approvedTestConditionVersionId,
        model: MODEL,
        document: candidate.result,
        trace: candidate.observability,
      })
      : await this.testDesignStore.createDesign({
        baselineId: input.baselineId,
        approvedTestModelVersionId: input.approvedTestModelVersionId,
        approvedTestConditionVersionId: input.approvedTestConditionVersionId,
        model: MODEL,
        document: candidate.result,
        trace: candidate.observability,
      });
    return {
      record,
      reused: false,
      regenerated: existing?.status === "draft",
      createdNewVersion: existing?.status === "approved",
      usage: candidate.usage,
      skillActivations: candidate.skillActivations,
      traceUrl: candidate.observability ? await resolvePhoenixTraceUrl(candidate.observability) : "",
    };
  }
}

function mimeTypeFor(filename: string): string {
  switch (path.extname(filename).toLowerCase()) {
    case ".pdf": return "application/pdf";
    case ".docx": return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    case ".doc": return "application/msword";
    case ".rtf": return "application/rtf";
    case ".odt": return "application/vnd.oasis.opendocument.text";
    case ".md": return "text/markdown";
    case ".txt": return "text/plain";
    case ".html": case ".htm": return "text/html";
    default: return "application/octet-stream";
  }
}
