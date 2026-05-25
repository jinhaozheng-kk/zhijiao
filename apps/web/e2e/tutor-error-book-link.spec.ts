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

// Plan 8 hotfix (P2 #1 from review): TutorForm 的 ErrorAnalysisCard 必须带
// key={data.questionId}。submit 第二道题后卡片应回到空 CTA 态，不能保留 A 题的
// rootCause / "查看错题详情" 链接。
test("submitting a different question remounts the card (no stale A analysis)", async ({ page, request }) => {
  await loginViaOtp(page, request, PHONE);
  await page.goto("/tutor");

  // 第一题 A：提交 + 诊断 → 出 result 卡 + entry link
  await page.getByTestId("tutor-input").fill("E2E switch-A 2x + 5 = 13");
  await page.getByTestId("tutor-submit").click();
  await expect(page.getByTestId("tutor-output")).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("btn-diagnose").click();
  await expect(page.getByTestId("error-analysis-card-result")).toBeVisible({ timeout: 30_000 });
  const aLink = await page.getByTestId("error-analysis-entry-link").getAttribute("href");
  expect(aLink).toMatch(/\/error-book\/[^/]+$/);

  // 第二题 B：换题再提交。key 触发卡片 remount → 空 CTA 态（B 没诊断过）
  await page.getByTestId("tutor-input").fill("E2E switch-B 3x - 7 = 14");
  await page.getByTestId("tutor-submit").click();
  // tutor-output 会刷新到 B 的讲解；ErrorAnalysisCard 应回到 empty 卡
  await expect(page.getByTestId("error-analysis-card-empty")).toBeVisible({ timeout: 30_000 });
  // 关键：A 的 result 卡和 entry link 不应再出现
  await expect(page.getByTestId("error-analysis-card-result")).toHaveCount(0);
  await expect(page.getByTestId("error-analysis-entry-link")).toHaveCount(0);
});
