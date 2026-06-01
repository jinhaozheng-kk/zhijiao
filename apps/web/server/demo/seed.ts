import type { Prisma, PrismaClient } from "@prisma/client";

type DemoIdsShape = typeof import("./config.js").DEMO_IDS;
type DemoPrisma = PrismaClient | Prisma.TransactionClient;

export const DEMO_SEED_IDS = {
  classroomId: "demo-classroom-g8-math-01",
  teacherUserId: "demo-teacher-math-01",
  studentUserId: "demo-student-focus-01",
  stableStudentUserId: "demo-student-stable-01",
  consolidatingStudentUserId: "demo-student-consolidating-01",
  parentUserId: "demo-parent-01",
} as const satisfies DemoIdsShape;

const IDS = {
  subjectId: "demo-subject-math",
  kpId: "demo-kp-linear-equations",
  walletId: "demo-wallet-teacher-01",
  studentWalletId: "demo-wallet-student-01",
  creditLedgerId: "demo-ledger-teacher-adjust-add-01",
  studentCreditLedgerId: "demo-ledger-student-adjust-add-01",
  variantDebitLedgerId: "demo-ledger-variant-debit-01",
  questionId: "demo-question-linear-01",
  variantQuestionId: "demo-question-variant-linear-01",
  assignmentId: "demo-assignment-linear-01",
  tierBasicId: "demo-assignment-tier-basic-01",
  tierConsolidationId: "demo-assignment-tier-consolidation-01",
  tierChallengeId: "demo-assignment-tier-challenge-01",
  assignmentItemId: "demo-assignment-item-linear-01",
  studentAssignmentId: "demo-student-assignment-linear-01",
  assignmentAnswerId: "demo-assignment-answer-linear-01",
  assignmentPerformanceId: "demo-assignment-performance-linear-01",
  errorBookEntryId: "demo-error-book-entry-linear-01",
  variantGroupId: "demo-variant-group-linear-01",
  variantItemId: "demo-variant-item-linear-01",
} as const;

const publishedAt = new Date("2026-01-01T00:00:00.000Z");
const submittedAt = new Date("2026-01-02T00:00:00.000Z");
const gradedAt = new Date("2026-01-02T00:10:00.000Z");
const nextReviewAt = new Date("2026-01-09T00:00:00.000Z");

export interface DemoVerifyResult {
  ok: true;
  checked: string[];
}

export async function resetDemoData(prisma: PrismaClient) {
  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const subject = await tx.subject.upsert({
      where: { code: "demo-math" },
      update: { name: "Demo Math" },
      create: { id: IDS.subjectId, code: "demo-math", name: "Demo Math" },
    });

    const kp = await tx.knowledgePoint.upsert({
      where: {
        subjectId_code: {
          subjectId: subject.id,
          code: "demo-g8-linear-equations",
        },
      },
      update: {
        name: "Linear equations",
        description: "Solving one-variable linear equations.",
        difficulty: 2,
      },
      create: {
        id: IDS.kpId,
        subjectId: subject.id,
        code: "demo-g8-linear-equations",
        name: "Linear equations",
        description: "Solving one-variable linear equations.",
        difficulty: 2,
      },
    });

    await upsertDemoUser(tx, {
      id: DEMO_SEED_IDS.teacherUserId,
      name: "Demo Teacher",
      persona: "TEACHER",
      gradeLevel: null,
      isMinor: false,
    });
    await upsertDemoUser(tx, {
      id: DEMO_SEED_IDS.studentUserId,
      name: "Demo Student",
      persona: "STUDENT",
      gradeLevel: "G8",
      isMinor: true,
    });
    await upsertDemoUser(tx, {
      id: DEMO_SEED_IDS.stableStudentUserId,
      name: "Stable Demo Student",
      persona: "STUDENT",
      gradeLevel: "G8",
      isMinor: true,
    });
    await upsertDemoUser(tx, {
      id: DEMO_SEED_IDS.consolidatingStudentUserId,
      name: "Consolidating Demo Student",
      persona: "STUDENT",
      gradeLevel: "G8",
      isMinor: true,
    });
    await upsertDemoUser(tx, {
      id: DEMO_SEED_IDS.parentUserId,
      name: "Demo Parent",
      persona: "PARENT",
      gradeLevel: null,
      isMinor: false,
    });

    await tx.classroom.upsert({
      where: { id: DEMO_SEED_IDS.classroomId },
      update: {
        name: "Demo G8 Math",
        subjectId: subject.id,
        gradeLevel: "G8",
      },
      create: {
        id: DEMO_SEED_IDS.classroomId,
        name: "Demo G8 Math",
        subjectId: subject.id,
        gradeLevel: "G8",
      },
    });

    for (const member of [
      { userId: DEMO_SEED_IDS.teacherUserId, role: "TEACHER" as const },
      { userId: DEMO_SEED_IDS.studentUserId, role: "STUDENT" as const },
      { userId: DEMO_SEED_IDS.stableStudentUserId, role: "STUDENT" as const },
      {
        userId: DEMO_SEED_IDS.consolidatingStudentUserId,
        role: "STUDENT" as const,
      },
    ]) {
      await tx.classroomMember.upsert({
        where: {
          classroomId_userId: {
            classroomId: DEMO_SEED_IDS.classroomId,
            userId: member.userId,
          },
        },
        update: { role: member.role },
        create: {
          classroomId: DEMO_SEED_IDS.classroomId,
          userId: member.userId,
          role: member.role,
        },
      });
    }

    await tx.familyLink.upsert({
      where: {
        parentUserId_studentUserId: {
          parentUserId: DEMO_SEED_IDS.parentUserId,
          studentUserId: DEMO_SEED_IDS.studentUserId,
        },
      },
      update: { status: "ACTIVE", revokedAt: null },
      create: {
        parentUserId: DEMO_SEED_IDS.parentUserId,
        studentUserId: DEMO_SEED_IDS.studentUserId,
        status: "ACTIVE",
      },
    });

    const wallet = await tx.wallet.upsert({
      where: { userId: DEMO_SEED_IDS.teacherUserId },
      update: { balance: 200 },
      create: {
        id: IDS.walletId,
        userId: DEMO_SEED_IDS.teacherUserId,
        balance: 200,
      },
    });

    await tx.creditLedger.upsert({
      where: { idemKey: "demo:teacher:adjust-add:seed" },
      update: {
        walletId: wallet.id,
        kind: "ADJUST_ADD",
        delta: 200,
        balanceAfter: 200,
        actionKind: "DEMO_SEED_CREDIT",
        createdByUserId: DEMO_SEED_IDS.teacherUserId,
        metadata: { demo: true },
      },
      create: {
        id: IDS.creditLedgerId,
        walletId: wallet.id,
        kind: "ADJUST_ADD",
        delta: 200,
        balanceAfter: 200,
        idemKey: "demo:teacher:adjust-add:seed",
        actionKind: "DEMO_SEED_CREDIT",
        createdByUserId: DEMO_SEED_IDS.teacherUserId,
        metadata: { demo: true },
      },
    });

    const studentWallet = await tx.wallet.upsert({
      where: { userId: DEMO_SEED_IDS.studentUserId },
      update: { balance: 47 },
      create: {
        id: IDS.studentWalletId,
        userId: DEMO_SEED_IDS.studentUserId,
        balance: 47,
      },
    });

    await tx.creditLedger.upsert({
      where: { idemKey: "demo:student:adjust-add:seed" },
      update: {
        walletId: studentWallet.id,
        kind: "ADJUST_ADD",
        delta: 50,
        balanceAfter: 50,
        actionKind: "DEMO_SEED_CREDIT",
        createdByUserId: DEMO_SEED_IDS.studentUserId,
        metadata: { demo: true },
      },
      create: {
        id: IDS.studentCreditLedgerId,
        walletId: studentWallet.id,
        kind: "ADJUST_ADD",
        delta: 50,
        balanceAfter: 50,
        idemKey: "demo:student:adjust-add:seed",
        actionKind: "DEMO_SEED_CREDIT",
        createdByUserId: DEMO_SEED_IDS.studentUserId,
        metadata: { demo: true },
      },
    });

    const variantDebit = await tx.creditLedger.upsert({
      where: { idemKey: "demo:variant:debit:seed" },
      update: {
        walletId: studentWallet.id,
        kind: "DEBIT",
        delta: -3,
        balanceAfter: 47,
        actionKind: "VARIANT_GROUP_GEN",
        createdByUserId: DEMO_SEED_IDS.studentUserId,
        metadata: { demo: true, seeded: true },
      },
      create: {
        id: IDS.variantDebitLedgerId,
        walletId: studentWallet.id,
        kind: "DEBIT",
        delta: -3,
        balanceAfter: 47,
        idemKey: "demo:variant:debit:seed",
        actionKind: "VARIANT_GROUP_GEN",
        createdByUserId: DEMO_SEED_IDS.studentUserId,
        metadata: { demo: true, seeded: true },
      },
    });

    await tx.question.upsert({
      where: { id: IDS.questionId },
      update: {
        subjectId: subject.id,
        stemMd: "Solve the equation: 2x + 5 = 13.",
        type: "CALCULATION",
        difficulty: 2,
        status: "PUBLISHED",
        source: "DEMO_SEED",
        createdByUserId: DEMO_SEED_IDS.teacherUserId,
      },
      create: {
        id: IDS.questionId,
        subjectId: subject.id,
        stemMd: "Solve the equation: 2x + 5 = 13.",
        type: "CALCULATION",
        difficulty: 2,
        status: "PUBLISHED",
        source: "DEMO_SEED",
        createdByUserId: DEMO_SEED_IDS.teacherUserId,
      },
    });
    await tx.questionAnswer.upsert({
      where: { questionId: IDS.questionId },
      update: {
        contentMd: "x = 4",
        solutionMd: "Move 5 to the right side, then divide both sides by 2.",
      },
      create: {
        questionId: IDS.questionId,
        contentMd: "x = 4",
        solutionMd: "Move 5 to the right side, then divide both sides by 2.",
      },
    });
    await tx.questionKPLink.upsert({
      where: { questionId_kpId: { questionId: IDS.questionId, kpId: kp.id } },
      update: { weight: 1 },
      create: { questionId: IDS.questionId, kpId: kp.id, weight: 1 },
    });

    await tx.assignment.upsert({
      where: { id: IDS.assignmentId },
      update: {
        classroomId: DEMO_SEED_IDS.classroomId,
        teacherUserId: DEMO_SEED_IDS.teacherUserId,
        title: "Demo Linear Equations",
        status: "PUBLISHED",
        source: "DEMO_SEED",
        publishedAt,
      },
      create: {
        id: IDS.assignmentId,
        classroomId: DEMO_SEED_IDS.classroomId,
        teacherUserId: DEMO_SEED_IDS.teacherUserId,
        title: "Demo Linear Equations",
        status: "PUBLISHED",
        source: "DEMO_SEED",
        publishedAt,
      },
    });

    const tiers = [
      { id: IDS.tierBasicId, level: "BASIC" as const, title: "Basic" },
      {
        id: IDS.tierConsolidationId,
        level: "CONSOLIDATION" as const,
        title: "Consolidation",
      },
      { id: IDS.tierChallengeId, level: "CHALLENGE" as const, title: "Challenge" },
    ];
    for (const tier of tiers) {
      await tx.assignmentTier.upsert({
        where: {
          assignmentId_level: {
            assignmentId: IDS.assignmentId,
            level: tier.level,
          },
        },
        update: {
          title: tier.title,
          rationaleMd: `${tier.title} practice for demo placement.`,
        },
        create: {
          id: tier.id,
          assignmentId: IDS.assignmentId,
          level: tier.level,
          title: tier.title,
          rationaleMd: `${tier.title} practice for demo placement.`,
        },
      });
    }

    await tx.assignmentItem.upsert({
      where: {
        tierId_position: {
          tierId: IDS.tierConsolidationId,
          position: 1,
        },
      },
      update: {
        questionId: IDS.questionId,
        stemMd: "Solve the equation: 2x + 5 = 13.",
        type: "CALCULATION",
        answerMd: "x = 4",
        solutionMd: "Move 5 to the right side, then divide both sides by 2.",
        kpHints: ["Linear equations"],
      },
      create: {
        id: IDS.assignmentItemId,
        tierId: IDS.tierConsolidationId,
        questionId: IDS.questionId,
        position: 1,
        stemMd: "Solve the equation: 2x + 5 = 13.",
        type: "CALCULATION",
        answerMd: "x = 4",
        solutionMd: "Move 5 to the right side, then divide both sides by 2.",
        kpHints: ["Linear equations"],
      },
    });

    await tx.studentAssignment.upsert({
      where: {
        assignmentId_studentUserId: {
          assignmentId: IDS.assignmentId,
          studentUserId: DEMO_SEED_IDS.studentUserId,
        },
      },
      update: {
        tierId: IDS.tierConsolidationId,
        status: "SUBMITTED",
        suggestedTier: "CONSOLIDATION",
        submittedAt,
        gradedAt: null,
      },
      create: {
        id: IDS.studentAssignmentId,
        assignmentId: IDS.assignmentId,
        studentUserId: DEMO_SEED_IDS.studentUserId,
        tierId: IDS.tierConsolidationId,
        status: "SUBMITTED",
        suggestedTier: "CONSOLIDATION",
        submittedAt,
        gradedAt: null,
      },
    });

    await tx.errorBookEntry.upsert({
      where: { id: IDS.errorBookEntryId },
      update: {
        userId: DEMO_SEED_IDS.studentUserId,
        questionId: IDS.questionId,
        status: "ACTIVE",
        rootCause: "CALCULATION_SLIP",
        rootCauseReasoning: "Demo answer missed the inverse operation sequence.",
        actualAnswerMd: "x = 9",
        reviewCount: 0,
        nextReviewAt,
        lastReviewedAt: null,
      },
      create: {
        id: IDS.errorBookEntryId,
        userId: DEMO_SEED_IDS.studentUserId,
        questionId: IDS.questionId,
        status: "ACTIVE",
        rootCause: "CALCULATION_SLIP",
        rootCauseReasoning: "Demo answer missed the inverse operation sequence.",
        actualAnswerMd: "x = 9",
        reviewCount: 0,
        nextReviewAt,
      },
    });

    await tx.assignmentAnswer.upsert({
      where: {
        studentAssignmentId_itemId: {
          studentAssignmentId: IDS.studentAssignmentId,
          itemId: IDS.assignmentItemId,
        },
      },
      update: {
        answerJson: { text: "x = 9" },
        gradeStatus: "WRONG",
        teacherFeedbackMd: "Check how constants move across the equals sign.",
        errorBookEntryId: IDS.errorBookEntryId,
        gradedAt,
      },
      create: {
        id: IDS.assignmentAnswerId,
        studentAssignmentId: IDS.studentAssignmentId,
        itemId: IDS.assignmentItemId,
        answerJson: { text: "x = 9" },
        gradeStatus: "WRONG",
        teacherFeedbackMd: "Check how constants move across the equals sign.",
        errorBookEntryId: IDS.errorBookEntryId,
        gradedAt,
      },
    });

    await tx.assignmentPerformance.upsert({
      where: {
        assignmentId_studentUserId_itemId: {
          assignmentId: IDS.assignmentId,
          studentUserId: DEMO_SEED_IDS.studentUserId,
          itemId: IDS.assignmentItemId,
        },
      },
      update: { gradeStatus: "WRONG", kpIds: [kp.id] },
      create: {
        id: IDS.assignmentPerformanceId,
        assignmentId: IDS.assignmentId,
        studentUserId: DEMO_SEED_IDS.studentUserId,
        itemId: IDS.assignmentItemId,
        gradeStatus: "WRONG",
        kpIds: [kp.id],
      },
    });

    await tx.question.upsert({
      where: { id: IDS.variantQuestionId },
      update: {
        subjectId: subject.id,
        stemMd: "Solve the equation: 3x - 4 = 11.",
        type: "CALCULATION",
        difficulty: 2,
        status: "PUBLISHED",
        source: "VARIANT_GENERATED",
        createdByUserId: DEMO_SEED_IDS.studentUserId,
      },
      create: {
        id: IDS.variantQuestionId,
        subjectId: subject.id,
        stemMd: "Solve the equation: 3x - 4 = 11.",
        type: "CALCULATION",
        difficulty: 2,
        status: "PUBLISHED",
        source: "VARIANT_GENERATED",
        createdByUserId: DEMO_SEED_IDS.studentUserId,
      },
    });
    await tx.questionAnswer.upsert({
      where: { questionId: IDS.variantQuestionId },
      update: {
        contentMd: "x = 5",
        solutionMd: "Add 4 to both sides, then divide by 3.",
      },
      create: {
        questionId: IDS.variantQuestionId,
        contentMd: "x = 5",
        solutionMd: "Add 4 to both sides, then divide by 3.",
      },
    });

    await tx.variantGroup.upsert({
      where: { id: IDS.variantGroupId },
      update: {
        entryId: IDS.errorBookEntryId,
        userId: DEMO_SEED_IDS.studentUserId,
        creditsCost: 3,
        debitLedgerId: variantDebit.id,
        modelCallId: null,
      },
      create: {
        id: IDS.variantGroupId,
        entryId: IDS.errorBookEntryId,
        userId: DEMO_SEED_IDS.studentUserId,
        creditsCost: 3,
        debitLedgerId: variantDebit.id,
        modelCallId: null,
      },
    });

    await tx.variantItem.upsert({
      where: { questionId: IDS.variantQuestionId },
      update: {
        groupId: IDS.variantGroupId,
        level: "L1",
        position: 1,
        stemMd: "Solve the equation: 3x - 4 = 11.",
        solutionMd: "Add 4 to both sides, then divide by 3.",
        knowledgePointHints: ["Linear equations"],
      },
      create: {
        id: IDS.variantItemId,
        groupId: IDS.variantGroupId,
        questionId: IDS.variantQuestionId,
        level: "L1",
        position: 1,
        stemMd: "Solve the equation: 3x - 4 = 11.",
        solutionMd: "Add 4 to both sides, then divide by 3.",
        knowledgePointHints: ["Linear equations"],
      },
    });
  });
}

export async function verifyDemoData(
  prisma: DemoPrisma,
): Promise<DemoVerifyResult> {
  const checks: Array<[string, Promise<number>]> = [
    [
      "teacher user",
      prisma.user.count({ where: { id: DEMO_SEED_IDS.teacherUserId } }),
    ],
    [
      "student user",
      prisma.user.count({ where: { id: DEMO_SEED_IDS.studentUserId } }),
    ],
    [
      "parent user",
      prisma.user.count({ where: { id: DEMO_SEED_IDS.parentUserId } }),
    ],
    [
      "classroom",
      prisma.classroom.count({ where: { id: DEMO_SEED_IDS.classroomId } }),
    ],
    [
      "teacher wallet",
      prisma.wallet.count({ where: { userId: DEMO_SEED_IDS.teacherUserId } }),
    ],
    [
      "published assignment",
      prisma.assignment.count({
        where: { id: IDS.assignmentId, status: "PUBLISHED" },
      }),
    ],
    [
      "submitted student assignment",
      prisma.studentAssignment.count({
        where: {
          id: IDS.studentAssignmentId,
          studentUserId: DEMO_SEED_IDS.studentUserId,
          status: "SUBMITTED",
        },
      }),
    ],
    [
      "error book entry",
      prisma.errorBookEntry.count({
        where: { id: IDS.errorBookEntryId, status: "ACTIVE" },
      }),
    ],
    [
      "variant group",
      prisma.variantGroup.count({ where: { id: IDS.variantGroupId } }),
    ],
    [
      "assignment performance",
      prisma.assignmentPerformance.count({
        where: { id: IDS.assignmentPerformanceId },
      }),
    ],
    [
      "active family link",
      prisma.familyLink.count({
        where: {
          parentUserId: DEMO_SEED_IDS.parentUserId,
          studentUserId: DEMO_SEED_IDS.studentUserId,
          status: "ACTIVE",
        },
      }),
    ],
  ];

  const checked: string[] = [];
  for (const [label, countPromise] of checks) {
    const count = await countPromise;
    if (count !== 1) {
      throw new Error(`Demo data verification failed: ${label} count is ${count}`);
    }
    checked.push(label);
  }

  return { ok: true, checked };
}

async function upsertDemoUser(
  tx: Prisma.TransactionClient,
  user: {
    id: string;
    name: string;
    persona: "TEACHER" | "STUDENT" | "PARENT";
    gradeLevel: "G8" | null;
    isMinor: boolean;
  },
) {
  return tx.user.upsert({
    where: { id: user.id },
    update: {
      name: user.name,
      persona: user.persona,
      gradeLevel: user.gradeLevel,
      isMinor: user.isMinor,
      guardianConsentStatus: user.isMinor ? "GRANTED" : "NOT_REQUIRED",
      deletedAt: null,
      deactivationReason: null,
    },
    create: {
      id: user.id,
      name: user.name,
      persona: user.persona,
      gradeLevel: user.gradeLevel,
      isMinor: user.isMinor,
      guardianConsentStatus: user.isMinor ? "GRANTED" : "NOT_REQUIRED",
    },
  });
}
