import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseDoclingResponse } from "../server/document-parsing/docling.js";

const [taskId, sha256] = process.argv.slice(2);
if (!taskId || !sha256) throw new Error("用法：tsx scripts/cache-docling-result.ts <task-id> <sha256>");
const response = await fetch(`http://127.0.0.1:5001/v1/result/${encodeURIComponent(taskId)}`);
if (!response.ok) throw new Error(`无法读取 Docling 结果：HTTP ${response.status}`);
const parsed = parseDoclingResponse(await response.json());
const hasPageProvenance = parsed.elements.every((element) => element.pageNumbers.length > 0);
const cacheDirectory = path.resolve(import.meta.dirname, "..", "data", "aq01-parse-cache");
await mkdir(cacheDirectory, { recursive: true });
await writeFile(path.join(cacheDirectory, `${sha256.toLowerCase()}.json`), JSON.stringify({
  formatVersion: 1,
  parsed,
  capability: hasPageProvenance ? "page" : "paragraph",
  capabilityNote: hasPageProvenance
    ? `Docling ${parsed.schemaVersion} 已完成 OCR、表格与版面解析；引用使用原文页码。`
    : `Docling ${parsed.schemaVersion} 已完成结构化解析；该格式未为全部元素提供页码，引用使用稳定元素序号。`,
}));
