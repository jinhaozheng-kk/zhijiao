import { describe, it, expect } from "vitest";
import { InMemoryRateLimitStore } from "../src/ratelimit/in-memory-store.js";
import {
  RateLimitBackendDownError,
  type RateLimitStore,
} from "../src/ratelimit/types.js";
import {
  takeRule,
  RULE_TOPUP_CREATE_IP,
  RULE_TOPUP_CREATE_USER,
} from "../src/ratelimit/rules.js";

describe("RULE_TOPUP_CREATE_IP / RULE_TOPUP_CREATE_USER", () => {
  it("IP rule capacity = 5 — 6th in-window request is rejected", async () => {
    const store = new InMemoryRateLimitStore();
    const now = 1_000_000;
    let allowed = 0;
    for (let i = 0; i < 8; i++) {
      const d = await takeRule(store, RULE_TOPUP_CREATE_IP, "1.2.3.4", now);
      if (d.allowed) allowed++;
    }
    expect(allowed).toBe(5);
  });

  it("USER rule capacity = 10 — 11th in-window request is rejected", async () => {
    const store = new InMemoryRateLimitStore();
    const now = 1_000_000;
    let allowed = 0;
    for (let i = 0; i < 15; i++) {
      const d = await takeRule(store, RULE_TOPUP_CREATE_USER, "user-abc", now);
      if (d.allowed) allowed++;
    }
    expect(allowed).toBe(10);
  });

  it("IP and USER bucket keys are independent", async () => {
    const store = new InMemoryRateLimitStore();
    const now = 1_000_000;
    for (let i = 0; i < 5; i++) {
      await takeRule(store, RULE_TOPUP_CREATE_IP, "1.2.3.4", now);
    }
    // Same suffix, different rule prefix → independent bucket → still allowed.
    const d = await takeRule(store, RULE_TOPUP_CREATE_USER, "1.2.3.4", now);
    expect(d.allowed).toBe(true);
  });

  it("fail-CLOSE: backend throws RateLimitBackendDownError is re-thrown (not swallowed as allowed=true)", async () => {
    const broken: RateLimitStore = {
      async take(): Promise<never> {
        throw new RateLimitBackendDownError();
      },
    };
    await expect(
      takeRule(broken, RULE_TOPUP_CREATE_IP, "ip"),
    ).rejects.toBeInstanceOf(RateLimitBackendDownError);
    await expect(
      takeRule(broken, RULE_TOPUP_CREATE_USER, "user"),
    ).rejects.toBeInstanceOf(RateLimitBackendDownError);
  });

  it("rules are declared with failMode: 'close' (differs from RULE_REGISTER_IP / RULE_REFRESH which are fail-open)", () => {
    expect(RULE_TOPUP_CREATE_IP.failMode).toBe("close");
    expect(RULE_TOPUP_CREATE_USER.failMode).toBe("close");
  });
});
