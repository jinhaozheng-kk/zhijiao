import { test, type Page, type APIRequestContext } from "@playwright/test";

// OTP send is rate-limited per IP (RULE_OTP_SEND_IP: capacity 10, refill 1
// token / 6s) and fail-closed. The whole E2E suite logs in from 127.0.0.1, so
// a full parallel run drains the bucket and a single-shot send fails closed at
// /login (the form shows #login-error and never navigates to /otp-verify).
//
// Instead of hard-failing on the first rate-limit, retry the send with backoff
// matched to the refill interval. Each attempt re-navigates to /login so the
// page starts with a clean state (no stale #login-error from the prior try),
// then races "navigated to /otp-verify" (sent) against "#login-error visible"
// (rate-limited). Jittered backoff desynchronizes parallel workers so they
// don't keep re-colliding on the same refill tick.
const SEND_OUTCOME_TIMEOUT_MS = 8_000;
const REFILL_BACKOFF_MS = 6_500; // > RULE_OTP_SEND_IP refill interval (6s/token)
const MAX_SEND_ATTEMPTS = 8;

async function sendOtpWithRetry(page: Page, phone: string) {
  // Each retry waits ~one refill interval (6s) and that wait counts against the
  // test timeout. Under parallel contention a login-heavy test can need a few
  // retries, which blows the default 30s. Give the running test enough headroom
  // to wait out the worst case (MAX_SEND_ATTEMPTS backoffs) plus its own work.
  // setTimeout only raises the ceiling — fast logins finish well under it.
  test.setTimeout(MAX_SEND_ATTEMPTS * (SEND_OUTCOME_TIMEOUT_MS + REFILL_BACKOFF_MS + 1500) + 30_000);

  for (let attempt = 1; ; attempt++) {
    await page.goto("/login");
    await page.getByTestId("login-phone").fill(phone);
    await page.getByTestId("login-send").click();

    const outcome = await Promise.race([
      page
        .waitForURL("**/otp-verify**", { timeout: SEND_OUTCOME_TIMEOUT_MS })
        .then(() => "sent" as const)
        .catch(() => "timeout" as const),
      page
        .getByTestId("login-error")
        .waitFor({ state: "visible", timeout: SEND_OUTCOME_TIMEOUT_MS })
        .then(() => "rate-limited" as const)
        .catch(() => "timeout" as const),
    ]);
    if (outcome === "sent") return;
    if (attempt >= MAX_SEND_ATTEMPTS) {
      throw new Error(
        `loginViaOtp: OTP send still rate-limited after ${MAX_SEND_ATTEMPTS} attempts for ${phone}`,
      );
    }
    await page.waitForTimeout(REFILL_BACKOFF_MS + Math.floor(Math.random() * 1500));
  }
}

export async function loginViaOtp(page: Page, request: APIRequestContext, phone: string) {
  await sendOtpWithRetry(page, phone);
  const r = await request.get(`/api/e2e-hooks/last-otp?phone=${phone}`);
  const { code } = await r.json();
  await page.getByTestId("otp-code").fill(code);
  await page.getByTestId("otp-submit").click();
  await page.waitForURL((u) => u.pathname === "/" || u.pathname === "/teacher" || u.pathname === "/parent");
}
