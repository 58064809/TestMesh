import { MODEL } from "../requirement-analysis/config.js";
import path from "node:path";
import type { DocumentParser } from "../document-parsing/docling.js";
import type { RequirementAnalysisPostgresStore } from "../requirement-analysis/postgres-store.js";
import { resolvePhoenixTraceUrl } from "../observability/phoenix.js";
import { createOpenAITestDesignModel, runTestDesignAgent } from "./agent.js";
import type { TestDesignPostgresStore } from "./postgres-store.js";
import { BaselineSnapshotSchema } from "./schema.js";
import type { KnowledgeService } from "../knowledge/service.js";

export class TestDesignService {
  constructor(
    private readonly requirementStore: RequirementAnalysisPostgresStore,
    private readonly testDesignStore: TestDesignPostgresStore,
    private readonly documentParser: DocumentParser,
    private readonly knowledgeService: KnowledgeService,
  ) {}

  async generate(input: { baselineId: string; apiKey: string; requestedBy?: string; regenerate?: boolean }) {
    const existing = await this.testDesignStore.findByBaseline(input.baselineId);
    if (existing && !input.regenerate) return { record: existing, reused: true };
    if (existing?.status === "approved") throw new Error("已批准的 TestCase 版本不可重新生成");
    const { record: baselineRecord, snapshot, file } = await this.requirementStore.getBaseline(input.baselineId);
    const baseline = BaselineSnapshotSchema.parse(snapshot);
    const parsedPrd = await this.documentParser.parse({
      filename: baselineRecord.prdFilename,
      mimeType: mimeTypeFor(baselineRecord.prdFilename),
      bytes: file,
    });
    if (!parsedPrd.markdown.trim()) throw new Error("Docling 未返回获批 PRD 正文，测试设计已停止");
    const hasKnowledge = (await this.knowledgeService.list()).some((item) => item.status === "indexed");
    const candidate = await runTestDesignAgent({
      baselineId: input.baselineId,
      baseline,
      prdMarkdown: parsedPrd.markdown,
      model: createOpenAITestDesignModel(input.apiKey),
      requestedBy: input.requestedBy,
      knowledgeSearch: hasKnowledge ? (query) => this.knowledgeService.search(query, input.apiKey) : undefined,
    });
    const record = existing
      ? await this.testDesignStore.replaceDraft(existing.id, {
        model: MODEL,
        document: candidate.result,
        trace: candidate.observability,
      })
      : await this.testDesignStore.createDesign({
        baselineId: input.baselineId,
        model: MODEL,
        document: candidate.result,
        trace: candidate.observability,
      });
    return {
      record,
      reused: false,
      regenerated: Boolean(existing),
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
