import { describe, expect, it } from "vitest";
import { pdfPageRange, sourceFileUrl, visualEvidence } from "../src/evidence-preview.js";
import type { AnalysisSource } from "../src/types.js";

const source: AnalysisSource = {
  id: "SRC-023", description: "退货流程图", origin: "explicit", source_refs: [], confidence: 0.9,
  source_file_id: "ATT-1", source_file_name: "流程.pdf", locator_type: "image", locator: "第5页退货流程",
  excerpt: "",
};

describe("review evidence previews", () => {
  it("locates PDF image evidence by its actual page or page range", () => {
    expect(pdfPageRange("第5页退货流程")).toEqual({ start: 5, end: 5 });
    expect(pdfPageRange("第1-2页系统架构图")).toEqual({ start: 1, end: 2 });
    expect(pdfPageRange("第2、9-12页售后场景")).toEqual({ start: 2, end: 2 });
    expect(pdfPageRange("page 8 · invoice flow")).toEqual({ start: 8, end: 8 });
    expect(pdfPageRange("架构图")).toBeUndefined();
    expect(pdfPageRange("第4-2页流程图")).toBeUndefined();
  });

  it("renders independent images directly and PDF image references as page previews", () => {
    expect(visualEvidence(source, "application/pdf")).toEqual({ kind: "pdf", pages: { start: 5, end: 5 } });
    expect(visualEvidence({ ...source, source_file_name: "截图.png", locator_type: "image", locator: "整张图片" }, "image/png")).toEqual({ kind: "image" });
    expect(visualEvidence({ ...source, locator_type: "page" }, "application/pdf")).toBeUndefined();
    expect(visualEvidence({ ...source, locator: "未给页码" }, "application/pdf")).toBeUndefined();
    expect(visualEvidence(source, "application/vnd.openxmlformats-officedocument.wordprocessingml.document")).toBeUndefined();
  });

  it("uses the retained original-file route without inventing a cropped image", () => {
    expect(sourceFileUrl("analysis 1", "ATT/1")).toBe("/api/analyses/analysis%201/source-files/ATT%2F1");
  });
});
