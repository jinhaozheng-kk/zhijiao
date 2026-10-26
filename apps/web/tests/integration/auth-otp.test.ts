import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import Redis from "ioredis";
import { resetDb, prisma } from "@zhijiao/db/test-utils";
import { seedTestUsers } from "@zhijiao/db";
import { appRouter } from "@/server/routers/_root";
import { sharedTestSmsAdapter } from "@zhijiao/integrations";

(process.env as { NODE_ENV: string }).NODE_ENV = "test";
// env (DATABASE_URL / ACCESS_JWT_SECRET / OTP_PEPPER / *_USE_MOCK / NEXT_PUBLIC_APP_URL)
// is set by apps/web/tests/setup.ts (Task 1: env validator requires fail-close).

const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379");

const createCaller = appRouter.createCaller;

function makeCtx() {
  const resHeaders = new Headers();
  return {
    db: prisma, redis,
    auth: null, authError: "NO_SESSION" as const,
    ip: "1.2.3.4", ua: "vitest", requestId: "test-req-otp", resHeaders, cookies: {},
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

  it("非生产 mock 短信模式：返回 devCode 供本地登录页显示", async () => {
    const ctx = makeCtx();
    const caller = createCaller(ctx);
    const sent = await caller.auth.otpRequest({ phone: "13800008888" });
    expect(sent).toMatchObject({ ok: true, devCode: expect.stringMatching(/^\d{6}$/) });
    expect(sent.devCode).toBe(sharedTestSmsAdapter.latestCode("13800008888"));
  });

  it("生产环境：即使误开 mock 短信也不向客户端返回 devCode", async () => {
    const mutableEnv = process.env as Record<string, string | undefined>;
    const originalNodeEnv = process.env.NODE_ENV;
    const originalSmsUseMock = process.env.SMS_USE_MOCK;
    try {
      (process.env as { NODE_ENV: string }).NODE_ENV = "production";
      process.env.SMS_USE_MOCK = "true";
      const ctx = makeCtx();
      const caller = createCaller(ctx);
      const sent = await caller.auth.otpRequest({ phone: "13800007777" });
      expect(sent).toEqual({ ok: true });
    } finally {
      if (originalNodeEnv === undefined) delete mutableEnv.NODE_ENV;
      else mutableEnv.NODE_ENV = originalNodeEnv;
      if (originalSmsUseMock === undefined) delete mutableEnv.SMS_USE_MOCK;
      else mutableEnv.SMS_USE_MOCK = originalSmsUseMock;
    }
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

  it("已设置密码的手机号：passwordLogin 直接 logged_in + 颁发 cookie", async () => {
    await seedTestUsers(prisma);
    const ctx = makeCtx();
    const caller = createCaller(ctx);
    const r = await caller.auth.passwordLogin({ phone: "13800000002", password: "Teacher123!" });
    expect(r.status).toBe("logged_in");
    expect(r.defaultRoute).toBe("/teacher");
    const setCookies = ctx.resHeaders.getSetCookie();
    expect(setCookies.some((c) => c.startsWith("__Host-zj_at="))).toBe(true);
    expect(setCookies.some((c) => c.startsWith("zj_rt="))).toBe(true);
  });

  it("密码错误或未设置密码：passwordLogin 返回 INVALID_CREDENTIALS", async () => {
    await seedTestUsers(prisma);
    const ctx = makeCtx();
    const caller = createCaller(ctx);

    await expect(caller.auth.passwordLogin({ phone: "13800000002", password: "wrong-password" }))
      .rejects.toMatchObject({ cause: { reason: "INVALID_CREDENTIALS" } });
    await expect(caller.auth.passwordLogin({ phone: "13800009999", password: "Teacher123!" }))
      .rejects.toMatchObject({ cause: { reason: "INVALID_CREDENTIALS" } });
  });

  it("已登录用户：setPassword 后可用新密码登录", async () => {
    await seedTestUsers(prisma);
    const authCtx = {
      ...makeCtx(),
      auth: {
        userId: "dev-teacher-01",
        sessionId: "test-session",
        persona: "TEACHER" as const,
        roles: [],
        isMinor: false,
        guardianConsentStatus: "NOT_REQUIRED" as const,
      },
      authError: null,
    };
    await createCaller(authCtx).auth.setPassword({ password: "NewTeacher123!" });

    const loginCtx = makeCtx();
    const r = await createCaller(loginCtx).auth.passwordLogin({ phone: "13800000002", password: "NewTeacher123!" });
    expect(r.status).toBe("logged_in");
  });

  it("错码 → OTP_INVALID", async () => {
    const ctx = makeCtx();
    const caller = createCaller(ctx);
    await caller.auth.otpRequest({ phone: "13800009999" });
    await expect(caller.auth.otpVerify({ phone: "13800009999", code: "000000" }))
      .rejects.toMatchObject({ cause: { reason: "OTP_INVALID" } });
  });
});
