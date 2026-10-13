import { describe, expect, it } from "vitest";
import { parsePlaywrightReport } from "../server/playwright.js";
import { DomainStore } from "../server/store.js";

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

  it("持久化项目、环境、Approved TestCase 与目标页面映射", () => {
    const store = new DomainStore(":memory:");
    try {
      const run = store.createUiTestRun({
        projectId: "project-1",
        environmentId: "environment-1",
        approvedVersionId: "approved-v1",
        approvedTestCaseIds: ["TC-003", "TC-004"],
        targetBaseUrl: "http://127.0.0.1:3022",
        repoPath: "F:\\TestMesh",
        testFile: "examples/ui-automation/after-sales.spec.ts",
        playwrightVersion: "1.64.0",
        image: "local",
        containerName: "node-subprocess",
      });
      expect(run).toMatchObject({
        projectId: "project-1",
        environmentId: "environment-1",
        approvedVersionId: "approved-v1",
        approvedTestCaseIds: ["TC-003", "TC-004"],
        targetBaseUrl: "http://127.0.0.1:3022",
      });
    } finally {
      store.close();
    }
  });
});
