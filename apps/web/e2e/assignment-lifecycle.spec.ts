import { expect, test } from "@playwright/test";
import { loginViaOtp } from "./helpers/login";

test("assignment lifecycle: student submits and teacher grades", async ({
  page,
  request,
}) => {
  const setup = await request.post("/api/e2e-hooks/assignment");
  expect(setup.ok()).toBeTruthy();
  const ids = (await setup.json()) as {
    assignmentId: string;
    studentAssignmentId: string;
  };

  await loginViaOtp(page, request, "13800000002");
  await page.goto("/teacher");
  await expect(
    page.getByRole("heading", { name: "Teacher Workspace" }),
  ).toBeVisible();
  await page.goto(`/teacher/assignments/${ids.assignmentId}`);
  await expect(page.getByText("E2E Tiered Assignment")).toBeVisible();

  await loginViaOtp(page, request, "13800000001");
  await page.goto(`/assignments/${ids.studentAssignmentId}`);
  await expect(
    page.getByRole("heading", { name: "E2E Tiered Assignment" }),
  ).toBeVisible();
  await page.getByRole("textbox").fill("x = 4");
  await page.getByRole("button", { name: "Submit Assignment" }).click();
  await page.waitForURL(`**/assignments/${ids.studentAssignmentId}/result`);
  await expect(page.getByText("SUBMITTED")).toBeVisible();

  await loginViaOtp(page, request, "13800000002");
  await page.goto(`/teacher/assignments/${ids.assignmentId}`);
  await page.getByLabel("Feedback").fill("Complete solution.");
  await page.getByRole("button", { name: "Save Grade" }).click();
  await expect(page.getByText("GRADED · CORRECT")).toBeVisible();

  await loginViaOtp(page, request, "13800000001");
  await page.goto(`/assignments/${ids.studentAssignmentId}/result`);
  await expect(page.getByText("GRADED")).toBeVisible();
  await expect(page.getByText("Complete solution.")).toBeVisible();
});
