import { test, expect } from "@playwright/test";
import { loginViaOtp } from "./helpers/login";

// dev-student-02; avoid tutor.spec (001) / error-book.spec (004) / wallet's existing users.
const PHONE = "13800000006";

test("tutor → ErrorAnalysisCard → /error-book/[entryId] with actualAnswer", async ({ page, request }) => {
  await loginViaOtp(page, request, PHONE);
  await page.goto("/tutor");

  await page.getByTestId("tutor-input").fill("E2E 解方程 2x + 5 = 13");
  // 展开"我的作答"折叠区 + 填作答
  await page.locator("details summary").click();
  await page.getByTestId("tutor-actual-answer").fill("x = 9");

  await page.getByTestId("tutor-submit").click();
  await expect(page.getByTestId("tutor-output")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("error-analysis-card-empty")).toBeVisible();

  // 点 ErrorAnalysisCard 触发 diagnose
  await page.getByTestId("btn-diagnose").click();
  await expect(page.getByTestId("error-analysis-card-result")).toBeVisible({ timeout: 30_000 });
  const entryLink = page.getByTestId("error-analysis-entry-link");
  await expect(entryLink).toBeVisible();

  // 跳详情页
  await entryLink.click();
  await page.waitForURL(/\/error-book\/[^/]+$/);
  await expect(page.getByTestId("entry-detail")).toBeVisible();
  await expect(page.getByTestId("entry-reasoning")).toBeVisible();

  // 展开"查看我当时的作答" + 验证作答内容
  await page.getByText("查看我当时的作答").click();
  await expect(page.getByText("x = 9")).toBeVisible();
});

test("tutor → ErrorAnalysisCard → /error-book/[entryId] without actualAnswer", async ({ page, request }) => {
  await loginViaOtp(page, request, PHONE);
  await page.goto("/tutor");

  // 不展开作答折叠区，直接填题目提交
  await page.getByTestId("tutor-input").fill("E2E 无作答 2x + 5 = 13");
  await page.getByTestId("tutor-submit").click();
  await expect(page.getByTestId("tutor-output")).toBeVisible({ timeout: 30_000 });

  await page.getByTestId("btn-diagnose").click();
  const entryLink = page.getByTestId("error-analysis-entry-link");
  await expect(entryLink).toBeVisible({ timeout: 30_000 });

  await entryLink.click();
  await page.waitForURL(/\/error-book\/[^/]+$/);
  await expect(page.getByTestId("entry-detail")).toBeVisible();

  // actualAnswerMd undefined → entry-detail.tsx 不渲染"查看我当时的作答" details
  await expect(page.getByText("查看我当时的作答")).toHaveCount(0);
});
