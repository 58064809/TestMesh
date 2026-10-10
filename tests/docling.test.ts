import { describe, expect, it, vi } from "vitest";
import { DoclingServeClient } from "../server/document-parsing/docling.js";
import { parseAnalysisSources } from "../server/document-parsing/parse-sources.js";
import { buildRequirementSourceContent, createSources } from "../server/requirement-analysis/sources.js";

const responseBody = {
  status: "success",
  processing_time: 1.25,
  errors: [],
  document: {
    filename: "需求.pdf",
    md_content: "# 订单\n\n| 状态 | 时限 |",
    json_content: {
      schema_name: "DoclingDocument",
      version: "1.9.0",
      body: { children: [{ $ref: "#/texts/0" }, { $ref: "#/tables/0" }] },
      groups: [],
      pictures: [],
      key_value_items: [],
      texts: [{
        self_ref: "#/texts/0", text: "订单超时关闭", children: [],
        prov: [{ page_no: 2 }],
      }],
      tables: [{
        self_ref: "#/tables/0", children: [], prov: [{ page_no: 3 }],
        data: {
          num_rows: 2, num_cols: 2,
          table_cells: [
            { start_row_offset_idx: 0, end_row_offset_idx: 1, start_col_offset_idx: 0, end_col_offset_idx: 1, text: "状态" },
            { start_row_offset_idx: 0, end_row_offset_idx: 1, start_col_offset_idx: 1, end_col_offset_idx: 2, text: "时限" },
            { start_row_offset_idx: 1, end_row_offset_idx: 2, start_col_offset_idx: 0, end_col_offset_idx: 1, text: "待支付" },
            { start_row_offset_idx: 1, end_row_offset_idx: 2, start_col_offset_idx: 1, end_col_offset_idx: 2, text: "30 分钟" },
          ],
        },
      }],
    },
  },
};

describe("Docling Serve v1 adapter", () => {
  it("uses Docling OCR/table/layout output and preserves page provenance", async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const form = init?.body as FormData;
      expect(form.getAll("to_formats")).toEqual(["md", "json"]);
      expect(form.get("do_ocr")).toBe("true");
      expect(form.get("table_mode")).toBe("accurate");
      expect(form.getAll("ocr_lang")).toEqual([]);
      return new Response(JSON.stringify(responseBody), { status: 200, headers: { "content-type": "application/json" } });
    });
    const client = new DoclingServeClient({ fetchImpl: fetchImpl as typeof fetch });
    const parsed = await client.parse({ filename: "需求.pdf", mimeType: "application/pdf", bytes: Buffer.from("pdf") });

    expect(parsed.schemaVersion).toBe("1.9.0");
    expect(parsed.elements[0]).toMatchObject({ ref: "#/texts/0", pageNumbers: [2], text: "订单超时关闭" });
    expect(parsed.elements[1].text).toContain("| 待支付 | 30 分钟 |");
    expect(parsed.elements[1].pageNumbers).toEqual([3]);
  });

  it("turns every complex source into text-only model context without a hidden fallback", async () => {
    const client = new DoclingServeClient({
      fetchImpl: (async () => new Response(JSON.stringify(responseBody), {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as typeof fetch,
    });
    const sources = await parseAnalysisSources(createSources([
      { originalname: "需求.pdf", mimetype: "application/pdf", buffer: Buffer.from("raw-secret-bytes") },
    ], []), client);
    const blocks = buildRequirementSourceContent("分析需求", sources);
    const serialized = JSON.stringify(blocks);

    expect(sources[0]).toMatchObject({ parser: "docling", capability: "page" });
    expect(serialized).toContain("页码 2");
    expect(serialized).toContain("订单超时关闭");
    expect(serialized).not.toContain(Buffer.from("raw-secret-bytes").toString("base64"));
  });

  it("stops on partial results instead of silently accepting or switching parser", async () => {
    const client = new DoclingServeClient({
      fetchImpl: (async () => new Response(JSON.stringify({ ...responseBody, status: "partial_success" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as typeof fetch,
    });
    await expect(client.parse({ filename: "需求.pdf", mimeType: "application/pdf", bytes: Buffer.from("pdf") }))
      .rejects.toThrow("Docling 未完整解析文档");
  });

  it("uses the official HybridChunker endpoint and preserves structural provenance", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toContain("/v1/chunk/hybrid/file");
      const form = init?.body as FormData;
      expect(form.get("chunking_use_markdown_tables")).toBe("true");
      expect(form.get("chunking_include_raw_text")).toBe("true");
      return new Response(JSON.stringify({
        chunks: [{ filename: "架构.pdf", chunk_index: 0, text: "# 支付\n退款依赖支付网关", raw_text: "退款依赖支付网关", num_tokens: 12, headings: ["支付"], captions: [], doc_items: ["#/texts/1"], page_numbers: [4], metadata: {} }],
        documents: [], processing_time: 0.5,
      }), { status: 200, headers: { "content-type": "application/json" } });
    });
    const chunks = await new DoclingServeClient({ fetchImpl: fetchImpl as typeof fetch }).chunk({ filename: "架构.pdf", mimeType: "application/pdf", bytes: Buffer.from("pdf") });
    expect(chunks).toEqual([expect.objectContaining({ index: 0, headings: ["支付"], pageNumbers: [4], docItems: ["#/texts/1"] })]);
  });
});
