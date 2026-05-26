import { test, expect } from "@playwright/test";

const TITLE = "\u8d26\u53f7\u6ce8\u9500\u4e0e\u4e2a\u4eba\u4fe1\u606f\u5904\u7406";
const PIPL_47 = "\u4e2a\u4eba\u4fe1\u606f\u4fdd\u62a4\u6cd5\u300b\u7b2c\u56db\u5341\u4e03\u6761";
const PIPL_45 = "\u4e2a\u4eba\u4fe1\u606f\u4fdd\u62a4\u6cd5\u300b\u7b2c\u56db\u5341\u4e94\u6761";
const REFUND = /\u9000\u6b3e|\u5168\u989d\u9000\u6b3e/;

test("support deactivate page renders compliance copy and placeholders", async ({ page }) => {
  await page.goto("/support/deactivate");
  await expect(page.getByRole("heading", { name: TITLE })).toBeVisible();
  await expect(page.getByText(PIPL_47)).toBeVisible();
  await expect(page.getByText(PIPL_45)).toBeVisible();
  await expect(page.getByText("PLACEHOLDER_WECHAT_OFFICIAL_ACCOUNT")).toBeVisible();
  await expect(page.getByText("support@zhijiao.example")).toBeVisible();
  await expect(page.getByText("PLACEHOLDER_OPERATOR_ENTITY")).toBeVisible();
  await expect(page.getByText("PLACEHOLDER_ICP_NUMBER")).toBeVisible();
  await expect(page.getByText(REFUND)).toHaveCount(0);
});
