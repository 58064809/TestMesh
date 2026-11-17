import path from "node:path";
import type { DocumentParser } from "../document-parsing/docling.js";
import type { RequirementAnalysisPostgresStore } from "../requirement-analysis/postgres-store.js";
import { MODEL } from "../requirement-analysis/config.js";
import type { KnowledgeService } from "../knowledge/service.js";
import { resolvePhoenixTraceUrl } from "../observability/phoenix.js";
import { createOpenAITestDesignModel } from "./agent.js";
import { BaselineSnapshotSchema } from "./schema.js";
import { runTestModelAgent } from "./test-model-agent.js";
import type { TestModelPostgresStore } from "./test-model-store.js";
import { buildSmartShoppingSimulationReference, inspectSmartShoppingSimulationReference } from "./simulation-reference.js";

export class TestModelService {
  constructor(
    private readonly requirementStore: RequirementAnalysisPostgresStore,
    private readonly store: TestModelPostgresStore,
    private readonly documentParser: DocumentParser,
    private readonly knowledgeService: KnowledgeService,
  ) {}

  async generate(input: { baselineId: string; apiKey: string; requestedBy?: string }) {
    const { record: baselineRecord, snapshot, file } = await this.requirementStore.getBaseline(input.baselineId);
    const baseline = BaselineSnapshotSchema.parse(snapshot);
    const parsedPrd = await this.documentParser.parse({
      filename: baselineRecord.prdFilename,
      mimeType: mimeTypeFor(baselineRecord.prdFilename),
      bytes: file,
    });
    if (!parsedPrd.markdown.trim()) throw new Error("Docling 未返回获批 PRD 正文，测试建模已停止");
    const hasKnowledge = (await this.knowledgeService.list()).some((item) => item.status === "indexed");
    let candidate: Awaited<ReturnType<typeof runTestModelAgent>>;
    try {
      candidate = await runTestModelAgent({
        baselineId: input.baselineId,
        baseline,
        prdMarkdown: parsedPrd.markdown,
        model: createOpenAITestDesignModel(input.apiKey),
        requestedBy: input.requestedBy,
        knowledgeSearch: hasKnowledge ? (query) => this.knowledgeService.search(query, input.apiKey) : undefined,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "未知错误";
      if (/timed out|fetch failed/i.test(message)) {
        throw new Error("OpenAI 模型请求超时或当前网络无法访问模型服务；Test Model 候选未保存。请恢复模型网络连接后沿同一路径重试。", { cause: error });
      }
      throw error;
    }
    const record = await this.store.create({
      baselineId: input.baselineId,
      model: MODEL,
      document: candidate.result,
      trace: candidate.observability,
    });
    return {
      record,
      usage: candidate.usage,
      skillActivations: candidate.skillActivations,
      traceUrl: candidate.observability ? await resolvePhoenixTraceUrl(candidate.observability) : "",
    };
  }

  async createSimulationReference(input: { baselineId: string; requestedBy?: string }) {
    const { record: baselineRecord, snapshot } = await this.requirementStore.getBaseline(input.baselineId);
    if (baselineRecord.prdFilename !== "approved-prd-smart-shopping-v1.0.md") {
      throw new Error("模拟参考模型只适用于版本化智能导购演练基线");
    }
    const baseline = BaselineSnapshotSchema.parse(snapshot);
    const document = buildSmartShoppingSimulationReference(input.baselineId, baseline);
    const record = await this.store.create({
      baselineId: input.baselineId,
      model: "simulation-reference/v1",
      document,
    });
    return {
      record,
      simulated: true,
      generatedBy: "versioned-reference-asset",
      requestedBy: input.requestedBy?.trim() || "local-user",
    };
  }

  async inspectSimulationReference(baselineId: string) {
    const { record, snapshot } = await this.requirementStore.getBaseline(baselineId);
    if (record.prdFilename !== "approved-prd-smart-shopping-v1.0.md") {
      return { ready: false, blockers: ["该入口仅适用于受控智能导购模拟基线"] };
    }
    return inspectSmartShoppingSimulationReference(BaselineSnapshotSchema.parse(snapshot));
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
