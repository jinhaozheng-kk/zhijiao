import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import Redis from "ioredis";
import { resetDb, prisma } from "@zhijiao/db/test-utils";
import { appRouter } from "@/server/routers/_root";
import { sharedTestSmsAdapter } from "@zhijiao/integrations";

(process.env as { NODE_ENV: string }).NODE_ENV = "test";
// env set centrally in apps/web/tests/setup.ts (Task 1).

const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379");
const createCaller = appRouter.createCaller;

function makeCtx(cookies: Record<string, string> = {}) {
  const resHeaders = new Headers();
  return {
    db: prisma, redis,
    auth: null, authError: "NO_SESSION" as const,
    ip: "1.1.1.1", ua: "v", requestId: "test-req-race", resHeaders, cookies,
  };
}

beforeAll(async () => { await redis.flushdb(); });
beforeEach(async () => { await resetDb(); await redis.flushdb(); sharedTestSmsAdapter.reset(); });
afterAll(async () => { await redis.quit(); });

async function startRegisterFlow(phone: string): Promise<string> {
  const ctx1 = makeCtx();
  const caller1 = createCaller(ctx1);
  await caller1.auth.otpRequest({ phone });
  const code = sharedTestSmsAdapter.latestCode(phone)!;
  await caller1.auth.otpVerify({ phone, code });
  const setCookies = ctx1.resHeaders.getSetCookie();
  const regCookie = setCookies.find((c) => c.startsWith("__Host-zj_register_token="))!;
  const nonce = decodeURIComponent(regCookie.split(";")[0]!.split("=")[1]!);
  return nonce;
}

describe("auth.register 红线 #1 race-safe", () => {
  it("同一 nonce 并发调 register 2 次 → 只 1 个 User；另一个 REGISTER_CONFLICT + 清 cookie", async () => {
    const phone = "13800007777";
    const nonce = await startRegisterFlow(phone);

    const callA = createCaller(makeCtx({ "__Host-zj_register_token": nonce }))
      .auth.register({ persona: "STUDENT", gradeLevel: "G8", birthYear: 2010 });
    const callB = createCaller(makeCtx({ "__Host-zj_register_token": nonce }))
      .auth.register({ persona: "STUDENT", gradeLevel: "G8", birthYear: 2010 });
    const results = await Promise.allSettled([callA, callB]);
    const ok = results.filter((r) => r.status === "fulfilled");
    const fail = results.filter((r) => r.status === "rejected");
    expect(ok.length).toBe(1);
    expect(fail.length).toBe(1);
    expect((fail[0] as PromiseRejectedResult).reason).toMatchObject({ cause: { reason: "REGISTER_CONFLICT" } });

    const users = await prisma.user.count();
    expect(users).toBe(1);
    const ids = await prisma.authIdentity.count({ where: { providerUserId: phone } });
    expect(ids).toBe(1);
  });

  it("缺 gradeLevel 表单错误不清 cookie（用户改完可重交）", async () => {
    const phone = "13800007778";
    const nonce = await startRegisterFlow(phone);

    const ctxBad = makeCtx({ "__Host-zj_register_token": nonce });
    await expect(createCaller(ctxBad).auth.register({ persona: "STUDENT" }))
      .rejects.toMatchObject({ cause: { reason: "REGISTER_GRADE_REQUIRED" } });
    expect(ctxBad.resHeaders.getSetCookie().some((c) => /Max-Age=0/.test(c))).toBe(false);

    // 改完字段重交应成功
    const ctxOk = makeCtx({ "__Host-zj_register_token": nonce });
    const r = await createCaller(ctxOk).auth.register({ persona: "STUDENT", gradeLevel: "G7", birthYear: 2010 });
    expect(r.user.persona).toBe("STUDENT");
  });
});
