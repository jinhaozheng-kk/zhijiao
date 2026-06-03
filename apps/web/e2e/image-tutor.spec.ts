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

// The re-ask path (edit transcript → copy into stem → submit via the 1-credit
// text tutor.ask) is pure client orchestration and can't be reached by the
// integration tests, which own the server contracts (owner gate / 2-credit /
// stemImageKeys / upload validation). This is the one image-tutor behavior with
// no coverage elsewhere. Do NOT assert a numeric balance: 13800000005 is the
// shared admin user (not balance-isolated) and accumulates spend across runs.
test("image tutor: edit transcript and re-ask via the 1-credit text path", async ({
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
  const transcript = page.getByTestId("tutor-transcript");
  await expect(transcript).toBeVisible();

  // Correct an OCR slip, then re-ask by text.
  await transcript.fill("已知一次函数 y = 2x - 3，求它与 x 轴交点的横坐标。");
  await page.getByTestId("tutor-image-correct").click();

  // The text tutor.ask re-renders output; the edited stem lands in tutor-input,
  // and the image transcript block unmounts (ask.onSuccess sets data + clears
  // imageData, so `view = data ?? imageData` and the {imageData && …} block goes).
  await expect(page.getByTestId("tutor-output")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("tutor-input")).toHaveValue(/x 轴交点/);
  await expect(page.getByTestId("tutor-transcript")).toHaveCount(0);
});
