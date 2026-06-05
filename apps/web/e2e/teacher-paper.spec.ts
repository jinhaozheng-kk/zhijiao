import { expect, test } from "@playwright/test";
import { loginViaOtp } from "./helpers/login";

test("teacher paper generation: create, preview, and open print page", async ({
  page,
  request,
}) => {
  await loginViaOtp(page, request, "13800000002");

  await page.goto("/teacher/papers/new");
  await expect(page.getByRole("heading", { name: "新建试卷" })).toBeVisible();
  await page.getByTestId("generate-submit").click();

  await page.waitForURL(/\/teacher\/papers\/[^/]+$/);
  await expect(page.getByRole("heading", { name: "试卷预览" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "双向细目表" })).toBeVisible();
  await expect(page.getByText("答案解析").first()).toBeVisible();

  await page.getByRole("link", { name: "打印/导出" }).click();
  await page.waitForURL(/\/teacher\/papers\/[^/]+\/print$/);
  await expect(page.getByRole("heading", { name: "打印试卷" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "答案解析" })).toBeVisible();
});
