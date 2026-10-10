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
}

export class QdrantKnowledgeIndex {
  private readonly client: QdrantClient;
  constructor(url = process.env.QDRANT_URL ?? "http://127.0.0.1:6333") {
    this.client = new QdrantClient({ url });
  }

  async setup(): Promise<void> {
    const collections = await this.client.getCollections();
    if (collections.collections.some((item) => item.name === KNOWLEDGE_COLLECTION)) return;
    await this.client.createCollection(KNOWLEDGE_COLLECTION, {
      vectors: { size: KNOWLEDGE_VECTOR_SIZE, distance: "Cosine" },
      on_disk_payload: true,
    });
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

  async search(vector: number[], limit = 6): Promise<KnowledgeSearchHit[]> {
    await this.setup();
    const result = await this.client.query(KNOWLEDGE_COLLECTION, { query: vector, limit, with_payload: true });
    return result.points.map((hit) => {
      const payload = hit.payload ?? {};
      return {
        id: String(hit.id), score: hit.score, documentId: String(payload.document_id ?? ""),
        filename: String(payload.filename ?? ""), chunkId: String(payload.chunk_id ?? ""), text: String(payload.text ?? ""),
        headings: arrayOfStrings(payload.headings), pageNumbers: arrayOfNumbers(payload.page_numbers), docItems: arrayOfStrings(payload.doc_items),
      };
    });
  }
}

function arrayOfStrings(value: unknown): string[] { return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []; }
function arrayOfNumbers(value: unknown): number[] { return Array.isArray(value) ? value.filter((item): item is number => typeof item === "number") : []; }
