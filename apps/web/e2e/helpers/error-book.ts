import { expect, type APIRequestContext } from "@playwright/test";

export type ErrorBookScenario = "empty" | "active" | "due" | "future";

export type E2eErrorBookEntry = {
  id: string;
  status: "ACTIVE" | "ARCHIVED" | "DELETED";
  reviewCount: number;
  variantGroupCount: number;
};

export type E2eErrorBookState = {
  questionId: string;
  balance: number;
  entries: E2eErrorBookEntry[];
};

export async function prepareErrorBookScenario(
  request: APIRequestContext,
  phone: string,
  scenario: ErrorBookScenario,
): Promise<E2eErrorBookState> {
  const res = await request.post("/api/e2e-hooks/error-book", {
    data: { phone, scenario },
  });
  expect(res.ok()).toBeTruthy();
  return (await res.json()) as E2eErrorBookState;
}

export async function readErrorBookState(
  request: APIRequestContext,
  phone: string,
): Promise<E2eErrorBookState> {
  const res = await request.get(
    `/api/e2e-hooks/error-book?phone=${encodeURIComponent(phone)}`,
  );
  expect(res.ok()).toBeTruthy();
  return (await res.json()) as E2eErrorBookState;
}
