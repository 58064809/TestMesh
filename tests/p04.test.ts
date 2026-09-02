import { describe, expect, it } from "vitest";
import { parsePlaywrightReport } from "../server/playwright.js";

describe("P04-A Playwright JSON Reporter", () => {
  it("从唯一 JSON 结果源提取测试结果", () => {
    const results = parsePlaywrightReport({
      suites: [{
        title: "demo.spec.ts",
        specs: [{
          title: "opens the workbench",
          tests: [{ projectName: "chromium", results: [{ status: "passed", duration: 321 }] }],
        }],
      }],
    });
    expect(results).toEqual([{
      title: "demo.spec.ts > opens the workbench",
      projectName: "chromium",
      status: "passed",
      durationMs: 321,
      error: "",
    }]);
  });

  it("遇到未支持的 Reporter 状态时立即停止", () => {
    expect(() => parsePlaywrightReport({
      suites: [{ specs: [{ tests: [{ results: [{ status: "unknown" }] }] }] }],
    })).toThrow("未支持状态");
  });
});
