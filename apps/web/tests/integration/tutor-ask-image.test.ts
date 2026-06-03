import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import Redis from "ioredis";
import { prisma, resetDb } from "@zhijiao/db/test-utils";
import type { Role } from "@zhijiao/domain";
import { sharedMockStorageAdapter } from "@zhijiao/integrations";
import { appRouter } from "@/server/routers/_root";

const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379");

function makeCtx(userId: string) {
  return {
    db: prisma,
    redis,
    auth: {
      userId,
      sessionId: "s",
      persona: "STUDENT" as const,
      roles: [] as Role[],
      isMinor: false,
      guardianConsentStatus: "NOT_REQUIRED" as const,
    },
    authError: null,
    ip: "127.0.0.1",
    ua: "vitest",
    requestId: "req-img",
    resHeaders: new Headers(),
    cookies: {},
  };
}

async function seedFundedUser() {
  const id = randomUUID();
  await prisma.user.create({ data: { id, name: "s", persona: "STUDENT" } });
  await prisma.subject.upsert({
    where: { code: "math" },
    update: {},
    create: { code: "math", name: "数学" },
  });
  await prisma.wallet.create({ data: { userId: id, balance: 100 } });
  return id;
}

beforeEach(async () => {
  await resetDb();
});
afterAll(async () => {
  await prisma.$disconnect();
  redis.disconnect();
});

describe("tutor.askImage", () => {
  it("rejects a non-owner image key", async () => {
    const id = await seedFundedUser();
    const caller = appRouter.createCaller(makeCtx(id));
    await expect(
      caller.tutor.askImage({
        imageKey: `adhoc/${randomUUID()}/x.png`,
        clientRequestId: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("transcribes, charges 2 credits, and persists a USER_ADHOC question with the image key", async () => {
    const id = await seedFundedUser();
    const key = `adhoc/${id}/${randomUUID()}.png`;
    await sharedMockStorageAdapter.put(key, new Uint8Array([1, 2, 3]), "image/png");
    const caller = appRouter.createCaller(makeCtx(id));
    const out = await caller.tutor.askImage({
      imageKey: key,
      studentGrade: "G8",
      clientRequestId: randomUUID(),
    });
    expect(out.stemTranscript.length).toBeGreaterThan(0);
    expect(out.questionId).toBeTruthy();

    const q = await prisma.question.findUniqueOrThrow({ where: { id: out.questionId } });
    expect(q.stemImageKeys).toContain(key);
    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: id } });
    expect(wallet.balance).toBe(98); // 100 - 2
  });
});
