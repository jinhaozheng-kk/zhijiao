import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { resetDb, prisma } from "@zhijiao/db/test-utils";
import {
  deactivateUser,
  previewDeactivateUser,
} from "@/server/lib/pii-governance";
import { seedSubmittedAssignmentAnswer } from "./_helpers/assignment-fixtures";

beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function seedDeactivateFixture() {
  const [user, otherUser] = await Promise.all([
    prisma.user.create({
      data: {
        name: "Alice",
        avatarUrl: "https://example.test/a.png",
        persona: "STUDENT",
        isMinor: false,
      },
    }),
    prisma.user.create({ data: { name: "Bob", persona: "STUDENT", isMinor: false } }),
  ]);
  const subject = await prisma.subject.create({
    data: { code: "math", name: "Math" },
  });
  const kp = await prisma.knowledgePoint.create({
    data: { subjectId: subject.id, code: "math-1", name: "Linear" },
  });
  const publishedQuestion = await prisma.question.create({
    data: {
      subjectId: subject.id,
      stemMd: "Published stem",
      type: "CALCULATION",
      status: "PUBLISHED",
    },
  });
  const userAdhocQuestion = await prisma.question.create({
    data: {
      subjectId: subject.id,
      stemMd: "Private uploaded stem",
      type: "CALCULATION",
      status: "DRAFT",
      source: "USER_ADHOC",
      createdByUserId: user.id,
      normalizedStemHash: "hash-user-adhoc",
      answer: { create: { contentMd: "answer", solutionMd: "solution" } },
      knowledgePoints: { create: { kpId: kp.id, weight: 1 } },
    },
  });
  const entry = await prisma.errorBookEntry.create({
    data: {
      userId: user.id,
      questionId: publishedQuestion.id,
      rootCause: "OTHER",
      rootCauseReasoning: "reasoning with pii",
      actualAnswerMd: "my answer",
    },
  });
  const group = await prisma.variantGroup.create({
    data: {
      entryId: entry.id,
      userId: user.id,
      creditsCost: 3,
      debitLedgerId: "debit-ledger-1",
      items: {
        create: [
          {
            level: "L1",
            position: 1,
            stemMd: "variant stem",
            solutionMd: "variant solution",
          },
        ],
      },
    },
  });
  const wallet = await prisma.wallet.create({
    data: {
      userId: user.id,
      balance: 100,
      ledger: {
        create: {
          kind: "TOPUP",
          delta: 100,
          balanceAfter: 100,
          idemKey: "idem-1",
          refTable: "topup_orders",
          refId: "order-1",
        },
      },
    },
  });
  await prisma.topupOrder.create({
    data: {
      id: "order-1",
      userId: user.id,
      amountCents: 1000,
      credits: 100,
      status: "PAID",
      outTradeNo: "out-1",
      transactionId: "tx-1",
      paidAt: new Date(),
      expiredAt: new Date(Date.now() + 3600_000),
      ipCreated: "1.1.1.1",
      userAgent: "ua",
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
        providerUserId: "openid-1",
      },
    ],
  });
  await prisma.otpRequest.createMany({
    data: [
      {
        phone: "13800000000",
        purpose: "LOGIN",
        codeHash: "hash",
        expiresAt: new Date(Date.now() + 60_000),
      },
      {
        phone: "openid-1",
        purpose: "LOGIN",
        codeHash: "hash-openid-like",
        expiresAt: new Date(Date.now() + 60_000),
      },
    ],
  });
  await prisma.session.createMany({
    data: [
      {
        userId: user.id,
        refreshTokenHash: "session-active",
        deviceLabel: "phone",
        ipCreated: "2.2.2.2",
        userAgent: "ua",
        expiresAt: new Date(Date.now() + 3600_000),
      },
      {
        userId: user.id,
        refreshTokenHash: "session-revoked",
        deviceLabel: "old phone",
        ipCreated: "3.3.3.3",
        userAgent: "old ua",
        expiresAt: new Date(Date.now() + 3600_000),
        revokedAt: new Date(),
        revokedReason: "USER_LOGOUT",
      },
    ],
  });
  await prisma.modelCall.create({
    data: {
      taskKind: "TUTOR_ADHOC",
      model: "mock",
      requestJson: { prompt: "private" },
      responseJson: { ok: true },
      status: "SUCCESS",
      userId: user.id,
    },
  });
  await prisma.kpAlias.create({
    data: {
      subjectId: subject.id,
      kpId: kp.id,
      normalizedAlias: "alias",
      source: "CLI_MANUAL",
      createdByUserId: user.id,
    },
  });
  await prisma.kpReconcileMatch.create({
    data: {
      questionId: publishedQuestion.id,
      kpId: kp.id,
      rawHint: "hint",
      normalizedHint: "hint",
      source: "TUTOR_ADHOC",
      sourceRefType: "QUESTION",
      sourceRefId: publishedQuestion.id,
      status: "LINKED",
      reviewedByUserId: user.id,
    },
  });
  await prisma.authIdentity.create({
    data: {
      userId: otherUser.id,
      provider: "PHONE",
      providerScope: "GLOBAL",
      providerUserId: "13900000000",
    },
  });
  return { user, otherUser, entry, group, wallet, userAdhocQuestion };
}

describe("deactivateUser", () => {
  it("hard-deletes user content, scrubs PII, keeps financial rows, and writes audit log", async () => {
    const { user, wallet, userAdhocQuestion } = await seedDeactivateFixture();

    const result = await deactivateUser(prisma, {
      userId: user.id,
      operatorId: null,
      initiatorRef: "cli:test:operator",
      reason: "requested",
    });

    expect(result.alreadyDeactivated).toBe(false);
    expect(result.payload.deleted).toMatchObject({
      errorBookEntries: 1,
      variantGroups: 1,
      variantItems: 1,
      userAdhocQuestions: 1,
    });
    expect(result.payload.scrubbed).toMatchObject({
      authIdentities: 2,
      otpRequests: 1,
      sessions: 2,
      topupOrders: 1,
      modelCalls: 1,
      kpAliases: 1,
      kpReconcileMatches: 1,
    });

    await expect(prisma.errorBookEntry.count({ where: { userId: user.id } })).resolves.toBe(0);
    await expect(prisma.variantGroup.count({ where: { userId: user.id } })).resolves.toBe(0);
    await expect(prisma.variantItem.count()).resolves.toBe(0);
    await expect(prisma.question.findUnique({ where: { id: userAdhocQuestion.id } })).resolves.toBeNull();
    await expect(prisma.authIdentity.count({ where: { userId: user.id } })).resolves.toBe(0);
    await expect(prisma.otpRequest.count({ where: { phone: "13800000000" } })).resolves.toBe(0);
    await expect(prisma.otpRequest.count({ where: { phone: "openid-1" } })).resolves.toBe(1);

    const sessions = await prisma.session.findMany({ where: { userId: user.id } });
    expect(sessions).toHaveLength(2);
    expect(sessions.every((s) => s.revokedAt && !s.deviceLabel && !s.ipCreated && !s.userAgent)).toBe(true);

    await expect(prisma.topupOrder.findUnique({ where: { id: "order-1" } })).resolves.toMatchObject({
      amountCents: 1000,
      credits: 100,
      transactionId: "tx-1",
      ipCreated: null,
      userAgent: null,
    });
    await expect(prisma.wallet.findUnique({ where: { id: wallet.id } })).resolves.toMatchObject({
      balance: 100,
    });
    await expect(prisma.creditLedger.count({ where: { walletId: wallet.id } })).resolves.toBe(1);
    await expect(prisma.modelCall.count({ where: { userId: null } })).resolves.toBe(1);
    await expect(prisma.kpAlias.count({ where: { createdByUserId: null } })).resolves.toBe(1);
    await expect(prisma.kpReconcileMatch.count({ where: { reviewedByUserId: null } })).resolves.toBe(1);

    await expect(prisma.user.findUnique({ where: { id: user.id } })).resolves.toMatchObject({
      name: null,
      avatarUrl: null,
      deactivationReason: "requested",
    });
    const log = await prisma.opsActionLog.findFirstOrThrow({
      where: { kind: "DEACTIVATE_USER", targetUserId: user.id },
    });
    expect(log.initiatorRef).toBe("cli:test:operator");
    expect(JSON.stringify(log.payload)).not.toMatch(/13800000000|openid-1|Private uploaded stem|my answer/);
  });

  it("is idempotent after deletedAt is set", async () => {
    const { user } = await seedDeactivateFixture();
    await deactivateUser(prisma, {
      userId: user.id,
      operatorId: null,
      initiatorRef: "cli:test:operator",
    });

    const second = await deactivateUser(prisma, {
      userId: user.id,
      operatorId: null,
      initiatorRef: "cli:test:operator",
    });
    expect(second.alreadyDeactivated).toBe(true);
    await expect(prisma.opsActionLog.count({ where: { targetUserId: user.id } })).resolves.toBe(1);
  });

  it("preview is read-only and writes no OpsActionLog", async () => {
    const { user } = await seedDeactivateFixture();

    const preview = await previewDeactivateUser(prisma, user.id);
    expect(preview.alreadyDeactivated).toBe(false);
    expect(preview.payload.deleted.errorBookEntries).toBe(1);
    expect(preview.payload.scrubbed.authIdentities).toBe(2);
    await expect(prisma.errorBookEntry.count({ where: { userId: user.id } })).resolves.toBe(1);
    await expect(prisma.opsActionLog.count()).resolves.toBe(0);

    const dryRun = await deactivateUser(prisma, {
      userId: user.id,
      operatorId: null,
      initiatorRef: "cli:test:operator",
      dryRun: true,
    });
    expect(dryRun.payload).toEqual(preview.payload);
    await expect(prisma.errorBookEntry.count({ where: { userId: user.id } })).resolves.toBe(1);
    await expect(prisma.opsActionLog.count()).resolves.toBe(0);
  });

  it("removes assignment submissions and performance on student deactivation", async () => {
    const { student, assignment, assignedItem, answer, kp } =
      await seedSubmittedAssignmentAnswer();
    await prisma.assignmentAnswer.update({
      where: { id: answer.id },
      data: { teacherFeedbackMd: "private teacher feedback" },
    });
    await prisma.assignmentPerformance.create({
      data: {
        assignmentId: assignment.id,
        studentUserId: student.id,
        itemId: assignedItem.id,
        gradeStatus: "WRONG",
        kpIds: [kp.id],
      },
    });

    const result = await deactivateUser(prisma, {
      userId: student.id,
      operatorId: null,
      initiatorRef: "cli:test:operator",
      reason: "test",
    });

    expect(result.payload.deleted).toMatchObject({
      assignmentAnswers: 1,
      assignmentPerformance: 1,
      studentAssignments: 1,
    });
    await expect(
      prisma.assignmentAnswer.findUnique({ where: { id: answer.id } }),
    ).resolves.toBeNull();
    await expect(
      prisma.assignmentPerformance.count({
        where: { studentUserId: student.id },
      }),
    ).resolves.toBe(0);
    await expect(
      prisma.studentAssignment.count({ where: { studentUserId: student.id } }),
    ).resolves.toBe(0);
    const log = await prisma.opsActionLog.findFirstOrThrow({
      where: { kind: "DEACTIVATE_USER", targetUserId: student.id },
    });
    expect(JSON.stringify(log.payload)).not.toMatch(/private teacher feedback|x = 4/);
  });

  it("rolls back all changes if audit log write fails", async () => {
    const { user } = await seedDeactivateFixture();

    await expect(
      deactivateUser(prisma, {
        userId: user.id,
        operatorId: "missing-operator",
        initiatorRef: "cli:test:operator",
      }),
    ).rejects.toThrow();

    await expect(prisma.errorBookEntry.count({ where: { userId: user.id } })).resolves.toBe(1);
    await expect(prisma.authIdentity.count({ where: { userId: user.id } })).resolves.toBe(2);
    await expect(prisma.user.findUnique({ where: { id: user.id } })).resolves.toMatchObject({
      deletedAt: null,
    });
    await expect(prisma.opsActionLog.count()).resolves.toBe(0);
  });

  it("throws for unknown user id", async () => {
    await expect(
      deactivateUser(prisma, {
        userId: "missing-user",
        operatorId: null,
        initiatorRef: "cli:test:operator",
      }),
    ).rejects.toThrow(/User not found/);
  });
});
