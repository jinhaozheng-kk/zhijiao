import { test, expect } from "@playwright/test";
import { loginViaOtp } from "./helpers/login";
import { prepareAnalyticsPortrait } from "./helpers/analytics";

// dev-student-03 (13800000007) — not used by other specs.
const PHONE = "13800000007";

test("student sees mastery portrait with a FOCUS area and can generate AI advice", async ({
  page,
  request,
}) => {
  const seed = await prepareAnalyticsPortrait(request, PHONE);
  await loginViaOtp(page, request, PHONE);

  await page.goto("/portrait");

  const masteries = page.getByTestId("portrait-masteries");
  await expect(masteries).toBeVisible();
  // FOCUS KP (2 WRONG) renders as a sky-colored block and shows its name.
  await expect(masteries).toContainText(seed.focusKp);
  await expect(masteries.locator(".bg-sky-100").first()).toBeVisible();
  // SOLID KP (2 CORRECT) also shown.
  await expect(masteries).toContainText(seed.solidKp);

  // Paid AI advice (mock adapter in E2E server) — wallet seeded to 100.
  await page.getByTestId("btn-generate-advice").click();
  await expect(page.getByTestId("advice-result")).toBeVisible({ timeout: 15_000 });
});
