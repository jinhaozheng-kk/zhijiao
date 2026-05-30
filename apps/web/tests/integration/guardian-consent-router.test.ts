import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import Redis from "ioredis";
import { resetDb, prisma } from "@zhijiao/db/test-utils";
import type { Role } from "@zhijiao/domain";

// analytics.profile.mine pulls profileForStudent (pure prisma agg) — no AI needed.
// We still stub the ai-client in case any imported router references it at module load.
vi.mock("@/lib/ai-client", () => ({
  getAiRouter: () => ({}),
}));

const { appRouter } = await import("@/server/routers/_root");

const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379");

type Consent = "PENDING" | "GRANTED" | "NOT_REQUIRED";

function makeCtx(userId: string, guardianConsentStatus: Consent) {
  return {
    db: prisma,
    redis,
    auth: {
      userId,
      sessionId: "test-session",
      persona: "STUDENT" as const,
      roles: [] as Role[],
      isMinor: guardianConsentStatus !== "NOT_REQUIRED",
      guardianConsentStatus,
    },
    authError: null,
    ip: "127.0.0.1",
    ua: "vitest",
    requestId: "test-req-consent",
    resHeaders: new Headers(),
    cookies: {},
  };
}

beforeAll(async () => {
  await redis.flushdb();
});
beforeEach(async () => {
  await resetDb();
  await redis.flushdb();
});
afterAll(async () => {
  await redis.quit();
});

describe("guardian consent router gate", () => {
  it("PENDING user is blocked from a non-charged data read (analytics.profile.mine)", async () => {
    const student = await prisma.user.create({
      data: { isMinor: true, persona: "STUDENT", guardianConsentStatus: "PENDING" },
    });
    await expect(
      appRouter
        .createCaller(makeCtx(student.id, "PENDING"))
        .analytics.profile.mine({ window: "ALL" }),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      cause: { reason: "GUARDIAN_CONSENT_REQUIRED" },
    });
  });

  it("whitelist: auth.me resolves for a PENDING user", async () => {
    const student = await prisma.user.create({
      data: { isMinor: true, persona: "STUDENT", guardianConsentStatus: "PENDING" },
    });
    const r = await appRouter.createCaller(makeCtx(student.id, "PENDING")).auth.me();
    expect(r.user.id).toBe(student.id);
  });

  it("whitelist: family.createInviteCode resolves for a PENDING user", async () => {
    const student = await prisma.user.create({
      data: { isMinor: true, persona: "STUDENT", guardianConsentStatus: "PENDING" },
    });
    const r = await appRouter
      .createCaller(makeCtx(student.id, "PENDING"))
      .family.createInviteCode();
    expect(typeof r.code).toBe("string");
    expect(r.code.length).toBeGreaterThan(0);
  });

  it("GRANTED user passes the gate on the same read", async () => {
    const student = await prisma.user.create({
      data: { isMinor: true, persona: "STUDENT", guardianConsentStatus: "GRANTED" },
    });
    // No GUARDIAN_CONSENT_REQUIRED — read resolves (empty profile is fine).
    const r = await appRouter
      .createCaller(makeCtx(student.id, "GRANTED"))
      .analytics.profile.mine({ window: "ALL" });
    expect(r.relationship).toBe("self");
  });
});
