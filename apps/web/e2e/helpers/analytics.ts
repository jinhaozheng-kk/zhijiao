import { expect, type APIRequestContext } from "@playwright/test";

export type E2eAnalyticsSeed = {
  studentUserId: string;
  focusKp: string;
  solidKp: string;
};

export async function prepareAnalyticsPortrait(
  request: APIRequestContext,
  phone: string,
): Promise<E2eAnalyticsSeed> {
  const res = await request.post("/api/e2e-hooks/analytics", { data: { phone } });
  expect(res.ok()).toBeTruthy();
  return (await res.json()) as E2eAnalyticsSeed;
}
