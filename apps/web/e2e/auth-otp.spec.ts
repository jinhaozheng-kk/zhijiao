import { test, expect } from "@playwright/test";

test("新用户：登录 → 注册 → 落到学生首页", async ({ page, request }) => {
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
  // Plan 14a: STUDENT 注册必填出生年份，否则提交按钮禁用。用成年年份避免触发
  // <14 监护人同意门禁（本测试只验证落到学生首页）。
  await page.getByTestId("register-birthyear").fill("2005");
  await page.getByTestId("register-submit").click();

  // After register the user lands on / (student home). Asking the tutor
  // here was historically the smoke check, but Plan 3's chargedProcedure
  // requires a positive balance and brand-new users start at 0 credits —
  // verifying the recharge flow is now tutor-with-credit.spec.ts.
  await page.waitForURL((u) => u.pathname === "/");
});
