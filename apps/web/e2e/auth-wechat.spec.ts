import { test, expect } from "@playwright/test";

test("微信首次登录 → need_register → 完成注册", async ({ page }) => {
  await page.goto("/wechat/start");
  // Mock adapter 把 authorize URL 设成了 /auth/wechat/callback?code=mock-new-<ts>&state=...
  // 浏览器会自动一次性走完两步重定向
  await page.waitForURL("**/register**");
  await page.getByTestId("persona-STUDENT").click();
  await page.getByTestId("grade-picker").selectOption("G7");
  // Plan 14a: STUDENT 注册必填出生年份，否则提交按钮禁用。用成年年份避免触发
  // <14 监护人同意门禁（本测试只验证落到学生首页）。
  await page.getByTestId("register-birthyear").fill("2005");
  await page.getByTestId("register-submit").click();
  await page.waitForURL((u) => u.pathname === "/");
  await expect(page).toHaveURL(/\/$/);
});
