import { test, expect } from "@playwright/test";
import { loginViaOtp } from "./helpers/login";

test("seed 学生登录后问一道题", async ({ page, request }) => {
  await loginViaOtp(page, request, "13800000001");
  await page.goto("/tutor");
  await page.getByTestId("tutor-input").fill("解一元一次方程 2x + 3 = 7");
  await page.getByTestId("tutor-submit").click();
  await expect(page.getByTestId("tutor-output")).toBeVisible({ timeout: 15_000 });
});
