import type { AnalysisSource } from "./types";

export type PdfPageRange = { start: number; end: number };

export function pdfPageRange(locator: string): PdfPageRange | undefined {
  const listed = /第\s*(\d+)\s*[、,，]/i.exec(locator);
  if (listed) {
    const page = Number(listed[1]);
    return page > 0 ? { start: page, end: page } : undefined;
  }
  const range = /(?:第\s*)?(\d+)\s*[-–—~至]\s*(\d+)\s*页/i.exec(locator);
  if (range) {
    const start = Number(range[1]);
    const end = Number(range[2]);
    return start > 0 && end >= start ? { start, end } : undefined;
  }
  const single = /(?:第\s*)?(\d+)\s*页|page\s*(\d+)|p\.\s*(\d+)|^\s*(\d+)\s*$/i.exec(locator);
  const page = Number(single?.slice(1).find(Boolean));
  return page > 0 ? { start: page, end: page } : undefined;
}

export function sourceFileUrl(analysisId: string, sourceFileId: string): string {
  return `/api/analyses/${encodeURIComponent(analysisId)}/source-files/${encodeURIComponent(sourceFileId)}`;
}

export function visualEvidence(source: AnalysisSource, mimeType: string): { kind: "image" | "pdf"; pages?: PdfPageRange } | undefined {
  if (mimeType.startsWith("image/")) return { kind: "image" };
  if (mimeType === "application/pdf" && source.locator_type === "image") {
    const pages = pdfPageRange(source.locator);
    if (pages) return { kind: "pdf", pages };
  }
  return undefined;
}
