import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import Redis from "ioredis";
import { resetDb, prisma } from "@zhijiao/db/test-utils";
import type { Role } from "@zhijiao/domain";

vi.mock("@/lib/ai-client", () => ({
  getAiRouter: () => ({
    async generateLearningAdvice(_input: unknown) {
      return {
        summaryMd: "你在方程方面进步明显。",
        suggestions: [{ focusKp: "因式分解", methodMd: "先识别公因式再尝试公式法。" }],
        encouragementMd: "保持节奏，继续加油。",
        modelCallId: "mock-call",
      };
    },
  }),
}));

const { appRouter } = await import("@/server/routers/_root");

const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379");

function makeCtx(userId: string) {
  return {
    db: prisma,
    redis,
    auth: {
      userId,
      sessionId: "test-session",
      persona: "STUDENT" as const,
      roles: [] as Role[],
      isMinor: false,
    },
    authError: null,
    ip: "127.0.0.1",
    ua: "vitest",
    requestId: "test-req-analytics",
    resHeaders: new Headers(),
    cookies: {},
  };
}

async function seedStudentWithPerf(opts: { balance?: number } = {}) {
  const subject = await prisma.subject.create({ data: { code: `an-${Date.now()}-${Math.random()}`, name: "数学" } });
  const kp1 = await prisma.knowledgePoint.create({ data: { subjectId: subject.id, code: `kp1-${Math.random()}`, name: "一元一次方程" } });
  const kp2 = await prisma.knowledgePoint.create({ data: { subjectId: subject.id, code: `kp2-${Math.random()}`, name: "因式分解" } });
  const student = await prisma.user.create({ data: { isMinor: false, persona: "STUDENT", gradeLevel: "G8" } });
  if (opts.balance && opts.balance > 0) {
    const w = await prisma.wallet.create({ data: { userId: student.id, balance: opts.balance } });
    await prisma.creditLedger.create({
      data: { walletId: w.id, kind: "TOPUP", delta: opts.balance, balanceAfter: opts.balance, idemKey: `topup:bootstrap:${student.id}` },
    });
  }
  await prisma.assignmentPerformance.createMany({
    data: [
      { assignmentId: "a1", studentUserId: student.id, itemId: "i1", gradeStatus: "CORRECT", kpIds: [kp1.id] },
      { assignmentId: "a1", studentUserId: student.id, itemId: "i2", gradeStatus: "WRONG", kpIds: [kp2.id] },
      { assignmentId: "a1", studentUserId: student.id, itemId: "i3", gradeStatus: "WRONG", kpIds: [kp2.id] },
    ],
  });
  return { student, subject, kp1, kp2 };
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

describe("analytics.profile.mine", () => {
  it("returns self profile with masteries", async () => {
    const { student } = await seedStudentWithPerf();
    const r = await appRouter.createCaller(makeCtx(student.id)).analytics.profile.mine({ window: "ALL" });
    expect(r.relationship).toBe("self");
    expect(r.profile.hasData).toBe(true);
    expect(r.profile.masteries.length).toBeGreaterThanOrEqual(2);
  });
});

describe("analytics.profile.get", () => {
  it("parent sees stripped familyView; teacher sees full profile; stranger NOT_FOUND", async () => {
    const { student, subject } = await seedStudentWithPerf();
    const parent = await prisma.user.create({ data: { isMinor: false, persona: "PARENT" } });
    const teacher = await prisma.user.create({ data: { isMinor: false, persona: "TEACHER" } });
    const stranger = await prisma.user.create({ data: { isMinor: false, persona: "STUDENT" } });
    await prisma.familyLink.create({ data: { parentUserId: parent.id, studentUserId: student.id, status: "ACTIVE" } });
    const cls = await prisma.classroom.create({ data: { name: "班", subjectId: subject.id } });
    await prisma.classroomMember.create({ data: { classroomId: cls.id, userId: teacher.id, role: "TEACHER" } });
    await prisma.classroomMember.create({ data: { classroomId: cls.id, userId: student.id, role: "STUDENT" } });

    const asParent = await appRouter.createCaller(makeCtx(parent.id)).analytics.profile.get({ studentUserId: student.id, window: "ALL" });
    expect(asParent.relationship).toBe("parent");
    expect("view" in asParent).toBe(true);
    expect("profile" in asParent).toBe(false);

    const asTeacher = await appRouter.createCaller(makeCtx(teacher.id)).analytics.profile.get({ studentUserId: student.id, window: "ALL" });
    expect(asTeacher.relationship).toBe("teacher");
    expect("profile" in asTeacher).toBe(true);

    await expect(
      appRouter.createCaller(makeCtx(stranger.id)).analytics.profile.get({ studentUserId: student.id, window: "ALL" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("analytics.classroom.diagnosis", () => {
  it("non-teacher → NOT_FOUND", async () => {
    const { subject } = await seedStudentWithPerf();
    const cls = await prisma.classroom.create({ data: { name: "班2", subjectId: subject.id } });
    const outsider = await prisma.user.create({ data: { isMinor: false, persona: "STUDENT" } });
    await expect(
      appRouter.createCaller(makeCtx(outsider.id)).analytics.classroom.diagnosis({ classroomId: cls.id, window: "ALL" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("analytics.profile.generateAdvice", () => {
  it("happy path returns suggestions and charges 1 credit", async () => {
    const { student } = await seedStudentWithPerf({ balance: 5 });
    const r = await appRouter.createCaller(makeCtx(student.id)).analytics.profile.generateAdvice({
      window: "ALL",
      clientRequestId: "33333333-3333-4333-8333-333333333333",
    });
    expect(r.suggestions[0]!.focusKp).toBe("因式分解");
    const w = await prisma.wallet.findUnique({ where: { userId: student.id } });
    expect(w?.balance).toBe(4);
  });
});
