import type { Page, APIRequestContext } from "@playwright/test";

export async function loginViaOtp(page: Page, request: APIRequestContext, phone: string) {
  await page.goto("/login");
  await page.getByTestId("login-phone").fill(phone);
  await page.getByTestId("login-send").click();
  await page.waitForURL("**/otp-verify**");
  const r = await request.get(`/api/e2e-hooks/last-otp?phone=${phone}`);
  const { code } = await r.json();
  await page.getByTestId("otp-code").fill(code);
  await page.getByTestId("otp-submit").click();
  await page.waitForURL((u) => u.pathname === "/" || u.pathname === "/teacher" || u.pathname === "/parent");
}
