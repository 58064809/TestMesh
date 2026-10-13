import { expect, test } from "@playwright/test";

test("完整退货申请进入人工审核", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("订单号").fill("ORDER-1001");
  await page.getByLabel("退货原因").selectOption("damaged");
  await page.getByRole("button", { name: "提交申请" }).click();
  await expect(page.getByRole("status")).toHaveText("申请已提交，等待人工审核");
});

test("缺少必填信息时阻止提交", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "提交申请" }).click();
  await expect(page.getByRole("status")).toHaveText("请填写订单号并选择退货原因");
});
