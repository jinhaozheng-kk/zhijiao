import { test, expect } from "@playwright/test";
import { loginViaOtp } from "./helpers/login";

// Unique seeded phone (dev-admin-01, persona STUDENT, 100 credits) so this
// spec never shares an OTP code with another parallel worker — see the
// collision warning in helpers/login.ts. Mock storage + mock AI make the
// upload→transcribe→tutor round-trip deterministic under E2E_TEST_HOOKS.
const PHONE = "13800000005";
const PNG_1x1 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

test("image tutor: upload a photo and get an explanation + editable transcript", async ({
  page,
  request,
}) => {
  await loginViaOtp(page, request, PHONE);
  await page.goto("/tutor");

  await page.getByTestId("tutor-image-input").setInputFiles({
    name: "q.png",
    mimeType: "image/png",
    buffer: Buffer.from(PNG_1x1, "base64"),
  });

  await expect(page.getByTestId("tutor-output")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("tutor-transcript")).toBeVisible();
  // The transcript is editable so the student can fix OCR slips and re-ask.
  await expect(page.getByTestId("tutor-image-correct")).toBeVisible();
});
