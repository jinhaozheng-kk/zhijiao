import { test, expect } from "@playwright/test";
import { loginViaOtp } from "./helpers/login";

// Plan 14a：<14 监护人同意硬门禁闭环。
// dev-student-05（birthYear 2015 → PENDING）发码；dev-parent-03 勾选同意绑定后解禁。
// 专用账号避免与其它 spec 抢 OTP 状态（pre-existing OTP burst flake，红线 #28）。
const CHILD_PHONE = "13800000010";
const PARENT_PHONE = "13800000011";

test("<14 学生被门禁 → 监护人同意 → 解禁闭环", async ({ page, request, browser }) => {
  // 1) <14 学生登录后访问受保护页 → 客户端跳转到 /guardian-consent（门禁）。
  await loginViaOtp(page, request, CHILD_PHONE);
  await page.goto("/portrait");
  await page.waitForURL("**/guardian-consent", { timeout: 15_000 });

  // 2) 发监护人邀请码。
  await page.getByTestId("btn-create-consent-code").click();
  const codeBlock = page.getByTestId("consent-code");
  await expect(codeBlock).toBeVisible();
  const match = (await codeBlock.innerText()).match(/[A-Za-z0-9_-]{8}/);
  expect(match, "未能从页面解析出邀请码").not.toBeNull();
  const code = match![0];

  // 3) 监护人（PARENT 账号）在独立 context 绑定：未勾选同意 → 失败；勾选后 → 成功。
  const parentCtx = await browser.newContext();
  const parentPage = await parentCtx.newPage();
  await loginViaOtp(parentPage, request, PARENT_PHONE);
  await parentPage.goto("/parent");
  await parentPage.getByTestId("input-invite-code").fill(code);

  // 未勾选同意 → GUARDIAN_CONSENT_NOT_PROVIDED
  await parentPage.getByTestId("btn-bind").click();
  await expect(parentPage.getByTestId("bind-error")).toBeVisible();

  // 勾选监护人同意后再绑定 → 成功
  await parentPage.getByTestId("guardian-consent-checkbox").check();
  await parentPage.getByTestId("btn-bind").click();
  await expect(parentPage.getByTestId("children-list")).toContainText("测试学生 05");
  await parentCtx.close();

  // 4) 学生重新访问受保护页 → 已 GRANTED，不再被跳转。
  await page.goto("/portrait");
  await expect(page).toHaveURL(/\/portrait/, { timeout: 15_000 });
  await expect(page).not.toHaveURL(/\/guardian-consent/);
});
