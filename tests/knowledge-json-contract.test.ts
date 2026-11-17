import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { chunkKnowledgeJson } from "../server/knowledge/service.js";
import { parseOpenApi } from "../server/openapi.js";

const filename = "examples/ai-application/smart-shopping.openapi.json";

describe("JSON contract knowledge", () => {
  it("preserves a valid OpenAPI source and makes it indexable as text", async () => {
    const bytes = readFileSync(filename);
    const contract = parseOpenApi(bytes.toString("utf8"));
    const chunks = await chunkKnowledgeJson({ filename, bytes });
    expect(contract.operations.map((item) => item.operationId)).toContain("invokeSmartShoppingSimulation");
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.some((item) => item.text.includes("invokeSmartShoppingSimulation"))).toBe(true);
    expect(chunks.every((item) => item.metadata.source_format === "json")).toBe(true);
  });

  it("rejects malformed JSON instead of sending it to Docling", async () => {
    await expect(chunkKnowledgeJson({ filename: "broken.json", bytes: Buffer.from("{invalid") })).rejects.toThrow("JSON 知识文件无效");
  });
});
