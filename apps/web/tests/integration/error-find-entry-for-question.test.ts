// Plan 8 hotfix (P2 from review): error.findEntryForQuestion read-only query
// 让 ErrorAnalysisCard 在 mount 时判断 questionId 是否已诊断，免得每次重打开 /tutor
// 同一题都从付费 CTA 起步。
//
// 守门 4 个场景：
//   1) 无 entry           → entry:null
//   2) ACTIVE entry       → 返回（卡片显示已诊断态）
//   3) ARCHIVED entry     → 返回（归档也算"已诊断"，用户能跳详情页 unarchive）
//   4) DELETED entry      → entry:null（终态，与新 ACTIVE 共存语义）
//
// 跨用户场景：另一用户 ACTIVE entry 不应被当前用户看见（基本可见性，不在本 query
// 的核心创新里但顺手守门）
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
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

describe("error.findEntryForQuestion (Plan 8 hotfix P2)", () => {
  it("no entry → returns entry:null", async () => {
    const { questionId } = await seedTestSubjectAndQuestion();
    const u = await seedUserWithBalance(5);
    const caller = appRouter.createCaller(makeCtx(u.id));

    const r = await caller.error.findEntryForQuestion({ questionId });
    expect(r.entry).toBeNull();
  });

  it("ACTIVE entry → returns shape with id/status/rootCause/rootCauseReasoning", async () => {
    const { questionId } = await seedTestSubjectAndQuestion();
    const u = await seedUserWithBalance(5);
    const entry = await seedErrorBookEntry({
      userId: u.id,
      questionId,
      status: "ACTIVE",
      rootCause: "CALCULATION_SLIP",
      rootCauseReasoning: "Active entry reasoning.",
    });
    const caller = appRouter.createCaller(makeCtx(u.id));

    const r = await caller.error.findEntryForQuestion({ questionId });
    expect(r.entry).not.toBeNull();
    expect(r.entry!.id).toBe(entry.id);
    expect(r.entry!.status).toBe("ACTIVE");
    expect(r.entry!.rootCause).toBe("CALCULATION_SLIP");
    expect(r.entry!.rootCauseReasoning).toBe("Active entry reasoning.");
  });

  it("ARCHIVED entry → returned (归档也算已诊断)", async () => {
    const { questionId } = await seedTestSubjectAndQuestion();
    const u = await seedUserWithBalance(5);
    const entry = await seedErrorBookEntry({
      userId: u.id,
      questionId,
      status: "ARCHIVED",
      rootCause: "CONCEPT_CONFUSION",
      rootCauseReasoning: "Archived but still findable.",
    });
    const caller = appRouter.createCaller(makeCtx(u.id));

    const r = await caller.error.findEntryForQuestion({ questionId });
    expect(r.entry).not.toBeNull();
    expect(r.entry!.id).toBe(entry.id);
    expect(r.entry!.status).toBe("ARCHIVED");
  });

  it("DELETED entry → entry:null (终态，partial idx 允许新 ACTIVE 共存)", async () => {
    const { questionId } = await seedTestSubjectAndQuestion();
    const u = await seedUserWithBalance(5);
    await seedErrorBookEntry({
      userId: u.id,
      questionId,
      status: "DELETED",
      rootCause: "OTHER",
    });
    const caller = appRouter.createCaller(makeCtx(u.id));

    const r = await caller.error.findEntryForQuestion({ questionId });
    expect(r.entry).toBeNull();
  });

  it("跨用户：A 的 ACTIVE entry 不被 B 看见", async () => {
    const { questionId } = await seedTestSubjectAndQuestion();
    const userA = await seedUserWithBalance(5);
    const userB = await seedUserWithBalance(5);
    await seedErrorBookEntry({
      userId: userA.id,
      questionId,
      status: "ACTIVE",
      rootCause: "CALCULATION_SLIP",
    });
    const caller = appRouter.createCaller(makeCtx(userB.id));

    const r = await caller.error.findEntryForQuestion({ questionId });
    expect(r.entry).toBeNull();
  });
});
