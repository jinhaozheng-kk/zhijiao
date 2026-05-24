import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { TRPCError } from "@trpc/server";
import { resetDb, prisma } from "@zhijiao/db/test-utils";
import {
  redis,
  makeCtx,
  seedTestSubjectAndQuestion,
  seedUserWithBalance,
  seedErrorBookEntry,
} from "./_helpers/error-book-fixtures";

const { appRouter } = await import("@/server/routers/_root");

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

describe("error.list", () => {
  it("default (no status) returns ACTIVE only (no ARCHIVED, no DELETED)", async () => {
    const { questionId } = await seedTestSubjectAndQuestion();
    const u = await seedUserWithBalance(0);

    const active = await seedErrorBookEntry({
      userId: u.id,
      questionId,
      status: "ACTIVE",
    });
    // ARCHIVED + DELETED need distinct questions because partial unique idx
    // would reject a second ACTIVE/ARCHIVED row for same (userId, questionId).
    const q2 = await prisma.question.create({
      data: {
        subjectId: (await prisma.subject.findFirstOrThrow()).id,
        stemMd: "另一道题 1",
        type: "CALCULATION",
        status: "PUBLISHED",
      },
    });
    const q3 = await prisma.question.create({
      data: {
        subjectId: (await prisma.subject.findFirstOrThrow()).id,
        stemMd: "另一道题 2",
        type: "CALCULATION",
        status: "PUBLISHED",
      },
    });
    await seedErrorBookEntry({ userId: u.id, questionId: q2.id, status: "ARCHIVED" });
    await seedErrorBookEntry({ userId: u.id, questionId: q3.id, status: "DELETED" });

    const caller = appRouter.createCaller(makeCtx(u.id));
    const { entries, nextCursor } = await caller.error.list({ limit: 50 });

    expect(entries).toHaveLength(1);
    expect(entries[0]!.id).toBe(active.id);
    expect(entries[0]!.status).toBe("ACTIVE");
    expect(nextCursor).toBeNull();
  });

  it('status="ARCHIVED" returns only ARCHIVED entries (no ACTIVE, no DELETED)', async () => {
    const { questionId } = await seedTestSubjectAndQuestion();
    const u = await seedUserWithBalance(0);
    const q2 = await prisma.question.create({
      data: {
        subjectId: (await prisma.subject.findFirstOrThrow()).id,
        stemMd: "归档题",
        type: "CALCULATION",
        status: "PUBLISHED",
      },
    });
    const q3 = await prisma.question.create({
      data: {
        subjectId: (await prisma.subject.findFirstOrThrow()).id,
        stemMd: "已删题",
        type: "CALCULATION",
        status: "PUBLISHED",
      },
    });
    await seedErrorBookEntry({ userId: u.id, questionId, status: "ACTIVE" });
    const archived = await seedErrorBookEntry({
      userId: u.id,
      questionId: q2.id,
      status: "ARCHIVED",
    });
    await seedErrorBookEntry({ userId: u.id, questionId: q3.id, status: "DELETED" });

    const caller = appRouter.createCaller(makeCtx(u.id));
    const { entries } = await caller.error.list({ status: "ARCHIVED", limit: 50 });

    expect(entries).toHaveLength(1);
    expect(entries[0]!.id).toBe(archived.id);
    expect(entries[0]!.status).toBe("ARCHIVED");
  });

  it('status="ACTIVE" explicit returns same as default', async () => {
    const { questionId } = await seedTestSubjectAndQuestion();
    const u = await seedUserWithBalance(0);
    const active = await seedErrorBookEntry({
      userId: u.id,
      questionId,
      status: "ACTIVE",
    });
    const caller = appRouter.createCaller(makeCtx(u.id));

    const defaultRes = await caller.error.list({ limit: 50 });
    const explicitRes = await caller.error.list({ status: "ACTIVE", limit: 50 });

    expect(defaultRes.entries.map((e) => e.id)).toEqual([active.id]);
    expect(explicitRes.entries.map((e) => e.id)).toEqual([active.id]);
  });

  it('status="DELETED" rejected by zod → BAD_REQUEST (no DB read)', async () => {
    const { questionId } = await seedTestSubjectAndQuestion();
    const u = await seedUserWithBalance(0);
    await seedErrorBookEntry({ userId: u.id, questionId, status: "DELETED" });

    const caller = appRouter.createCaller(makeCtx(u.id));
    // Cast to bypass the zod-typed input — the test simulates a hostile or
    // mistakenly-typed client.
    await expect(
      caller.error.list({ status: "DELETED" } as unknown as {
        status: "ACTIVE" | "ARCHIVED";
      }),
    ).rejects.toBeInstanceOf(TRPCError);
    await expect(
      caller.error.list({ status: "DELETED" } as unknown as {
        status: "ACTIVE" | "ARCHIVED";
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("cursor pagination: limit=2 total=3 → page1 has 2 + nextCursor, page2 has 1 + nextCursor=null", async () => {
    const subj = await prisma.subject.create({
      data: { code: "math", name: "数学" },
    });
    const u = await seedUserWithBalance(0);
    const created = [];
    for (let i = 0; i < 3; i++) {
      const q = await prisma.question.create({
        data: {
          subjectId: subj.id,
          stemMd: `题 ${i}`,
          type: "CALCULATION",
          status: "PUBLISHED",
        },
      });
      const e = await seedErrorBookEntry({
        userId: u.id,
        questionId: q.id,
        status: "ACTIVE",
      });
      created.push(e);
      // Force createdAt strictly increasing for deterministic ordering;
      // resetDb truncated everything so we can step the clock here without
      // poisoning other tests.
      await new Promise((r) => setTimeout(r, 5));
    }

    const caller = appRouter.createCaller(makeCtx(u.id));
    const page1 = await caller.error.list({ limit: 2 });
    expect(page1.entries).toHaveLength(2);
    expect(page1.nextCursor).not.toBeNull();
    // Order is createdAt DESC, so page1 = [created[2], created[1]]
    expect(page1.entries[0]!.id).toBe(created[2]!.id);
    expect(page1.entries[1]!.id).toBe(created[1]!.id);

    const page2 = await caller.error.list({
      limit: 2,
      cursor: page1.nextCursor!,
    });
    expect(page2.entries).toHaveLength(1);
    expect(page2.entries[0]!.id).toBe(created[0]!.id);
    expect(page2.nextCursor).toBeNull();
  });

  it("cross-user isolation: A's entries not in B's list", async () => {
    const { questionId } = await seedTestSubjectAndQuestion();
    const a = await seedUserWithBalance(0);
    const b = await seedUserWithBalance(0);
    await seedErrorBookEntry({ userId: a.id, questionId, status: "ACTIVE" });

    const callerB = appRouter.createCaller(makeCtx(b.id));
    const res = await callerB.error.list({ limit: 50 });
    expect(res.entries).toHaveLength(0);
  });
});
