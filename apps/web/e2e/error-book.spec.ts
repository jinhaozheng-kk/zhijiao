import { test, expect, type Page } from "@playwright/test";
import { loginViaOtp } from "./helpers/login";
import {
  prepareErrorBookScenario,
  readErrorBookState,
} from "./helpers/error-book";

const PHONE = "13800000004";

async function diagnoseFromBrowser(page: Page, questionId: string) {
  const result = await page.evaluate(async (qid) => {
    const res = await fetch("/api/trpc/error.diagnose?batch=1", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        0: {
          json: {
            questionId: qid,
            actualAnswerMd: "x = 5",
            clientRequestId: crypto.randomUUID(),
          },
        },
      }),
    });
    return { ok: res.ok, status: res.status, body: await res.text() };
  }, questionId);

  expect(result.ok, result.body).toBeTruthy();
  const parsed = JSON.parse(result.body) as Array<{
    result?: { data?: { json?: { entryId?: string } } };
  }>;
  const entryId = parsed[0]?.result?.data?.json?.entryId;
  expect(entryId).toBeTruthy();
  return entryId!;
}

test("diagnose entry can be opened, generated into variants, reviewed, archived, unarchived, and removed", async ({
  page,
  request,
}) => {
  const seed = await prepareErrorBookScenario(request, PHONE, "empty");
  await loginViaOtp(page, request, PHONE);

  const entryId = await diagnoseFromBrowser(page, seed.questionId);

  await page.goto(`/error-book/${entryId}`);
  await expect(page.getByTestId("entry-detail")).toBeVisible();
  await expect(page.getByTestId("entry-reasoning")).toBeVisible();

  const beforeVariant = await readErrorBookState(request, PHONE);
  await page.getByTestId("btn-generate-variant").click();
  await expect(page.getByTestId("variant-groups")).toContainText("L1", {
    timeout: 15_000,
  });
  await expect(page.getByTestId("variant-groups")).toContainText("L2");
  await expect(page.getByTestId("variant-groups")).toContainText("L3");
  const afterVariant = await readErrorBookState(request, PHONE);
  expect(afterVariant.balance).toBe(beforeVariant.balance - 3);
  expect(afterVariant.entries.find((e) => e.id === entryId)?.variantGroupCount).toBe(1);

  await page.getByTestId("btn-mark-reviewed").click();
  await expect
    .poll(async () => (await readErrorBookState(request, PHONE)).entries.find((e) => e.id === entryId)?.reviewCount)
    .toBe(1);

  await page.getByTestId("btn-archive").click();
  await page.goto("/error-book");
  await expect(page.getByTestId(`entry-link-${entryId}`)).toHaveCount(0);
  await page.getByTestId("tab-archived").click();
  await expect(page.getByTestId(`entry-link-${entryId}`)).toBeVisible();

  await page.goto(`/error-book/${entryId}`);
  await page.getByTestId("btn-archive").click();
  await expect(page.getByTestId("btn-mark-reviewed")).toBeVisible();

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByTestId("btn-delete").click();
  await page.waitForURL("**/error-book");
  await expect(page.getByTestId(`entry-link-${entryId}`)).toHaveCount(0);

  // spec §5.3 / Blocker 2: DELETED 是终态 — 直接访问详情应统一返 NOT_FOUND
  // (no existence side-channel). UI 渲染 entry-not-found 区块，文案"未找到这道错题"。
  await page.goto(`/error-book/${entryId}`);
  await expect(page.getByTestId("entry-not-found")).toBeVisible();
});

test("review page renders due, future, and empty branches", async ({
  page,
  request,
}) => {
  const due = await prepareErrorBookScenario(request, PHONE, "due");
  await loginViaOtp(page, request, PHONE);

  await page.goto("/error-book/review");
  await expect(page.getByTestId("review-list")).toBeVisible();
  await expect(page.getByTestId(`review-link-${due.entries[0]!.id}`)).toBeVisible();

  await prepareErrorBookScenario(request, PHONE, "future");
  await page.goto("/error-book/review");
  await expect(page.getByTestId("review-empty-future")).toBeVisible();

  await prepareErrorBookScenario(request, PHONE, "empty");
  await page.goto("/error-book/review");
  await expect(page.getByTestId("review-empty-none")).toBeVisible();
});
