import { z } from "zod";

const DoclingResponseSchema = z.object({
  document: z.object({
    filename: z.string().nullish(),
    md_content: z.string().nullish(),
    json_content: z.unknown().nullish(),
  }).passthrough(),
  status: z.enum(["success", "partial_success", "skipped", "failure"]),
  processing_time: z.number().nonnegative().optional(),
  errors: z.array(z.unknown()).default([]),
}).passthrough();

export interface DoclingElement {
  ref: string;
  kind: "text" | "table" | "picture" | "key_value";
  text: string;
  pageNumbers: number[];
}

export interface DoclingParseResult {
  parser: "docling";
  markdown: string;
  schemaVersion: string;
  processingTimeSeconds: number;
  elements: DoclingElement[];
}

export interface DocumentParser {
  parse(input: { filename: string; mimeType: string; bytes: Buffer }): Promise<DoclingParseResult>;
}

type FetchLike = typeof fetch;

function object(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function pageNumbers(item: Record<string, unknown>): number[] {
  const provenance = Array.isArray(item.prov) ? item.prov : [];
  return [...new Set(provenance.flatMap((entry) => {
    const page = Number(object(entry)?.page_no);
    return Number.isInteger(page) && page > 0 ? [page] : [];
  }))].sort((left, right) => left - right);
}

function tableMarkdown(item: Record<string, unknown>): string {
  const data = object(item.data);
  const cells = Array.isArray(data?.table_cells) ? data.table_cells : [];
  const rowCount = Number(data?.num_rows);
  const columnCount = Number(data?.num_cols);
  if (!Number.isInteger(rowCount) || !Number.isInteger(columnCount) || rowCount <= 0 || columnCount <= 0) {
    return cells.map((cell) => stringValue(object(cell)?.text)).filter(Boolean).join(" | ");
  }
  const grid = Array.from({ length: rowCount }, () => Array.from({ length: columnCount }, () => ""));
  for (const cellValue of cells) {
    const cell = object(cellValue);
    if (!cell) continue;
    const startRow = Number(cell.start_row_offset_idx);
    const endRow = Number(cell.end_row_offset_idx);
    const startColumn = Number(cell.start_col_offset_idx);
    const endColumn = Number(cell.end_col_offset_idx);
    const text = stringValue(cell.text).replace(/\|/g, "\\|");
    if (![startRow, endRow, startColumn, endColumn].every(Number.isInteger)) continue;
    for (let row = startRow; row < Math.min(endRow, rowCount); row += 1) {
      for (let column = startColumn; column < Math.min(endColumn, columnCount); column += 1) {
        if (row >= 0 && column >= 0) grid[row][column] = text;
      }
    }
  }
  if (grid.length === 0) return "";
  const header = `| ${grid[0].join(" | ")} |`;
  const separator = `| ${grid[0].map(() => "---").join(" | ")} |`;
  return [header, separator, ...grid.slice(1).map((row) => `| ${row.join(" | ")} |`)].join("\n");
}

function pictureText(item: Record<string, unknown>, refs: Map<string, Record<string, unknown>>): string {
  const referencedText = [...(Array.isArray(item.captions) ? item.captions : []), ...(Array.isArray(item.references) ? item.references : [])]
    .map((reference) => refs.get(stringValue(object(reference)?.$ref)))
    .map((entry) => stringValue(entry?.text))
    .filter(Boolean);
  const annotations = Array.isArray(item.annotations) ? item.annotations : [];
  const described = annotations.flatMap((annotation) => {
    const value = object(annotation);
    return [stringValue(value?.text), stringValue(value?.description)].filter(Boolean);
  });
  return [...new Set([...referencedText, ...described])].join("\n") || "[图片]";
}

function extractElements(documentValue: unknown): { schemaVersion: string; elements: DoclingElement[] } {
  const document = object(documentValue);
  if (!document) throw new Error("Docling 返回的 json_content 不是 DoclingDocument 对象");
  const refs = new Map<string, Record<string, unknown>>();
  const kinds = [
    ["texts", "text"],
    ["tables", "table"],
    ["pictures", "picture"],
    ["key_value_items", "key_value"],
    ["groups", "group"],
  ] as const;
  for (const [collectionName] of kinds) {
    const collection = Array.isArray(document[collectionName]) ? document[collectionName] : [];
    for (const itemValue of collection) {
      const item = object(itemValue);
      if (item && stringValue(item.self_ref)) refs.set(stringValue(item.self_ref), item);
    }
  }

  const elements: DoclingElement[] = [];
  const seen = new Set<string>();
  const visit = (ref: string): void => {
    if (!ref || seen.has(ref)) return;
    seen.add(ref);
    const item = refs.get(ref);
    if (!item) return;
    if (ref.startsWith("#/groups/")) {
      for (const child of Array.isArray(item.children) ? item.children : []) {
        visit(stringValue(object(child)?.$ref));
      }
      return;
    }
    const kind: DoclingElement["kind"] = ref.startsWith("#/tables/")
      ? "table"
      : ref.startsWith("#/pictures/")
        ? "picture"
        : ref.startsWith("#/key_value_items/")
          ? "key_value"
          : "text";
    const text = kind === "table"
      ? tableMarkdown(item)
      : kind === "picture"
        ? pictureText(item, refs)
        : stringValue(item.text) || stringValue(item.orig);
    if (text) elements.push({ ref, kind, text, pageNumbers: pageNumbers(item) });
    for (const child of Array.isArray(item.children) ? item.children : []) {
      visit(stringValue(object(child)?.$ref));
    }
  };

  const body = object(document.body);
  for (const child of Array.isArray(body?.children) ? body.children : []) {
    visit(stringValue(object(child)?.$ref));
  }
  if (elements.length === 0) {
    for (const ref of refs.keys()) visit(ref);
  }
  return { schemaVersion: stringValue(document.version) || "unknown", elements };
}

export function parseDoclingResponse(value: unknown): DoclingParseResult {
  const parsed = DoclingResponseSchema.safeParse(value);
  if (!parsed.success) throw new Error(`Docling 响应不符合 v1 契约：${parsed.error.message}`);
  if (parsed.data.status !== "success") {
    throw new Error(`Docling 未完整解析文档：status=${parsed.data.status} errors=${JSON.stringify(parsed.data.errors)}`);
  }
  const rawDocument = typeof parsed.data.document.json_content === "string"
    ? JSON.parse(parsed.data.document.json_content)
    : parsed.data.document.json_content;
  const extracted = extractElements(rawDocument);
  if (extracted.elements.length === 0) throw new Error("Docling 没有返回可用的正文、表格或图片元素");
  return {
    parser: "docling",
    markdown: parsed.data.document.md_content ?? "",
    schemaVersion: extracted.schemaVersion,
    processingTimeSeconds: parsed.data.processing_time ?? 0,
    elements: extracted.elements,
  };
}

export class DoclingServeClient implements DocumentParser {
  private readonly baseUrl: string;

  constructor(input: {
    baseUrl?: string;
    apiKey?: string;
    timeoutMs?: number;
    ocrLanguages?: string[];
    fetchImpl?: FetchLike;
  } = {}) {
    this.baseUrl = (input.baseUrl ?? "http://127.0.0.1:5001").replace(/\/$/, "");
    this.apiKey = input.apiKey;
    this.timeoutMs = input.timeoutMs ?? 900_000;
    this.ocrLanguages = input.ocrLanguages ?? [];
    this.fetchImpl = input.fetchImpl ?? fetch;
  }

  private readonly apiKey?: string;
  private readonly timeoutMs: number;
  private readonly ocrLanguages: string[];
  private readonly fetchImpl: FetchLike;

  async parse(input: { filename: string; mimeType: string; bytes: Buffer }): Promise<DoclingParseResult> {
    const form = new FormData();
    form.append("files", new Blob([new Uint8Array(input.bytes)], { type: input.mimeType }), input.filename);
    form.append("to_formats", "md");
    form.append("to_formats", "json");
    form.append("image_export_mode", "placeholder");
    form.append("do_ocr", "true");
    form.append("force_ocr", "false");
    form.append("table_mode", "accurate");
    form.append("abort_on_error", "true");
    for (const language of this.ocrLanguages) form.append("ocr_lang", language);

    const headers: Record<string, string> = { accept: "application/json" };
    if (this.apiKey) headers.authorization = `Bearer ${this.apiKey}`;
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/v1/convert/file`, {
        method: "POST",
        headers,
        body: form,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      throw new Error(
        `Docling Serve 不可用（${this.baseUrl}）：${error instanceof Error ? error.message : "连接失败"}`,
        { cause: error },
      );
    }
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 1_000);
      throw new Error(`Docling 解析失败（HTTP ${response.status}）：${detail || response.statusText}`);
    }
    return parseDoclingResponse(await response.json());
  }
}

export function createDoclingClientFromEnvironment(): DoclingServeClient {
  const timeout = Number(process.env.DOCLING_TIMEOUT_MS ?? 900_000);
  if (!Number.isFinite(timeout) || timeout <= 0) throw new Error("DOCLING_TIMEOUT_MS 必须是正数");
  return new DoclingServeClient({
    baseUrl: process.env.DOCLING_SERVE_URL,
    apiKey: process.env.DOCLING_API_KEY,
    timeoutMs: timeout,
    ocrLanguages: (process.env.DOCLING_OCR_LANGS ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  });
}
