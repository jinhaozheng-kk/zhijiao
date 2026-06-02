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
    page.getByRole("heading", { name: "教师工作台" }),
  ).toBeVisible();
  await page.goto(`/teacher/assignments/${ids.assignmentId}`);
  await expect(page.getByText("E2E Tiered Assignment")).toBeVisible();

  await loginViaOtp(page, request, "13800000001");
  await page.goto(`/assignments/${ids.studentAssignmentId}`);
  await expect(
    page.getByRole("heading", { name: "E2E Tiered Assignment" }),
  ).toBeVisible();
  await page.getByRole("textbox").fill("x = 4");
  await page.getByRole("button", { name: "提交作业" }).click();
  await page.waitForURL(`**/assignments/${ids.studentAssignmentId}/result`);
  await expect(page.getByText("待批改")).toBeVisible();

  await loginViaOtp(page, request, "13800000002");
  await page.goto(`/teacher/assignments/${ids.assignmentId}`);
  await page.getByLabel("反馈").fill("步骤完整。");
  await page.getByRole("button", { name: "保存批改" }).click();
  await expect(page.getByText("已批改 · 正确")).toBeVisible();

  await loginViaOtp(page, request, "13800000001");
  await page.goto(`/assignments/${ids.studentAssignmentId}/result`);
  await expect(page.getByText("已批改")).toBeVisible();
  await expect(page.getByText("步骤完整。")).toBeVisible();
});
