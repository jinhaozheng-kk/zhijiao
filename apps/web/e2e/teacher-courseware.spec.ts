import { expect, test } from "@playwright/test";
import { loginViaOtp } from "./helpers/login";

test("teacher courseware generation: create, preview five sections, edit, mark ready, print", async ({
  page,
  request,
}) => {
  await loginViaOtp(page, request, "13800000002");

  await page.goto("/teacher/coursewares/new");
  await expect(page.getByRole("heading", { name: "新建课件" })).toBeVisible();
  await page.getByTestId("generate-submit").click();

  await page.waitForURL(/\/teacher\/coursewares\/[^/]+$/);
  await expect(page.getByRole("heading", { name: "课件预览" })).toBeVisible();

  // 五段结构齐全
  await expect(page.getByTestId("section-INTRO")).toBeVisible();
  await expect(page.getByTestId("section-EXPLANATION")).toBeVisible();
  await expect(page.getByTestId("section-EXAMPLE")).toBeVisible();
  await expect(page.getByTestId("section-PITFALL")).toBeVisible();
  await expect(page.getByTestId("section-EXERCISE")).toBeVisible();

  // 编辑导入段
  await page.getByTestId("section-INTRO").getByRole("button", { name: "编辑" }).click();
  await page.getByTestId("section-textarea-INTRO").fill("课堂导入：用一个生活情境引入。");
  await page.getByTestId("section-INTRO").getByRole("button", { name: "保存" }).click();
  await expect(page.getByText("课堂导入：用一个生活情境引入。")).toBeVisible();

  // 确认完成
  await page.getByRole("button", { name: "确认完成" }).click();
  await expect(page.getByRole("button", { name: "已确认完成" })).toBeVisible();

  // 打印页
  await page.getByRole("link", { name: "打印 / 导出" }).click();
  await page.waitForURL(/\/teacher\/coursewares\/[^/]+\/print$/);
  await expect(page.getByRole("heading", { name: "打印课件" })).toBeVisible();
});
