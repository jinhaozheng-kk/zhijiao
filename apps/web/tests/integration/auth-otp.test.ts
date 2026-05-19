import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import Redis from "ioredis";
import { resetDb, prisma } from "@zhijiao/db/test-utils";
import { seedTestUsers } from "@zhijiao/db";
import { appRouter } from "@/server/routers/_root";
import { sharedTestSmsAdapter } from "@zhijiao/integrations";

process.env.SMS_USE_MOCK = "true";
(process.env as { NODE_ENV: string }).NODE_ENV = "test";
process.env.ACCESS_JWT_SECRET = "test-secret-at-least-32-bytes-long-aaaa";
process.env.OTP_PEPPER = "test-pepper";

const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379");

const createCaller = appRouter.createCaller;

function makeCtx() {
  const resHeaders = new Headers();
  return {
    db: prisma, redis,
    auth: null, authError: "NO_SESSION" as const,
    ip: "1.2.3.4", ua: "vitest", resHeaders, cookies: {},
  };
}

beforeAll(async () => { await redis.flushdb(); });
beforeEach(async () => { await resetDb(); await redis.flushdb(); sharedTestSmsAdapter.reset(); });
afterAll(async () => { await redis.quit(); });

describe("auth.otpRequest + otpVerify", () => {
  it("新手机号：otpRequest → otpVerify → need_register + set register cookie", async () => {
    const ctx = makeCtx();
    const caller = createCaller(ctx);
    await caller.auth.otpRequest({ phone: "13800009999" });
    const code = sharedTestSmsAdapter.latestCode("13800009999");
    expect(code).toMatch(/^\d{6}$/);
    const r = await caller.auth.otpVerify({ phone: "13800009999", code: code! });
    expect(r.status).toBe("need_register");
    const setCookies = ctx.resHeaders.getSetCookie();
    expect(setCookies.some((c) => c.startsWith("__Host-zj_register_token="))).toBe(true);
  });

  it("已注册手机号（seed 的 13800000001）：直接 logged_in + 颁发 cookie", async () => {
    await seedTestUsers(prisma);
    const ctx = makeCtx();
    const caller = createCaller(ctx);
    await caller.auth.otpRequest({ phone: "13800000001" });
    const code = sharedTestSmsAdapter.latestCode("13800000001")!;
    const r = await caller.auth.otpVerify({ phone: "13800000001", code });
    expect(r.status).toBe("logged_in");
    const setCookies = ctx.resHeaders.getSetCookie();
    expect(setCookies.some((c) => c.startsWith("__Host-zj_at="))).toBe(true);
    expect(setCookies.some((c) => c.startsWith("zj_rt="))).toBe(true);
  });

  it("错码 → OTP_INVALID", async () => {
    const ctx = makeCtx();
    const caller = createCaller(ctx);
    await caller.auth.otpRequest({ phone: "13800009999" });
    await expect(caller.auth.otpVerify({ phone: "13800009999", code: "000000" }))
      .rejects.toMatchObject({ cause: { reason: "OTP_INVALID" } });
  });
});
