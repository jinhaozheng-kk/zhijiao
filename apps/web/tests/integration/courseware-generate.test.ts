import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { prisma, resetDb } from "@zhijiao/db/test-utils";
import { makeCtx, seedUserWithBalance } from "./_helpers/error-book-fixtures";

vi.mock("@/lib/ai-client", () => ({ getAiRouter: () => ({
  async generateLessonPlan() {
    return { title: "课件", modelCallId: "mc1", sections: [
      { type: "INTRO", title: "导入", contentMd: "c1" }, { type: "EXPLANATION", title: "讲解", contentMd: "c2" },
      { type: "EXAMPLE", title: "例题", contentMd: "c3" }, { type: "PITFALL", title: "易错", contentMd: "c4" },
      { type: "EXERCISE", title: "练习", contentMd: "c5" },
    ] };
  },
}) }));
const { appRouter } = await import("@/server/routers/_root");

async function seedTeacher(balance: number) {
  const u = await prisma.user.create({ data: { persona: "TEACHER" } });
  await prisma.wallet.create({ data: { userId: u.id, balance } });
  const subject = await prisma.subject.upsert({ where: { code: "math" }, create: { code: "math", name: "数学" }, update: {} });
  const kp = await prisma.knowledgePoint.upsert({
    where: { subjectId_code: { subjectId: subject.id, code: "math-g8-linear-eq-solve" } },
    create: { subjectId: subject.id, code: "math-g8-linear-eq-solve", name: "一次方程求解" },
    update: {},
  });
  return { id: u.id, subjectId: subject.id, kpId: kp.id };
}

beforeEach(async () => { await resetDb(); });
afterAll(async () => { await prisma.$disconnect(); });

describe("courseware.generate", () => {
  it("教师生成：落 Courseware + 5 段、扣 3", async () => {
    const t = await seedTeacher(100);
    const caller = appRouter.createCaller(makeCtx(t.id, { persona: "TEACHER" }));
    const r = await caller.courseware.generate({ subjectId: t.subjectId, kpIds: [t.kpId], gradeLevel: "G8", clientRequestId: crypto.randomUUID() });
    expect(await prisma.coursewareSection.count({ where: { coursewareId: r.coursewareId } })).toBe(5);
    const w = await prisma.wallet.findFirstOrThrow({ where: { userId: t.id } });
    expect(w.balance).toBe(97);
  });

  it("非教师：扣费前 FORBIDDEN、不写 DEBIT", async () => {
    const t = await seedTeacher(100);
    const student = await seedUserWithBalance(100);
    const caller = appRouter.createCaller(makeCtx(student.id));
    await expect(caller.courseware.generate({ subjectId: t.subjectId, kpIds: [t.kpId], gradeLevel: "G8", clientRequestId: crypto.randomUUID() }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await prisma.creditLedger.count({ where: { wallet: { userId: student.id }, kind: "DEBIT" } })).toBe(0);
  });

  it("kpIds 不属于 subject：写 DEBIT 后补偿（净零）、不落 Courseware", async () => {
    const t = await seedTeacher(100);
    const caller = appRouter.createCaller(makeCtx(t.id, { persona: "TEACHER" }));
    await expect(caller.courseware.generate({ subjectId: t.subjectId, kpIds: ["clxnonexistentkp00000000"], gradeLevel: "G8", clientRequestId: crypto.randomUUID() }))
      .rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(await prisma.courseware.count({ where: { teacherUserId: t.id } })).toBe(0);
    expect((await prisma.wallet.findFirstOrThrow({ where: { userId: t.id } })).balance).toBe(100);
  });

  it("updateSection 改内容；markReady；跨教师 NOT_FOUND", async () => {
    const t = await seedTeacher(100);
    const caller = appRouter.createCaller(makeCtx(t.id, { persona: "TEACHER" }));
    const r = await caller.courseware.generate({ subjectId: t.subjectId, kpIds: [t.kpId], gradeLevel: "G8", clientRequestId: crypto.randomUUID() });
    const sec = await prisma.coursewareSection.findFirstOrThrow({ where: { coursewareId: r.coursewareId, type: "INTRO" } });
    await caller.courseware.updateSection({ coursewareId: r.coursewareId, sectionId: sec.id, contentMd: "改后的导入" });
    expect((await prisma.coursewareSection.findUniqueOrThrow({ where: { id: sec.id } })).contentMd).toBe("改后的导入");
    await caller.courseware.markReady({ coursewareId: r.coursewareId });
    expect((await prisma.courseware.findUniqueOrThrow({ where: { id: r.coursewareId } })).status).toBe("READY");
    const other = await seedTeacher(100);
    await expect(appRouter.createCaller(makeCtx(other.id, { persona: "TEACHER" })).courseware.markReady({ coursewareId: r.coursewareId })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
