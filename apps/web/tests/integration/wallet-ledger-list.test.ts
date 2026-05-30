import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import Redis from "ioredis";
import { resetDb, prisma } from "@zhijiao/db/test-utils";
import { appRouter } from "@/server/routers/_root";

const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379");

function makeCtx(userId: string) {
  return {
    db: prisma,
    redis,
    auth: {
      userId,
      sessionId: "test-session",
      persona: "STUDENT" as const,
      roles: [] as import("@zhijiao/domain").Role[],
      isMinor: false,
      guardianConsentStatus: "NOT_REQUIRED" as const,
    },
    authError: null,
    ip: "127.0.0.1",
    ua: "vitest",
    requestId: "test-req-ledger",
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

describe("wallet.ledgerList pagination", () => {
  it("empty wallet: empty entries + null nextCursor", async () => {
    const u = await prisma.user.create({ data: { isMinor: false } });
    const caller = appRouter.createCaller(makeCtx(u.id));
    const r = await caller.wallet.ledgerList({ limit: 20 });
    expect(r.entries).toHaveLength(0);
    expect(r.nextCursor).toBeNull();
  });

  it("30 entries, limit=20: returns 20 + nextCursor; cursor fetches remaining 10 with nextCursor=null", async () => {
    const u = await prisma.user.create({ data: { isMinor: false } });
    const w = await prisma.wallet.create({
      data: { userId: u.id, balance: 30 },
    });
    // Seed 30 ledger entries with monotonic createdAt so order is deterministic.
    const base = Date.now();
    for (let i = 0; i < 30; i++) {
      await prisma.creditLedger.create({
        data: {
          walletId: w.id,
          kind: "TOPUP",
          delta: 1,
          balanceAfter: i + 1,
          idemKey: `topup:seed:${u.id}:${i}`,
          createdAt: new Date(base + i),
        },
      });
    }
    const caller = appRouter.createCaller(makeCtx(u.id));
    const first = await caller.wallet.ledgerList({ limit: 20 });
    expect(first.entries).toHaveLength(20);
    expect(first.nextCursor).not.toBeNull();
    // Newest first
    expect(first.entries[0]!.balanceAfter).toBe(30);

    const second = await caller.wallet.ledgerList({
      limit: 20,
      cursor: first.nextCursor!,
    });
    expect(second.entries).toHaveLength(10);
    expect(second.nextCursor).toBeNull();
    // The page boundary should not skip or duplicate entries
    expect(second.entries[0]!.balanceAfter).toBe(10);
  });

  it("rejects limit > 50 (zod input bound)", async () => {
    const u = await prisma.user.create({ data: { isMinor: false } });
    const caller = appRouter.createCaller(makeCtx(u.id));
    await expect(
      caller.wallet.ledgerList({ limit: 51 }),
    ).rejects.toThrow();
  });

  it("scoped to caller's wallet (cannot see another user's ledger)", async () => {
    const u1 = await prisma.user.create({ data: { isMinor: false } });
    const u2 = await prisma.user.create({ data: { isMinor: false } });
    const w2 = await prisma.wallet.create({
      data: { userId: u2.id, balance: 5 },
    });
    await prisma.creditLedger.create({
      data: {
        walletId: w2.id,
        kind: "TOPUP",
        delta: 5,
        balanceAfter: 5,
        idemKey: `topup:seed:${u2.id}`,
      },
    });
    const caller = appRouter.createCaller(makeCtx(u1.id));
    const r = await caller.wallet.ledgerList({ limit: 20 });
    expect(r.entries).toHaveLength(0);
  });
});
