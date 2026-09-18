import { describe, expect, it } from "vitest";
import {
  buildRequirementSourceContent,
  createRequirementSourceTools,
  createSources,
} from "../server/requirement-analysis/sources.js";

const sources = createSources([
  { originalname: "prd.md", mimetype: "text/markdown", buffer: Buffer.from("第一段\n\n第二段") },
  { originalname: "flow.png", mimetype: "image/png", buffer: Buffer.from("image-bytes") },
  { originalname: "state.pdf", mimetype: "application/pdf", buffer: Buffer.from("pdf-bytes") },
], []);

describe("RA01 controlled requirement source reader", () => {
  it("builds one scoped multimodal context with stable source markers", () => {
    const blocks = buildRequirementSourceContent("分析完整需求", sources);
    expect(blocks[0]).toMatchObject({ type: "text" });
    expect(JSON.stringify(blocks)).toContain("ATT-1");
    expect(JSON.stringify(blocks)).toContain("【ATT-1 段落 2】");
    expect(blocks).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "image", mimeType: "image/png", metadata: expect.objectContaining({ sourceFileId: "ATT-2" }) }),
      expect.objectContaining({ type: "file", mimeType: "application/pdf", metadata: expect.objectContaining({ sourceFileId: "ATT-3", filename: "state.pdf", detail: "high" }) }),
    ]));
  });

  it("exposes only read, locate and reference validation tools without returning binary bytes", async () => {
    const tools = createRequirementSourceTools(sources);
    expect(tools.map((item) => item.name)).toEqual([
      "read_source",
      "locate_source",
      "validate_reference",
    ]);

    const readSource = tools.find((item) => item.name === "read_source");
    const textResult = String(await readSource?.invoke({ source_file_id: "ATT-1" }));
    const imageResult = String(await readSource?.invoke({ source_file_id: "ATT-2" }));
    expect(textResult).toContain("【ATT-1 段落 1】");
    expect(imageResult).toContain('"multimodal_context":true');
    expect(imageResult).not.toContain(Buffer.from("image-bytes").toString("base64"));
  });

  it("validates PDF image pages and rejects unknown or unverifiable locators", async () => {
    const validate = createRequirementSourceTools(sources)
      .find((item) => item.name === "validate_reference");
    await expect(validate?.invoke({
      source_file_id: "ATT-3",
      locator_type: "image",
      locator: "第 2 页流程图",
    })).resolves.toContain('"valid":true');
    await expect(validate?.invoke({
      source_file_id: "ATT-3",
      locator_type: "image",
      locator: "流程图",
    })).rejects.toThrow("PDF 图片定位没有可核对的页码");
    await expect(validate?.invoke({
      source_file_id: "NOT-FOUND",
      locator_type: "page",
      locator: "第 1 页",
    })).rejects.toThrow("当前任务不存在来源文件");
  });
});
