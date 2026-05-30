import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { resetDb, prisma } from "@zhijiao/db/test-utils";
import { exportUserData } from "@/server/lib/pii-governance";

beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function seedExportFixture() {
  const user = await prisma.user.create({
    data: {
      name: "Alice",
      avatarUrl: "https://example.test/a.png",
      persona: "STUDENT",
      gradeLevel: "G8",
      isMinor: false,
    },
  });
  const subject = await prisma.subject.create({ data: { code: "math", name: "Math" } });
  const teacher = await prisma.user.create({
    data: { name: "Teacher", persona: "TEACHER", isMinor: false },
  });
  const parent = await prisma.user.create({
    data: { name: "Parent", persona: "PARENT", isMinor: false },
  });
  // Plan 11: user (student) bound to parent.
  await prisma.familyLink.create({
    data: { parentUserId: parent.id, studentUserId: user.id, status: "ACTIVE" },
  });
  const question = await prisma.question.create({
    data: {
      subjectId: subject.id,
      stemMd: "Published stem",
      type: "CALCULATION",
      status: "PUBLISHED",
    },
  });
  const userAdhoc = await prisma.question.create({
    data: {
      subjectId: subject.id,
      stemMd: "Private adhoc stem",
      type: "CALCULATION",
      source: "USER_ADHOC",
      createdByUserId: user.id,
      normalizedStemHash: "hash-1",
    },
  });
  await prisma.authIdentity.createMany({
    data: [
      {
        userId: user.id,
        provider: "PHONE",
        providerScope: "GLOBAL",
        providerUserId: "13800000000",
      },
      {
        userId: user.id,
        provider: "WECHAT_H5",
        providerScope: "wx",
        providerUserId: "openid-secret-xyz",
      },
    ],
  });
  const wallet = await prisma.wallet.create({
    data: {
      userId: user.id,
      balance: 50,
      ledger: {
        create: {
          kind: "TOPUP",
          delta: 50,
          balanceAfter: 50,
          actionKind: "TOPUP_PAID",
          idemKey: "idem-export",
          refTable: "topup_orders",
          refId: "topup-export",
        },
      },
    },
  });
  await prisma.topupOrder.create({
    data: {
      id: "topup-export",
      userId: user.id,
      amountCents: 500,
      credits: 50,
      status: "PAID",
      outTradeNo: "out-export",
      transactionId: "tx-export",
      paidAt: new Date("2026-01-01T00:00:00Z"),
      expiredAt: new Date("2026-01-02T00:00:00Z"),
      ipCreated: "9.9.9.9",
      userAgent: "secret ua",
    },
  });
  await prisma.wechatPayEvent.create({
    data: {
      outTradeNo: "out-export",
      rawBody: "rawBody-secret",
    },
  });
  await prisma.errorBookEntry.create({
    data: {
      userId: user.id,
      questionId: question.id,
      status: "ACTIVE",
      rootCause: "OTHER",
      rootCauseReasoning: "reasoning",
      actualAnswerMd: "actual",
    },
  });
  const classroom = await prisma.classroom.create({
    data: {
      name: "Export classroom",
      subjectId: subject.id,
      gradeLevel: "G8",
      members: {
        create: [
          { userId: teacher.id, role: "TEACHER" },
          { userId: user.id, role: "STUDENT" },
        ],
      },
    },
  });
  const assignment = await prisma.assignment.create({
    data: {
      classroomId: classroom.id,
      teacherUserId: teacher.id,
      title: "Export assignment",
      source: "MANUAL_AI",
      status: "PUBLISHED",
      publishedAt: new Date("2026-01-03T00:00:00Z"),
      tiers: {
        create: {
          level: "CONSOLIDATION",
          title: "Export tier",
          items: {
            create: {
              questionId: question.id,
              position: 1,
              stemMd: "Assignment stem",
              type: "CALCULATION",
              answerMd: "x = 4",
              solutionMd: "Subtract 3.",
            },
          },
        },
      },
    },
    include: { tiers: { include: { items: true } } },
  });
  const assignmentTier = assignment.tiers[0]!;
  const assignmentItem = assignmentTier.items[0]!;
  const studentAssignment = await prisma.studentAssignment.create({
    data: {
      assignmentId: assignment.id,
      studentUserId: user.id,
      tierId: assignmentTier.id,
      status: "GRADED",
      suggestedTier: "CONSOLIDATION",
      submittedAt: new Date("2026-01-04T00:00:00Z"),
      gradedAt: new Date("2026-01-05T00:00:00Z"),
    },
  });
  const assignmentAnswer = await prisma.assignmentAnswer.create({
    data: {
      studentAssignmentId: studentAssignment.id,
      itemId: assignmentItem.id,
      answerJson: { text: "student private answer" },
      gradeStatus: "CORRECT",
      teacherFeedbackMd: "teacher private feedback",
      gradedAt: new Date("2026-01-05T00:00:00Z"),
    },
  });
  const assignmentPerformance = await prisma.assignmentPerformance.create({
    data: {
      assignmentId: assignment.id,
      studentUserId: user.id,
      itemId: assignmentItem.id,
      gradeStatus: "CORRECT",
      kpIds: [],
    },
  });
  await prisma.modelCall.create({
    data: {
      taskKind: "TUTOR_ADHOC",
      model: "secret-model",
      requestJson: { prompt: "requestJson-secret" },
      responseJson: { answer: "responseJson-secret" },
      errorMessage: "errorMessage-secret",
      latencyMs: 123,
      tokensIn: 10,
      tokensOut: 20,
      status: "SUCCESS",
      userId: user.id,
    },
  });
  return { user, parent, wallet, userAdhoc, studentAssignment, assignmentAnswer, assignmentPerformance };
}

describe("exportUserData", () => {
  it("exports whitelisted user data and excludes internal PII fields", async () => {
    const { user, parent, wallet, userAdhoc, studentAssignment, assignmentAnswer, assignmentPerformance } =
      await seedExportFixture();

    const result = await exportUserData(prisma, user.id);
    expect(result.schemaVersion).toBe("2026-05-26");
    expect(result.userId).toBe(user.id);
    expect(result.user).toMatchObject({
      name: "Alice",
      avatarUrl: "https://example.test/a.png",
      persona: "STUDENT",
      gradeLevel: "G8",
      isMinor: false,
    });
    expect(result.authIdentities.map((i) => i.providerUserIdMasked)).toEqual([
      "138****0000",
      "ope****xyz",
    ]);
    expect(result.wallet).toMatchObject({ balance: 50, id: wallet.id });
    expect(result.creditLedger).toHaveLength(1);
    expect(result.topupOrders).toEqual([
      expect.objectContaining({
        outTradeNo: "out-export",
        amountCents: 500,
        credits: 50,
        status: "PAID",
        transactionId: "tx-export",
      }),
    ]);
    expect(result.familyLinks).toEqual([
      expect.objectContaining({
        role: "student",
        counterpartUserId: parent.id,
        status: "ACTIVE",
      }),
    ]);
    expect(result.errorBookEntries).toHaveLength(1);
    expect(result.userAdhocQuestions).toEqual([
      expect.objectContaining({ id: userAdhoc.id, stemMd: "Private adhoc stem" }),
    ]);
    expect(result.modelCalls).toEqual([
      expect.objectContaining({
        taskKind: "TUTOR_ADHOC",
        status: "SUCCESS",
        tokensIn: 10,
        tokensOut: 20,
      }),
    ]);
    expect(result.studentAssignments).toEqual([
      expect.objectContaining({ id: studentAssignment.id, status: "GRADED" }),
    ]);
    expect(result.assignmentAnswers).toEqual([
      expect.objectContaining({
        id: assignmentAnswer.id,
        gradeStatus: "CORRECT",
        teacherFeedbackMd: "teacher private feedback",
      }),
    ]);
    expect(result.assignmentPerformance).toEqual([
      expect.objectContaining({
        id: assignmentPerformance.id,
        gradeStatus: "CORRECT",
      }),
    ]);

    const json = JSON.stringify(result);
    expect(json).not.toMatch(/rawBody-secret|requestJson-secret|responseJson-secret|errorMessage-secret/);
    expect(json).not.toMatch(/9\.9\.9\.9|secret ua|secret-model|promptTemplateId|requestJson|responseJson|ipCreated|userAgent|rawBody/);
  });

  it("throws for an unknown user id", async () => {
    await expect(exportUserData(prisma, "missing-user")).rejects.toThrow(/User not found/);
  });
});
