import { test, expect } from "@playwright/test";
import { loginViaOtp } from "./helpers/login";

// Dedicated accounts so parallel workers don't share OTP state with other specs.
// Student dev-student-04 issues a code; parent dev-parent-02 binds and views.
const STUDENT_PHONE = "13800000008";
const PARENT_PHONE = "13800000009";

test("student issues invite code, parent binds and views child, code is single-use", async ({
  page,
  request,
  browser,
}) => {
  // Student issues code.
  await loginViaOtp(page, request, STUDENT_PHONE);
  await page.goto("/family-link");
  await page.getByTestId("btn-create-invite").click();
  const codeBlock = page.getByTestId("invite-code");
  await expect(codeBlock).toBeVisible();
  const blockText = (await codeBlock.innerText()).trim();
  const match = blockText.match(/[A-Za-z0-9_-]{8}/);
  expect(match, `could not find code in: ${blockText}`).not.toBeNull();
  const code = match![0];

  // Parent binds in a separate context.
  const parentCtx = await browser.newContext();
  const parentPage = await parentCtx.newPage();
  await loginViaOtp(parentPage, request, PARENT_PHONE);
  await parentPage.goto("/parent");
  await parentPage.getByTestId("input-invite-code").fill(code);
  await parentPage.getByTestId("btn-bind").click();

  const childrenList = parentPage.getByTestId("children-list");
  await expect(childrenList).toContainText("测试学生 04");

  // Open child portrait (data may or may not exist → either testid is acceptable).
  await childrenList.getByRole("link", { name: "查看学情" }).first().click();
  await parentPage.waitForURL("**/parent/children/**");
  await expect(
    parentPage.getByTestId("child-portrait").or(parentPage.getByTestId("child-empty")),
  ).toBeVisible({ timeout: 15_000 });

  // Same code cannot be used again (single-use).
  await parentPage.goto("/parent");
  await parentPage.getByTestId("input-invite-code").fill(code);
  await parentPage.getByTestId("btn-bind").click();
  await expect(parentPage.getByTestId("bind-error")).toBeVisible();

  await parentCtx.close();
});
