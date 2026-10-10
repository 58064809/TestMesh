import { createHash, randomUUID } from "node:crypto";
import { OpenAIEmbeddings } from "@langchain/openai";
import type { DocumentChunker } from "../document-parsing/docling.js";
import type { KnowledgeDocumentRecord, KnowledgePostgresStore } from "./postgres-store.js";
import { QdrantKnowledgeIndex, type KnowledgeSearchHit } from "./qdrant.js";

export const KNOWLEDGE_EMBEDDING_MODEL = "text-embedding-3-small";

export class KnowledgeService {
  constructor(
    private readonly store: KnowledgePostgresStore,
    private readonly chunker: DocumentChunker,
    private readonly index: QdrantKnowledgeIndex,
  ) {}

  list(): Promise<KnowledgeDocumentRecord[]> { return this.store.list(); }

  async remove(id: string): Promise<void> {
    await this.index.deleteDocument(id);
    await this.store.delete(id);
  }

  async ingest(input: { filename: string; mimeType: string; bytes: Buffer; apiKey: string }): Promise<{ record: KnowledgeDocumentRecord; reused: boolean }> {
    const sha256 = createHash("sha256").update(input.bytes).digest("hex");
    const existing = await this.store.findBySha256(sha256);
    if (existing?.status === "indexed") return { record: existing, reused: true };
    const record = existing ?? await this.store.create({ ...input, sha256, embeddingModel: KNOWLEDGE_EMBEDDING_MODEL });
    try {
      const chunks = await this.chunker.chunk(input);
      const embeddings = new OpenAIEmbeddings({ apiKey: input.apiKey, model: KNOWLEDGE_EMBEDDING_MODEL });
      const vectors = await embeddings.embedDocuments(chunks.map((chunk) => chunk.text));
      if (vectors.some((vector) => vector.length !== 1536)) throw new Error("Embedding 向量维度不是 text-embedding-3-small 的 1536");
      await this.index.replaceDocument(record.id, chunks.map((chunk, index) => ({
        id: randomUUID(), vector: vectors[index], payload: {
          document_id: record.id, filename: record.filename, sha256: record.sha256,
          chunk_id: `${record.id}:chunk:${chunk.index}`, chunk_index: chunk.index, text: chunk.text,
          raw_text: chunk.rawText, headings: chunk.headings, captions: chunk.captions,
          page_numbers: chunk.pageNumbers, doc_items: chunk.docItems, metadata: chunk.metadata,
        },
      })));
      return { record: await this.store.markIndexed(record.id, chunks.length), reused: false };
    } catch (error) {
      await this.store.markFailed(record.id, error instanceof Error ? error.message : "知识入库失败");
      throw error;
    }
  }

  async search(query: string, apiKey: string, limit = 6): Promise<KnowledgeSearchHit[]> {
    const indexed = (await this.store.list()).some((item) => item.status === "indexed");
    if (!indexed) return [];
    const embeddings = new OpenAIEmbeddings({ apiKey, model: KNOWLEDGE_EMBEDDING_MODEL });
    return this.index.search(await embeddings.embedQuery(query), limit);
  }
}
