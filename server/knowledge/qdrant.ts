import { QdrantClient } from "@qdrant/js-client-rest";

export const KNOWLEDGE_COLLECTION = "testmesh_knowledge";
export const KNOWLEDGE_VECTOR_SIZE = 1536;

export interface KnowledgeVectorChunk {
  id: string;
  vector: number[];
  payload: Record<string, unknown>;
}

export interface KnowledgeSearchHit {
  id: string;
  score: number;
  documentId: string;
  filename: string;
  chunkId: string;
  text: string;
  headings: string[];
  pageNumbers: number[];
  docItems: string[];
  retrievalStrategy?: "hybrid_rrf";
}

export class QdrantKnowledgeIndex {
  private readonly client: QdrantClient;
  private setupPromise?: Promise<void>;
  constructor(url = process.env.QDRANT_URL ?? "http://127.0.0.1:6333", client?: QdrantClient) {
    this.client = client ?? new QdrantClient({ url });
  }

  async setup(): Promise<void> {
    this.setupPromise ??= this.setupCollection().catch((error) => {
      this.setupPromise = undefined;
      throw error;
    });
    return this.setupPromise;
  }

  private async setupCollection(): Promise<void> {
    const collections = await this.client.getCollections();
    if (!collections.collections.some((item) => item.name === KNOWLEDGE_COLLECTION)) {
      await this.client.createCollection(KNOWLEDGE_COLLECTION, {
        vectors: { size: KNOWLEDGE_VECTOR_SIZE, distance: "Cosine" },
        on_disk_payload: true,
      });
    }
    const collection = await this.client.getCollection(KNOWLEDGE_COLLECTION);
    const payloadSchema = collection.payload_schema as Record<string, { data_type?: string; params?: Record<string, unknown> } | undefined>;
    const textParams = payloadSchema.text?.params;
    const scoring = textParams?.scoring;
    const hasBm25 = scoring === true || Boolean(scoring && typeof scoring === "object" && "type" in scoring && scoring.type === "bm25");
    if (textParams?.tokenizer !== "multilingual" || !hasBm25) {
      await this.client.createPayloadIndex(KNOWLEDGE_COLLECTION, {
        field_name: "text",
        field_schema: { type: "text", tokenizer: "multilingual", lowercase: true, scoring: { type: "bm25" } },
        wait: true,
      });
    }
    if (payloadSchema.document_id?.data_type !== "keyword") {
      await this.client.createPayloadIndex(KNOWLEDGE_COLLECTION, {
        field_name: "document_id",
        field_schema: "keyword",
        wait: true,
      });
    }
  }

  async replaceDocument(documentId: string, chunks: KnowledgeVectorChunk[]): Promise<void> {
    await this.setup();
    await this.client.delete(KNOWLEDGE_COLLECTION, {
      filter: { must: [{ key: "document_id", match: { value: documentId } }] },
      wait: true,
    });
    await this.client.upsert(KNOWLEDGE_COLLECTION, {
      wait: true,
      points: chunks.map((item) => ({ id: item.id, vector: item.vector, payload: item.payload })),
    });
  }

  async deleteDocument(documentId: string): Promise<void> {
    await this.setup();
    await this.client.delete(KNOWLEDGE_COLLECTION, {
      filter: { must: [{ key: "document_id", match: { value: documentId } }] },
      wait: true,
    });
  }

  async search(queryText: string, vector: number[], limit = 6, documentIds: string[] = []): Promise<KnowledgeSearchHit[]> {
    await this.setup();
    const filter = documentIds.length > 0
      ? { must: [{ key: "document_id", match: { any: documentIds } }] }
      : undefined;
    const candidateLimit = Math.max(limit * 4, 20);
    const result = await this.client.query(KNOWLEDGE_COLLECTION, {
      prefetch: [
        { query: vector, limit: candidateLimit, ...(filter ? { filter } : {}) },
        { query: { text: queryText }, using: "text", limit: candidateLimit, ...(filter ? { filter } : {}) },
      ],
      query: { rrf: {} },
      limit,
      with_payload: true,
    });
    return result.points.map((hit) => {
      const payload = hit.payload ?? {};
      return {
        id: String(hit.id), score: hit.score, documentId: String(payload.document_id ?? ""),
        filename: String(payload.filename ?? ""), chunkId: String(payload.chunk_id ?? ""), text: String(payload.text ?? ""),
        headings: arrayOfStrings(payload.headings), pageNumbers: arrayOfNumbers(payload.page_numbers), docItems: arrayOfStrings(payload.doc_items),
        retrievalStrategy: "hybrid_rrf",
      };
    });
  }
}

function arrayOfStrings(value: unknown): string[] { return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []; }
function arrayOfNumbers(value: unknown): number[] { return Array.isArray(value) ? value.filter((item): item is number => typeof item === "number") : []; }
