import { expect, test } from "@playwright/test";

test("demo center shows three role entries", async ({ page }) => {
  await page.goto("/demo");

  await expect(page.getByRole("heading", { name: "智教演示中心" })).toBeVisible();
  await expect(page.getByRole("link", { name: /学生体验/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /教师体验/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /家长体验/ })).toBeVisible();
});

test("student demo opens tutoring path", async ({ page }) => {
  await page.goto("/demo");
  await page.getByRole("link", { name: /学生体验/ }).click();

  await expect(page).toHaveURL(/\/tutor/);
  await expect(page.getByRole("heading", { name: /AI 答疑/ })).toBeVisible();
  await expect(page.getByTestId("tutor-input")).toContainText(/一次函数/);
});

test("teacher demo opens class workspace and shows next-stage AI cards", async ({ page }) => {
  await page.goto("/demo");
  await page.getByRole("link", { name: /教师体验/ }).click();

  await expect(page).toHaveURL(/\/teacher\/classes\//);
  await expect(page.getByRole("heading", { name: /初二 3 班/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: "AI 出卷" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "AI 课件" })).toBeVisible();
  await expect(page.getByRole("link", { name: /生成分层作业/ })).toBeVisible();
});

test("parent demo opens calm learning portrait", async ({ page }) => {
  await page.goto("/demo");
  await page.getByRole("link", { name: /家长体验/ }).click();

  await expect(page).toHaveURL(/\/parent/);
  await expect(page.getByRole("heading", { name: /家长/ })).toBeVisible();
  await expect(page.getByText("掌握较稳")).toBeVisible();
  await expect(page.getByText("正在巩固")).toBeVisible();
  await expect(page.getByText("重点关注")).toBeVisible();
  await expect(page.getByText(/排名/)).toHaveCount(0);
});
