import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import Redis from "ioredis";
import { resetDb } from "@zhijiao/db/test-utils";
import { POST as refreshPOST } from "@/app/api/auth/refresh/route";

// env set centrally in apps/web/tests/setup.ts (Task 1). The route imports
// the shared redis singleton from @/lib/redis which uses env.REDIS_URL —
// same instance the test connects to here, so flushdb() in beforeEach
// reliably resets the ratelimit buckets. RULE_REFRESH: capacity=6, failMode=open.
const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379");

beforeAll(async () => { await redis.flushdb(); });
beforeEach(async () => { await resetDb(); await redis.flushdb(); });
afterAll(async () => { await redis.quit(); });

function reqFromIp(ip: string) {
  return new Request("http://localhost/api/auth/refresh", {
    method: "POST",
    headers: { "x-forwarded-for": ip },
  });
}

describe("/api/auth/refresh RULE_REFRESH (G1)", () => {
  it("同 IP 第 1..6 次未限频（cookie 缺 → 401 NO_SESSION）；第 7 次 429 REFRESH_TOO_FREQUENT + Retry-After", async () => {
    const ip = "8.8.8.8";

    // 限频闸门在 cookie 校验之前；前 6 次未触发限频 → 走到 cookie missing 返 401
    // 测试用 fake 缺 cookie 是有意为之——refresh token 单次轮换，无法在测试里
    // 用合法 token 反复打桶；这同时验证了"限频闸门在 cookie 校验之前"的顺序。
    for (let i = 0; i < 6; i++) {
      const res = await refreshPOST(reqFromIp(ip));
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.reason).toBe("NO_SESSION");
    }

    // 第 7 次：桶空 → 429
    const res = await refreshPOST(reqFromIp(ip));
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.reason).toBe("REFRESH_TOO_FREQUENT");
    expect(res.headers.get("Retry-After")).toBeTruthy();
  });

  it("限频按 IP 维度分桶（不同 IP 互不影响）", async () => {
    // 用尽 IP_A 的 6 个 token
    for (let i = 0; i < 7; i++) await refreshPOST(reqFromIp("7.7.7.7"));

    // IP_B 第一次：桶满，仍应是 401 NO_SESSION（不是 429）
    const res = await refreshPOST(reqFromIp("6.6.6.6"));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.reason).toBe("NO_SESSION");
  });

  it("无 x-forwarded-for header 时 fallback 到 'unknown' 桶", async () => {
    const reqNoIp = () => new Request("http://localhost/api/auth/refresh", { method: "POST" });

    // 前 6 次：401 NO_SESSION（限频未挡）
    for (let i = 0; i < 6; i++) {
      const res = await refreshPOST(reqNoIp());
      expect(res.status).toBe(401);
    }
    // 第 7 次：429
    const res = await refreshPOST(reqNoIp());
    expect(res.status).toBe(429);
  });
});
