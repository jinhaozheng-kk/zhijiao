import { test, expect } from "@playwright/test";

test.describe("Tutor flow (mock AI)", () => {
  test("landing → tutor page → submit → see structured result", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "智教" })).toBeVisible();

    await page.getByTestId("cta-tutor").click();
    await expect(page).toHaveURL(/\/tutor$/);

    await page.getByTestId("input-stem").fill("解 2x + 5 = 13");
    await page.getByTestId("input-grade").selectOption("G8");
    await page.getByTestId("submit").click();

    const result = page.getByTestId("result");
    await expect(result).toBeVisible({ timeout: 10_000 });
    await expect(result).toContainText("题意重述");
    await expect(result).toContainText("涉及知识点");
    await expect(result).toContainText("分步思路");

    // 默认答案折叠，需点开
    await page.getByTestId("reveal-answer").click();
    await expect(page.getByTestId("final-answer")).toBeVisible();
  });

  test("empty input shows validation error", async ({ page }) => {
    await page.goto("/tutor");
    // Remove `required` to bypass HTML5 validation and force a server-side rejection
    await page.evaluate(() => {
      document.querySelector<HTMLTextAreaElement>('[data-testid="input-stem"]')!.removeAttribute("required");
    });
    await page.getByTestId("submit").click();
    await expect(page.getByTestId("error")).toBeVisible({ timeout: 5_000 });
  });
});
