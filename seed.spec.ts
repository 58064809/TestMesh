import { test } from "@playwright/test";

test.describe("TestMesh UI Agent 环境种子", () => {
  test("打开项目配置的目标页面", async ({ page }) => {
    await page.goto("/");
  });
});
