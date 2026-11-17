import { describe, expect, it, vi } from "vitest";
import type { QdrantClient } from "@qdrant/js-client-rest";
import { KNOWLEDGE_COLLECTION, QdrantKnowledgeIndex } from "../server/knowledge/qdrant.js";

describe("project knowledge hybrid retrieval", () => {
  it("uses Qdrant multilingual BM25 and dense retrieval with native RRF", async () => {
    const query = vi.fn().mockResolvedValue({
      points: [{
        id: "point-1", score: 0.8,
        payload: {
          document_id: "doc-1", filename: "rules.md", chunk_id: "doc-1:chunk:0",
          text: "会员到期后已支付订单不受影响", headings: ["会员规则"], page_numbers: [2], doc_items: ["#/texts/2"],
        },
      }],
    });
    const createPayloadIndex = vi.fn().mockResolvedValue({ status: "completed" });
    const client = {
      getCollections: vi.fn().mockResolvedValue({ collections: [{ name: KNOWLEDGE_COLLECTION }] }),
      getCollection: vi.fn().mockResolvedValue({ payload_schema: {} }),
      createCollection: vi.fn(), createPayloadIndex, query,
      delete: vi.fn(), upsert: vi.fn(),
    } as unknown as QdrantClient;
    const index = new QdrantKnowledgeIndex("http://unused", client);

    const hits = await index.search("REQ-001 已支付订单", [0.1, 0.2], 5, ["doc-1"]);

    expect(createPayloadIndex).toHaveBeenCalledWith(KNOWLEDGE_COLLECTION, expect.objectContaining({
      field_name: "text",
      field_schema: expect.objectContaining({ tokenizer: "multilingual", scoring: { type: "bm25" } }),
    }));
    expect(query).toHaveBeenCalledWith(KNOWLEDGE_COLLECTION, expect.objectContaining({
      prefetch: [
        expect.objectContaining({ query: [0.1, 0.2], filter: { must: [{ key: "document_id", match: { any: ["doc-1"] } }] } }),
        expect.objectContaining({ query: { text: "REQ-001 已支付订单" }, using: "text" }),
      ],
      query: { rrf: {} },
      limit: 5,
    }));
    expect(hits[0]).toMatchObject({ chunkId: "doc-1:chunk:0", retrievalStrategy: "hybrid_rrf" });
  });
});
