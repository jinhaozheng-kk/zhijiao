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
