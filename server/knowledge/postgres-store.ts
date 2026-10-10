import { randomUUID } from "node:crypto";
import type pg from "pg";

export type KnowledgeDocumentStatus = "processing" | "indexed" | "failed";

export interface KnowledgeDocumentRecord {
  id: string;
  filename: string;
  mimeType: string;
  sha256: string;
  byteSize: number;
  status: KnowledgeDocumentStatus;
  chunkCount: number;
  embeddingModel: string;
  error: string;
  createdAt: string;
  indexedAt: string | null;
}

export class KnowledgePostgresStore {
  constructor(private readonly pool: pg.Pool, private readonly schema: string) {}

  async setup(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS ${this.schema}.knowledge_documents (
        id TEXT PRIMARY KEY,
        filename TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        sha256 TEXT NOT NULL UNIQUE,
        byte_size INTEGER NOT NULL,
        file_bytes BYTEA NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('processing', 'indexed', 'failed')),
        chunk_count INTEGER NOT NULL DEFAULT 0,
        embedding_model TEXT NOT NULL,
        error TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        indexed_at TIMESTAMPTZ
      )
    `);
  }

  async create(input: { filename: string; mimeType: string; sha256: string; bytes: Buffer; embeddingModel: string }): Promise<KnowledgeDocumentRecord> {
    const existing = await this.findBySha256(input.sha256);
    if (existing) return existing;
    const result = await this.pool.query(`
      INSERT INTO ${this.schema}.knowledge_documents
        (id, filename, mime_type, sha256, byte_size, file_bytes, status, embedding_model)
      VALUES ($1, $2, $3, $4, $5, $6, 'processing', $7)
      RETURNING *
    `, [randomUUID(), input.filename, input.mimeType, input.sha256, input.bytes.length, input.bytes, input.embeddingModel]);
    return mapRow(result.rows[0]);
  }

  async markIndexed(id: string, chunkCount: number): Promise<KnowledgeDocumentRecord> {
    const result = await this.pool.query(`
      UPDATE ${this.schema}.knowledge_documents
      SET status = 'indexed', chunk_count = $2, error = '', indexed_at = NOW()
      WHERE id = $1 RETURNING *
    `, [id, chunkCount]);
    if (!result.rows[0]) throw new Error("知识文档不存在");
    return mapRow(result.rows[0]);
  }

  async markFailed(id: string, error: string): Promise<void> {
    await this.pool.query(`UPDATE ${this.schema}.knowledge_documents SET status = 'failed', error = $2 WHERE id = $1`, [id, error.slice(0, 2_000)]);
  }

  async list(): Promise<KnowledgeDocumentRecord[]> {
    const result = await this.pool.query(`SELECT * FROM ${this.schema}.knowledge_documents ORDER BY created_at DESC`);
    return result.rows.map(mapRow);
  }

  async findBySha256(sha256: string): Promise<KnowledgeDocumentRecord | null> {
    const result = await this.pool.query(`SELECT * FROM ${this.schema}.knowledge_documents WHERE sha256 = $1`, [sha256]);
    return result.rows[0] ? mapRow(result.rows[0]) : null;
  }

  async delete(id: string): Promise<void> {
    const result = await this.pool.query(`DELETE FROM ${this.schema}.knowledge_documents WHERE id = $1`, [id]);
    if (result.rowCount !== 1) throw new Error("知识文档不存在");
  }
}

function mapRow(row: Record<string, unknown>): KnowledgeDocumentRecord {
  return {
    id: String(row.id), filename: String(row.filename), mimeType: String(row.mime_type), sha256: String(row.sha256),
    byteSize: Number(row.byte_size), status: row.status as KnowledgeDocumentStatus, chunkCount: Number(row.chunk_count),
    embeddingModel: String(row.embedding_model), error: String(row.error ?? ""),
    createdAt: new Date(String(row.created_at)).toISOString(), indexedAt: row.indexed_at ? new Date(String(row.indexed_at)).toISOString() : null,
  };
}
