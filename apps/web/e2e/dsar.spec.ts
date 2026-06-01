import { test, expect } from "@playwright/test";
import { loginViaOtp } from "./helpers/login";

const PHONE = "13800000012"; // dev-student-06,成年独占(注销会销号)

test("DSAR: 下载副本 + 发起注销 + 撤销", async ({ page, request }) => {
  await loginViaOtp(page, request, PHONE);
  await page.goto("/account/privacy");

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByTestId("dsar-export").click(),
  ]);
  expect(download.suggestedFilename()).toContain("zhijiao-data");

  await page.getByTestId("dsar-send-otp").click();
  // dsar-otp-code 仅在 sendDeletionOtp 成功(otpSent=true)后渲染,
  // 等它出现可确保 OTP 已写入 Redis,再去取码避免竞态。
  await expect(page.getByTestId("dsar-otp-code")).toBeVisible();
  const res = await request.get(`/api/e2e-hooks/last-otp?phone=${PHONE}`);
  const { code } = await res.json();
  await page.getByTestId("dsar-otp-code").fill(code);
  await page.getByTestId("dsar-delete-submit").click();

  await expect(page.getByTestId("dsar-pending")).toBeVisible();
  await page.getByTestId("dsar-delete-cancel").click();
  await expect(page.getByTestId("dsar-send-otp")).toBeVisible();
});
