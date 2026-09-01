import { describe, expect, it } from "vitest";
import {
  attachEvidenceSourceNames,
  createSources,
  formatTextWithParagraphs,
  isAcceptedFilename,
  MAX_OUTPUT_TOKENS,
  normalizeUploadFilename,
  validateEvidenceSources,
  worstCaseTokenCostUsd,
  type AnalysisResult,
} from "../server/analysis.js";

describe("P01 source handling", () => {
  it("keeps the documented worst-case token cost below $0.50", () => {
    expect(MAX_OUTPUT_TOKENS).toBe(40_000);
    expect(worstCaseTokenCostUsd()).toBeCloseTo(0.476, 3);
    expect(worstCaseTokenCostUsd()).toBeLessThan(0.5);
  });

  it("accepts the approved P01 formats only", () => {
    expect(isAcceptedFilename("prd.pdf")).toBe(true);
    expect(isAcceptedFilename("flow.PNG")).toBe(true);
    expect(isAcceptedFilename("requirements.docx")).toBe(true);
    expect(isAcceptedFilename("runner.zip")).toBe(false);
  });

  it("normalizes UTF-8 upload names decoded as latin1", () => {
    const expected = "《AI售后系统产品方案 + PRD文档》.pdf";
    const mojibake = Buffer.from(expected, "utf8").toString("latin1");

    expect(normalizeUploadFilename(mojibake)).toBe(expected);
    expect(normalizeUploadFilename(expected)).toBe(expected);
    expect(normalizeUploadFilename("prd.pdf")).toBe("prd.pdf");
  });

  it("keeps chat attachments and project knowledge distinct", () => {
    const sources = createSources(
      [{ originalname: "prd.pdf", mimetype: "application/pdf", buffer: Buffer.from("pdf") }],
      [{ originalname: "terms.md", mimetype: "text/markdown", buffer: Buffer.from("A\n\nB") }],
    );

    expect(sources.map(({ id, scope, capability }) => ({ id, scope, capability }))).toEqual([
      { id: "ATT-1", scope: "attachment", capability: "page" },
      { id: "KNOW-1", scope: "knowledge", capability: "paragraph" },
    ]);
    expect(formatTextWithParagraphs(sources[1])).toContain("【KNOW-1 段落 2】");
  });

  it("rejects evidence that invents a source", () => {
    const sources = createSources(
      [{ originalname: "prd.pdf", mimetype: "application/pdf", buffer: Buffer.from("pdf") }],
      [],
    );
    const result: AnalysisResult = {
      summary: "summary",
      requirements: [],
      risks: [],
      pendingQuestions: [],
      evidence: [
        {
          id: "E-1",
          sourceId: "ATT-9",
          sourceName: "fake.pdf",
          locatorType: "page",
          locator: "1",
          excerpt: "x",
          note: "",
        },
      ],
    };

    expect(() => validateEvidenceSources(result, sources)).toThrow("未知来源");
  });

  it("fills evidence source names from the authoritative source id", () => {
    const sources = createSources(
      [{ originalname: "真实需求.pdf", mimetype: "application/pdf", buffer: Buffer.from("pdf") }],
      [],
    );
    const result = attachEvidenceSourceNames(
      {
        summary: "summary",
        requirements: [],
        risks: [],
        pendingQuestions: [],
        evidence: [
          {
            id: "E-1",
            sourceId: "ATT-1",
            locatorType: "page",
            locator: "1",
            excerpt: "x",
            note: "",
          },
        ],
      },
      sources,
    );

    expect(result.evidence[0].sourceName).toBe("真实需求.pdf");
  });

  it("requires limited locators for office documents", () => {
    const sources = createSources(
      [{ originalname: "prd.docx", mimetype: "application/octet-stream", buffer: Buffer.from("doc") }],
      [],
    );
    const result: AnalysisResult = {
      summary: "summary",
      requirements: [],
      risks: [],
      pendingQuestions: [],
      evidence: [
        {
          id: "E-1",
          sourceId: "ATT-1",
          sourceName: "prd.docx",
          locatorType: "page",
          locator: "2",
          excerpt: "x",
          note: "",
        },
      ],
    };

    expect(() => validateEvidenceSources(result, sources)).toThrow("定位受限格式");
  });
});
