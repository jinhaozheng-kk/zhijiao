import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { resetDb, prisma } from "@zhijiao/db/test-utils";
import { appRouter } from "@/server/routers/_root";
import {
  makeCtx,
  redis,
} from "./_helpers/error-book-fixtures";

async function seedKpId(): Promise<string> {
  const subject = await prisma.subject.findFirstOrThrow({
    where: { code: "math" },
  });
  const kp = await prisma.knowledgePoint.create({
    data: {
      subjectId: subject.id,
      code: `math-g8-assignment-${crypto.randomUUID()}`,
      name: "linear equations",
      difficulty: 2,
    },
  });
  return kp.id;
}

async function seedTeacherWithWallet(balance: number) {
  const teacher = await prisma.user.create({
    data: { isMinor: false, persona: "TEACHER" },
  });
  const wallet = await prisma.wallet.create({
    data: { userId: teacher.id, balance },
  });
  if (balance > 0) {
    await prisma.creditLedger.create({
      data: {
        walletId: wallet.id,
        kind: "TOPUP",
        delta: balance,
        balanceAfter: balance,
        idemKey: `topup:assignment-bootstrap:${teacher.id}`,
      },
    });
  }
  return teacher;
}

async function seedTeacherClassroomWithWallet(args: { balance: number }) {
  const subject = await prisma.subject.create({
    data: { code: "math", name: "Math" },
  });
  const teacher = await seedTeacherWithWallet(args.balance);
  const otherTeacher = await seedTeacherWithWallet(args.balance);
  const classroom = await prisma.classroom.create({
    data: {
      name: "G8 Math 1",
      subjectId: subject.id,
      gradeLevel: "G8",
      members: {
        create: {
          userId: teacher.id,
          role: "TEACHER",
        },
      },
    },
  });
  return { teacher, otherTeacher, classroom };
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

describe("assignment generation billing", () => {
  it("charges one credit per requested generated question", async () => {
    const { teacher, classroom } = await seedTeacherClassroomWithWallet({
      balance: 20,
    });
    const caller = appRouter.createCaller(makeCtx(teacher.id));

    await (caller as any).assignment.generateDraftFromCriteria({
      classroomId: classroom.id,
      clientRequestId: "11111111-1111-4111-8111-111111111111",
      subjectId: classroom.subjectId,
      gradeLevel: "G8",
      kpIds: [await seedKpId()],
      difficultyRange: [2, 4],
      tierCounts: { BASIC: 2, CONSOLIDATION: 2, CHALLENGE: 2 },
      questionTypes: ["SINGLE_CHOICE"],
      teachingGoalMd: "Practice linear equations.",
    });

    const wallet = await prisma.wallet.findUniqueOrThrow({
      where: { userId: teacher.id },
    });
    expect(wallet.balance).toBe(14);

    const debit = await prisma.creditLedger.findFirstOrThrow({
      where: {
        createdByUserId: teacher.id,
        actionKind: "ASSIGNMENT_QUESTION_GEN",
      },
    });
    expect(debit.delta).toBe(-6);
  });

  it("does not charge when teacher is not a classroom teacher", async () => {
    const { otherTeacher, classroom } = await seedTeacherClassroomWithWallet({
      balance: 20,
    });
    const caller = appRouter.createCaller(makeCtx(otherTeacher.id));

    await expect(
      (caller as any).assignment.generateDraftFromCriteria({
        classroomId: classroom.id,
        clientRequestId: "22222222-2222-4222-8222-222222222222",
        subjectId: classroom.subjectId,
        gradeLevel: "G8",
        kpIds: [await seedKpId()],
        difficultyRange: [2, 4],
        tierCounts: { BASIC: 1, CONSOLIDATION: 1, CHALLENGE: 1 },
        questionTypes: ["SINGLE_CHOICE"],
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    const ledgerCount = await prisma.creditLedger.count({
      where: {
        createdByUserId: otherTeacher.id,
        actionKind: "ASSIGNMENT_QUESTION_GEN",
      },
    });
    expect(ledgerCount).toBe(0);
  });
});
