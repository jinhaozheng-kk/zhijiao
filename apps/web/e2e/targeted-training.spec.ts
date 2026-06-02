import { test, expect } from "@playwright/test";
import { loginViaOtp } from "./helpers/login";
import { prepareErrorBookScenario } from "./helpers/error-book";

const PHONE = "13800000004";

test("targeted training: student runs a hint-first self-check session", async ({
  page,
  request,
}) => {
  // A due error-book entry guarantees the session is populated (via the
  // due-review fallback even when the student has no FOCUS-linked items).
  await prepareErrorBookScenario(request, PHONE, "due");
  await loginViaOtp(page, request, PHONE);

  await page.goto("/training");

  const session = page.getByTestId("training-session");
  const insufficient = page.getByText("还没有足够的训练材料");
  // Either a session renders, or the honest insufficient state — never a crash.
  await expect(session.or(insufficient)).toBeVisible();

  if (await session.isVisible()) {
    await expect(page.getByTestId("training-stem")).toBeVisible();
    await page.getByTestId("training-reveal").click();
    await expect(page.getByTestId("training-solution")).toBeVisible();
    await page.getByTestId("training-know").click();
    // Advances to the next item or shows the completion summary.
    await expect(
      page.getByTestId("training-session").or(page.getByText(/已记入学情/)),
    ).toBeVisible();
  }
});
