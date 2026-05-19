import { test, expect } from "@playwright/test";

test("新用户：登录 → 注册 → 进 tutor 问一道题", async ({ page, request }) => {
  // 用一个本测试专用的新号码，避免和 seed 冲突
  const phone = `1380000${String(Math.floor(Math.random() * 9000) + 1000)}`;

  await page.goto("/login");
  await page.getByTestId("login-phone").fill(phone);
  await page.getByTestId("login-send").click();

  await page.waitForURL("**/otp-verify**");
  const res = await request.get(`/api/e2e-hooks/last-otp?phone=${phone}`);
  const { code } = await res.json();
  expect(code).toMatch(/^\d{6}$/);

  await page.getByTestId("otp-code").fill(code);
  await page.getByTestId("otp-submit").click();

  await page.waitForURL("**/register");
  await page.getByTestId("persona-STUDENT").click();
  await page.getByTestId("grade-picker").selectOption("G8");
  await page.getByTestId("register-submit").click();

  await page.waitForURL((u) => u.pathname === "/");
  await page.goto("/tutor");
  await page.getByTestId("tutor-input").fill("计算 12 + 7");
  await page.getByTestId("tutor-submit").click();
  await expect(page.getByTestId("tutor-output")).toBeVisible({ timeout: 15_000 });
});
