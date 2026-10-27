import { expect, test } from "@playwright/test";
import { loginViaOtp } from "./helpers/login";

test("教师按题型出卷并查看统考版式学生卷/教师卷", async ({ page, request }) => {
  await loginViaOtp(page, request, "13800000002");

  await page.goto("/teacher/papers/new");
  await expect(page.getByRole("heading", { name: "新建试卷" })).toBeVisible();

  // Default active types: SINGLE_CHOICE + CALCULATION (already on; no toggle needed)
  // Set 3 × 3 for SINGLE_CHOICE, 2 × 8 for CALCULATION → total 25 points
  await page.getByTestId("count-SINGLE_CHOICE").fill("3");
  await page.getByTestId("points-SINGLE_CHOICE").fill("3");
  await page.getByTestId("count-CALCULATION").fill("2");
  await page.getByTestId("points-CALCULATION").fill("8");

  // Total: 3*3 + 2*8 = 9 + 16 = 25
  await expect(page.getByTestId("total-points")).toContainText("25");

  await page.getByTestId("generate-submit").click();

  // Wait for navigation to the paper preview page
  await page.waitForURL(/\/teacher\/papers\/[^/]+$/, { timeout: 60_000 });

  // Wait for the preview page content to load (paper.get tRPC query)
  await expect(page.getByRole("heading", { name: "试卷预览" })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("link", { name: "打印/导出" })).toBeVisible({ timeout: 15_000 });

  // Navigate to print page via the link (same as old test; avoids session context issues)
  await page.getByRole("link", { name: "打印/导出" }).click();
  await page.waitForURL(/\/teacher\/papers\/[^/]+\/print$/, { timeout: 15_000 });

  // Default variant is student — wait for data to load and container to appear
  await expect(page.getByTestId("paper-student")).toBeVisible({ timeout: 30_000 });

  // Student layout: section header for SINGLE_CHOICE
  await expect(page.getByText("一、选择题", { exact: false })).toBeVisible();

  // Student layout: objective answer grid ("选择题答题栏")
  await expect(page.getByText("选择题答题栏")).toBeVisible();

  // Student layout must NOT contain answer text
  await expect(page.getByTestId("paper-student")).not.toContainText("答案：");

  // Switch to teacher variant
  await page.getByTestId("variant-teacher").click();
  await expect(page.getByTestId("paper-teacher")).toBeVisible();
  await expect(page.getByTestId("paper-teacher")).toContainText("答案：");
  await expect(page.getByTestId("paper-teacher")).toContainText("解析：");
});

test("教师一键生成中考风格卷并打印学生/教师卷", async ({ page, request }) => {
  await loginViaOtp(page, request, "13800000002");

  await page.goto("/teacher/papers/new");
  await expect(page.getByTestId("kp-picker")).toBeVisible();
  await page.getByTestId("generate-zhongkao").click();

  await page.waitForURL(/\/teacher\/papers\/[^/]+$/, { timeout: 120_000 });
  await expect(page.getByTestId("zhongkao-blueprint")).toBeVisible({ timeout: 15_000 });

  // 一键卷落 DRAFT：教师先看审题提示，再「确认完成」（P0-02）
  await page.getByRole("button", { name: "确认完成" }).click();
  await expect(page.getByRole("button", { name: "已确认完成" })).toBeVisible();

  await page.getByRole("link", { name: "打印/导出" }).click();
  await page.waitForURL(/\/teacher\/papers\/[^/]+\/print$/, { timeout: 15_000 });

  await expect(page.getByTestId("paper-student")).toBeVisible({ timeout: 30_000 });
  // 浙江卷格式：试题卷带注意事项、无答案（不再有「选择题答题栏」）
  await expect(page.getByTestId("paper-student")).toContainText("注意事项");
  await expect(page.getByTestId("paper-student")).not.toContainText("答案：");
  await page.screenshot({ path: "output/playwright/zhongkao-student.png", fullPage: true });

  await page.getByTestId("variant-teacher").click();
  await expect(page.getByTestId("paper-teacher")).toBeVisible();
  await expect(page.getByTestId("paper-teacher")).toContainText("答案：");
  await expect(page.getByTestId("paper-teacher")).toContainText("来源：");
  await page.screenshot({ path: "output/playwright/zhongkao-teacher.png", fullPage: true });
});
