import { test, expect } from "@playwright/test";
import { loginViaOtp } from "./helpers/login";

// chargedProcedure('TUTOR_ASK') costs 1 credit per call. Seed gives
// every test user 100 credits (see packages/db/prisma/seed/1_test_users.ts).
// Use the parent fixture (13800000003, isMinor=false) so we don't share
// a phone number with any other E2E test — playwright runs files in
// parallel workers, and two specs racing on the same OTP code for the
// same phone is the flake that 2 of 3 attempts at this E2E surfaced.

test("tutor.ask charges 1 credit per request; ledger shows the DEBIT", async ({
  page,
  request,
}) => {
  await loginViaOtp(page, request, "13800000003");

  // Baseline balance reading.
  await page.goto("/wallet");
  const before = parseInt(
    (
      (await page.locator("text=/^\\d+ 点$/").first().textContent()) ??
      "0 点"
    ).replace(" 点", ""),
    10,
  );

  // Ask a tutor question.
  await page.goto("/tutor");
  await page
    .getByTestId("tutor-input")
    .fill("解一元一次方程 2x + 3 = 7");
  await page.getByTestId("tutor-submit").click();
  await expect(page.getByTestId("tutor-output")).toBeVisible({
    timeout: 30_000,
  });

  // Back to wallet — balance is before - 1, ledger shows a -1 DEBIT.
  await page.goto("/wallet");
  await expect(async () => {
    const text = await page.locator("text=/^\\d+ 点$/").first().textContent();
    const n = parseInt((text ?? "0 点").replace(" 点", ""), 10);
    expect(n).toBe(before - 1);
  }).toPass({ timeout: 5_000, intervals: [250] });

  await expect(page.getByTestId("ledger-list")).toContainText("扣费");
  await expect(page.getByTestId("ledger-list")).toContainText("TUTOR_ASK");
});
