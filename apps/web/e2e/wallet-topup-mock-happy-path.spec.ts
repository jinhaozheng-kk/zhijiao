import { test, expect } from "@playwright/test";
import { loginViaOtp } from "./helpers/login";

// Mock notifyMode in dev is 'async-delayed' (~50ms), so the topup
// flow auto-credits within a few hundred ms. Topup form invalidates
// wallet.balance + ledger after 300ms, which should be plenty of time
// for the webhook to land and applyWechatPayNotify to commit.
//
// Uses the teacher fixture (isMinor=false) so 1 yuan attempts don't
// graze the 200元/month minor cap, keeping this test independent of
// per-run order accumulation.

test("topup 1 元 → balance becomes 10 (mock async-delayed webhook)", async ({
  page,
  request,
}) => {
  await loginViaOtp(page, request, "13800000002");

  await page.goto("/wallet");
  await expect(page.getByText("当前余额")).toBeVisible();

  // 1 yuan preset is the smallest; matches CREDIT_PER_YUAN=10 → 10 credits.
  await page.getByTestId("topup-preset-100").click();
  await page.getByTestId("topup-submit").click();

  // The order card should appear synchronously after the mutation resolves.
  await expect(page.getByTestId("topup-order-card")).toBeVisible({
    timeout: 5_000,
  });

  // Within a few seconds the mock webhook arrives and the balance refreshes.
  // We poll the balance text rather than the raw number to avoid coupling to
  // the page's previous balance (which depends on prior runs in the same
  // seed-once session).
  await expect(async () => {
    const text = await page.locator("text=/^\\d+ 点$/").first().textContent();
    const n = parseInt((text ?? "0 点").replace(" 点", ""), 10);
    expect(n).toBeGreaterThanOrEqual(10);
  }).toPass({ timeout: 10_000, intervals: [500] });

  // Ledger should show a +10 TOPUP entry.
  await expect(page.getByTestId("ledger-list")).toContainText("+10");
  await expect(page.getByTestId("ledger-list")).toContainText("充值");
});
