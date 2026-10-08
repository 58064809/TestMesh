import type { DocumentParser } from "./docling.js";
import {
  requiresDocumentParser,
  type SourceFile,
} from "../requirement-analysis/sources.js";

export async function parseAnalysisSources(
  sources: SourceFile[],
  parser: DocumentParser,
): Promise<SourceFile[]> {
  return Promise.all(sources.map(async (source) => {
    if (!requiresDocumentParser(source.name)) {
      return {
        ...source,
        parser: "native-text" as const,
        capability: "paragraph" as const,
        capabilityNote: "纯文本由 TestMesh 加入稳定段落编号；复杂文档统一交给 Docling。",
      };
    }
    const parsed = await parser.parse({ filename: source.name, mimeType: source.mimeType, bytes: source.buffer });
    const hasPageProvenance = parsed.elements.every((element) => element.pageNumbers.length > 0);
    return {
      ...source,
      parser: "docling" as const,
      parsed,
      capability: hasPageProvenance ? "page" as const : "paragraph" as const,
      capabilityNote: hasPageProvenance
        ? `Docling ${parsed.schemaVersion} 已完成 OCR、表格与版面解析；引用使用原文页码。`
        : `Docling ${parsed.schemaVersion} 已完成结构化解析；该格式未为全部元素提供页码，引用使用稳定元素序号。`,
    };
  }));
}
