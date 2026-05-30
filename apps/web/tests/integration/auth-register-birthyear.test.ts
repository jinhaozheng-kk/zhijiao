import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import Redis from "ioredis";
import { resetDb, prisma } from "@zhijiao/db/test-utils";
import { appRouter } from "@/server/routers/_root";
import { sharedTestSmsAdapter } from "@zhijiao/integrations";

(process.env as { NODE_ENV: string }).NODE_ENV = "test";

const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379");
const createCaller = appRouter.createCaller;

function makeCtx(cookies: Record<string, string> = {}) {
  const resHeaders = new Headers();
  return {
    db: prisma, redis,
    auth: null, authError: "NO_SESSION" as const,
    ip: "1.1.1.2", ua: "v", requestId: "test-req-birthyear", resHeaders, cookies,
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
  return decodeURIComponent(regCookie.split(";")[0]!.split("=")[1]!);
}

describe("auth.register birthYear + guardianConsentStatus (Plan 14a)", () => {
  it("STUDENT <14（birthYear 2014）→ 注册成功，guardianConsentStatus=PENDING 且 birthYear 入库", async () => {
    const nonce = await startRegisterFlow("13800008001");
    const r = await createCaller(makeCtx({ "__Host-zj_register_token": nonce }))
      .auth.register({ persona: "STUDENT", gradeLevel: "G7", birthYear: 2014 });
    expect(r.user.persona).toBe("STUDENT");
    const user = await prisma.user.findFirstOrThrow();
    expect(user.guardianConsentStatus).toBe("PENDING");
    expect(user.birthYear).toBe(2014);
  });

  it("STUDENT ≥14（birthYear 2009）→ guardianConsentStatus=NOT_REQUIRED", async () => {
    const nonce = await startRegisterFlow("13800008002");
    await createCaller(makeCtx({ "__Host-zj_register_token": nonce }))
      .auth.register({ persona: "STUDENT", gradeLevel: "G9", birthYear: 2009 });
    const user = await prisma.user.findFirstOrThrow();
    expect(user.guardianConsentStatus).toBe("NOT_REQUIRED");
    expect(user.birthYear).toBe(2009);
  });

  it("STUDENT 缺 birthYear → BAD_REQUEST/REGISTER_BIRTHYEAR_REQUIRED，不清 cookie", async () => {
    const nonce = await startRegisterFlow("13800008003");
    const ctxBad = makeCtx({ "__Host-zj_register_token": nonce });
    await expect(createCaller(ctxBad).auth.register({ persona: "STUDENT", gradeLevel: "G7" }))
      .rejects.toMatchObject({ cause: { reason: "REGISTER_BIRTHYEAR_REQUIRED" } });
    expect(ctxBad.resHeaders.getSetCookie().some((c) => /Max-Age=0/.test(c))).toBe(false);
    // 改完重交成功
    const ctxOk = makeCtx({ "__Host-zj_register_token": nonce });
    const r = await createCaller(ctxOk).auth.register({ persona: "STUDENT", gradeLevel: "G7", birthYear: 2015 });
    expect(r.user.persona).toBe("STUDENT");
  });
});
