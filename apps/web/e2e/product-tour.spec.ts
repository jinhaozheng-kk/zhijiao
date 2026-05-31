import { test } from "@playwright/test";
import { loginViaOtp } from "./helpers/login";
import { prepareAnalyticsPortrait } from "./helpers/analytics";

// One-off guided tour: drive the real闭环 as student → teacher → parent and
// screenshot each step. Not an assertion test — it's a visual walkthrough.
// Run alone: pnpm.cmd --filter @zhijiao/web test:e2e -- e2e/product-tour.spec.ts

const STUDENT = "13800000001"; // dev-student-01, member of dev-classroom-math-g8-01
const TEACHER = "13800000002"; // dev-teacher-01
const PARENT = "13800000009"; // dev-parent-02
const CLASSROOM = "dev-classroom-math-g8-01";

const shot = (name: string) => ({ path: `tour-shots/${name}.png`, fullPage: true } as const);

test("product tour: student loop → teacher diagnosis → parent view", async ({
  page,
  request,
  browser,
}) => {
  test.setTimeout(180_000);

  // Seed mastery data for the student so /portrait and class diagnosis have content.
  await prepareAnalyticsPortrait(request, STUDENT);

  // ---------- STUDENT ----------
  await loginViaOtp(page, request, STUDENT);

  // 1) AI 答疑：结构化讲解（提示先行，非答案先行）
  await page.goto("/tutor");
  await page.getByTestId("tutor-input").fill("解一元一次方程 2x + 3 = 7，并说明每一步在做什么");
  await page.getByTestId("tutor-submit").click();
  await page.getByTestId("tutor-output").waitFor({ state: "visible", timeout: 30_000 });
  await page.screenshot(shot("01-tutor-answer"));

  // 2) 错因分析：点诊断，出 rootCause 卡
  await page.getByTestId("btn-diagnose").click();
  await page.getByTestId("error-analysis-card-result").waitFor({ state: "visible", timeout: 30_000 });
  await page.screenshot(shot("02-error-analysis"));

  // 3) 错题本详情：跟 entry link 进去
  await page.getByTestId("error-analysis-entry-link").click();
  await page.waitForURL(/\/error-book\/[^/]+$/);
  await page.getByTestId("entry-detail").waitFor({ state: "visible", timeout: 15_000 });
  await page.screenshot(shot("03-error-book-entry"));

  // 4) 举一反三：生成三阶变式 L1/L2/L3
  await page.getByTestId("btn-generate-variant").click();
  await page.getByTestId("variant-groups").waitFor({ state: "visible", timeout: 30_000 });
  await page.getByTestId("variant-groups").getByText("L3").waitFor({ state: "visible", timeout: 30_000 });
  await page.screenshot(shot("04-variants"));

  // 5) 错题本列表
  await page.goto("/error-book");
  await page.waitForLoadState("networkidle");
  await page.screenshot(shot("05-error-book-list"));

  // 6) 学情画像：知识点掌握度三档
  await page.goto("/portrait");
  await page.getByTestId("portrait-masteries").waitFor({ state: "visible", timeout: 15_000 });
  await page.screenshot(shot("06-portrait"));

  // 7) 付费 AI 学习建议
  await page.getByTestId("btn-generate-advice").click();
  await page.getByTestId("advice-result").waitFor({ state: "visible", timeout: 30_000 });
  await page.screenshot(shot("07-learning-advice"));

  // 8) 学生发码给家长
  await page.goto("/family-link");
  await page.getByTestId("btn-create-invite").click();
  const codeBlock = page.getByTestId("invite-code");
  await codeBlock.waitFor({ state: "visible", timeout: 15_000 });
  const code = ((await codeBlock.innerText()).match(/[A-Za-z0-9_-]{8}/) ?? [""])[0];
  await page.screenshot(shot("08-family-invite-code"));

  // ---------- TEACHER ----------
  const teacherCtx = await browser.newContext();
  const tPage = await teacherCtx.newPage();
  await loginViaOtp(tPage, request, TEACHER);
  await tPage.goto("/teacher");
  await tPage.waitForLoadState("networkidle");
  await tPage.screenshot({ path: "tour-shots/09-teacher-home.png", fullPage: true });

  await tPage.goto(`/teacher/classes/${CLASSROOM}`);
  // 班级学情诊断（client query）—— 等诊断块或空态出现
  await tPage
    .getByTestId("class-diagnosis")
    .or(tPage.getByTestId("class-diagnosis-empty"))
    .first()
    .waitFor({ state: "visible", timeout: 20_000 });
  await tPage.screenshot({ path: "tour-shots/10-teacher-class-diagnosis.png", fullPage: true });
  await teacherCtx.close();

  // ---------- PARENT ----------
  const parentCtx = await browser.newContext();
  const pPage = await parentCtx.newPage();
  await loginViaOtp(pPage, request, PARENT);
  await pPage.goto("/parent");
  await pPage.getByTestId("input-invite-code").fill(code);
  await pPage.getByTestId("btn-bind").click();
  await pPage.getByTestId("children-list").waitFor({ state: "visible", timeout: 15_000 });
  await pPage.screenshot({ path: "tour-shots/11-parent-children.png", fullPage: true });

  await pPage.getByTestId("children-list").getByRole("link", { name: "查看学情" }).first().click();
  await pPage.waitForURL("**/parent/children/**");
  await pPage
    .getByTestId("child-portrait")
    .or(pPage.getByTestId("child-empty"))
    .first()
    .waitFor({ state: "visible", timeout: 20_000 });
  await pPage.screenshot({ path: "tour-shots/12-parent-child-view.png", fullPage: true });
  await parentCtx.close();
});
