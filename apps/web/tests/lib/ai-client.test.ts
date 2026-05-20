// Plan 2 Hardening — Task 2 (C2 for apps/web/lib/ai-client.ts): AI_USE_MOCK="true"
// is the ONLY path into MockAdapter. Missing DASHSCOPE_API_KEY when
// AI_USE_MOCK="false" must NOT silently downgrade to the mock — the env
// validator (Task 1) is responsible for catching that combination at boot;
// ai-client.ts itself trusts env and lets DashScopeAdapter throw if the key
// is somehow missing past the validator.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ORIGINAL = {
  DASHSCOPE_API_KEY: process.env.DASHSCOPE_API_KEY,
  DASHSCOPE_BASE_URL: process.env.DASHSCOPE_BASE_URL,
};

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.doUnmock("@/server/env");
  vi.resetModules();
  // Restore DASHSCOPE_* in case a case mutated process.env.
  if (ORIGINAL.DASHSCOPE_API_KEY === undefined) delete process.env.DASHSCOPE_API_KEY;
  else process.env.DASHSCOPE_API_KEY = ORIGINAL.DASHSCOPE_API_KEY;
  if (ORIGINAL.DASHSCOPE_BASE_URL === undefined) delete process.env.DASHSCOPE_BASE_URL;
  else process.env.DASHSCOPE_BASE_URL = ORIGINAL.DASHSCOPE_BASE_URL;
});

async function importAiClient(envOverride: { AI_USE_MOCK: "true" | "false" }) {
  vi.doMock("@/server/env", () => ({ env: envOverride }));
  return import("@/lib/ai-client");
}

describe("ai-client buildAdapter (Task 2: no silent mock fallback)", () => {
  it("AI_USE_MOCK='true' → MockAdapter", async () => {
    const m = await importAiClient({ AI_USE_MOCK: "true" });
    const adapter = m.buildAdapter();
    expect(adapter.constructor.name).toBe("MockAdapter");
  });

  it("AI_USE_MOCK='false' + DASHSCOPE_API_KEY set → DashScopeAdapter (NOT Mock)", async () => {
    process.env.DASHSCOPE_API_KEY = "sk-fake-for-construction-only";
    const m = await importAiClient({ AI_USE_MOCK: "false" });
    const adapter = m.buildAdapter();
    expect(adapter.constructor.name).toBe("DashScopeAdapter");
    expect(adapter.constructor.name).not.toBe("MockAdapter");
  });

  it("AI_USE_MOCK='false' + DASHSCOPE_API_KEY missing → throws (no silent mock downgrade)", async () => {
    // The env validator should have caught this at boot, but ai-client.ts
    // must not paper over it with a Mock if the validator was somehow bypassed.
    delete process.env.DASHSCOPE_API_KEY;
    const m = await importAiClient({ AI_USE_MOCK: "false" });
    expect(() => m.buildAdapter()).toThrow(/DASHSCOPE_API_KEY/);
  });
});
