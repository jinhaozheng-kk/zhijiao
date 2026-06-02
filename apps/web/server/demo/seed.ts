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
  kpId: "demo-kp-linear-function-equation",
  kpIntersectionId: "demo-kp-function-intersection",
  kpParameterId: "demo-kp-linear-parameter-method",
  walletId: "demo-wallet-teacher-01",
  studentWalletId: "demo-wallet-student-01",
  creditLedgerId: "demo-ledger-teacher-adjust-add-01",
  studentCreditLedgerId: "demo-ledger-student-adjust-add-01",
  variantDebitLedgerId: "demo-ledger-variant-debit-01",
  questionId: "demo-question-linear-01",
  questionIntersectionId: "demo-question-intersection-01",
  questionParameterId: "demo-question-parameter-01",
  variantQuestionL1Id: "demo-question-variant-linear-01",
  variantQuestionL2Id: "demo-question-variant-linear-l2-01",
  variantQuestionL3Id: "demo-question-variant-linear-l3-01",
  assignmentId: "demo-assignment-linear-01",
  tierBasicId: "demo-assignment-tier-basic-01",
  tierConsolidationId: "demo-assignment-tier-consolidation-01",
  tierChallengeId: "demo-assignment-tier-challenge-01",
  assignmentItemId: "demo-assignment-item-linear-01",
  studentAssignmentId: "demo-student-assignment-linear-01",
  assignmentAnswerId: "demo-assignment-answer-linear-01",
  assignmentPerformanceId: "demo-assignment-performance-linear-01",
  stableAssignmentPerformanceId: "demo-assignment-performance-stable-01",
  consolidatingAssignmentPerformanceId: "demo-assignment-performance-consolidating-01",
  errorBookEntryId: "demo-error-book-entry-linear-01",
  errorBookEntryReadingId: "demo-error-book-entry-reading-01",
  errorBookEntryTransferId: "demo-error-book-entry-transfer-01",
  variantGroupId: "demo-variant-group-linear-01",
  variantItemL1Id: "demo-variant-item-linear-01",
  variantItemL2Id: "demo-variant-item-linear-l2-01",
  variantItemL3Id: "demo-variant-item-linear-l3-01",
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
      update: { name: "数学" },
      create: { id: IDS.subjectId, code: "demo-math", name: "数学" },
    });

    const demoKps = [
      {
        id: IDS.kpIntersectionId,
        code: "demo-g8-function-intersection",
        name: "函数图像交点",
        description: "从图像交点理解两个一次函数或函数与坐标轴的关系。",
        difficulty: 2,
      },
      {
        id: IDS.kpParameterId,
        code: "demo-g8-linear-parameter-method",
        name: "待定系数法",
        description: "根据点或条件求一次函数解析式。",
        difficulty: 3,
      },
      {
        id: IDS.kpId,
        code: "demo-g8-linear-function-equation",
        name: "一次函数与一元一次方程关系",
        description: "用一次函数图像解释方程和不等式的解。",
        difficulty: 3,
      },
    ] as const;
    const seededKps = new Map<string, { id: string }>();
    for (const item of demoKps) {
      const kp = await tx.knowledgePoint.upsert({
        where: {
          subjectId_code: {
            subjectId: subject.id,
            code: item.code,
          },
        },
        update: {
          name: item.name,
          description: item.description,
          difficulty: item.difficulty,
        },
        create: {
          id: item.id,
          subjectId: subject.id,
          code: item.code,
          name: item.name,
          description: item.description,
          difficulty: item.difficulty,
        },
      });
      seededKps.set(item.id, kp);
    }
    const kp = seededKps.get(IDS.kpId)!;
    const kpIntersection = seededKps.get(IDS.kpIntersectionId)!;
    const kpParameter = seededKps.get(IDS.kpParameterId)!;

    await upsertDemoUser(tx, {
      id: DEMO_SEED_IDS.teacherUserId,
      name: "李老师",
      persona: "TEACHER",
      gradeLevel: null,
      isMinor: false,
    });
    await upsertDemoUser(tx, {
      id: DEMO_SEED_IDS.studentUserId,
      name: "周予安",
      persona: "STUDENT",
      gradeLevel: "G8",
      isMinor: true,
    });
    await upsertDemoUser(tx, {
      id: DEMO_SEED_IDS.stableStudentUserId,
      name: "林知夏",
      persona: "STUDENT",
      gradeLevel: "G8",
      isMinor: true,
    });
    await upsertDemoUser(tx, {
      id: DEMO_SEED_IDS.consolidatingStudentUserId,
      name: "陈一然",
      persona: "STUDENT",
      gradeLevel: "G8",
      isMinor: true,
    });
    await upsertDemoUser(tx, {
      id: DEMO_SEED_IDS.parentUserId,
      name: "周予安家长",
      persona: "PARENT",
      gradeLevel: null,
      isMinor: false,
    });

    await tx.classroom.upsert({
      where: { id: DEMO_SEED_IDS.classroomId },
      update: {
        name: "初二 3 班",
        subjectId: subject.id,
        gradeLevel: "G8",
      },
      create: {
        id: DEMO_SEED_IDS.classroomId,
        name: "初二 3 班",
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
        stemMd:
          "已知一次函数 y = 2x + 1，求它与 x 轴交点的横坐标，并说明这个横坐标与方程 2x + 1 = 0 的解有什么关系。",
        type: "CALCULATION",
        difficulty: 2,
        status: "PUBLISHED",
        source: "DEMO_SEED",
        createdByUserId: DEMO_SEED_IDS.teacherUserId,
      },
      create: {
        id: IDS.questionId,
        subjectId: subject.id,
        stemMd:
          "已知一次函数 y = 2x + 1，求它与 x 轴交点的横坐标，并说明这个横坐标与方程 2x + 1 = 0 的解有什么关系。",
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
        contentMd: "x = -1/2",
        solutionMd:
          "与 x 轴相交时 y = 0，所以 2x + 1 = 0，解得 x = -1/2。这个横坐标就是方程 2x + 1 = 0 的解。",
      },
      create: {
        questionId: IDS.questionId,
        contentMd: "x = -1/2",
        solutionMd:
          "与 x 轴相交时 y = 0，所以 2x + 1 = 0，解得 x = -1/2。这个横坐标就是方程 2x + 1 = 0 的解。",
      },
    });
    await tx.questionKPLink.upsert({
      where: { questionId_kpId: { questionId: IDS.questionId, kpId: kp.id } },
      update: { weight: 1 },
      create: { questionId: IDS.questionId, kpId: kp.id, weight: 1 },
    });

    const extraQuestions = [
      {
        id: IDS.questionIntersectionId,
        kpId: kpIntersection.id,
        stemMd:
          "一次函数 y = -x + 4 与 y = x 的图像交于点 A，求点 A 的坐标。",
        answerMd: "A(2, 2)",
        solutionMd:
          "交点处两个函数的 y 值相等，列 -x + 4 = x，解得 x = 2，代入 y = x 得 y = 2。",
        difficulty: 3,
      },
      {
        id: IDS.questionParameterId,
        kpId: kpParameter.id,
        stemMd:
          "一次函数 y = kx + b 经过点 (0, 1) 和 (2, 5)，求 k、b 的值。",
        answerMd: "k = 2，b = 1",
        solutionMd:
          "由 (0, 1) 得 b = 1；代入 (2, 5) 得 2k + 1 = 5，所以 k = 2。",
        difficulty: 3,
      },
    ] as const;
    for (const item of extraQuestions) {
      await tx.question.upsert({
        where: { id: item.id },
        update: {
          subjectId: subject.id,
          stemMd: item.stemMd,
          type: "CALCULATION",
          difficulty: item.difficulty,
          status: "PUBLISHED",
          source: "DEMO_SEED",
          createdByUserId: DEMO_SEED_IDS.teacherUserId,
        },
        create: {
          id: item.id,
          subjectId: subject.id,
          stemMd: item.stemMd,
          type: "CALCULATION",
          difficulty: item.difficulty,
          status: "PUBLISHED",
          source: "DEMO_SEED",
          createdByUserId: DEMO_SEED_IDS.teacherUserId,
        },
      });
      await tx.questionAnswer.upsert({
        where: { questionId: item.id },
        update: {
          contentMd: item.answerMd,
          solutionMd: item.solutionMd,
        },
        create: {
          questionId: item.id,
          contentMd: item.answerMd,
          solutionMd: item.solutionMd,
        },
      });
      await tx.questionKPLink.upsert({
        where: { questionId_kpId: { questionId: item.id, kpId: item.kpId } },
        update: { weight: 1 },
        create: { questionId: item.id, kpId: item.kpId, weight: 1 },
      });
    }

    await tx.assignment.upsert({
      where: { id: IDS.assignmentId },
      update: {
        classroomId: DEMO_SEED_IDS.classroomId,
        teacherUserId: DEMO_SEED_IDS.teacherUserId,
        title: "一次函数与方程关系分层练习",
        status: "PUBLISHED",
        source: "DEMO_SEED",
        publishedAt,
      },
      create: {
        id: IDS.assignmentId,
        classroomId: DEMO_SEED_IDS.classroomId,
        teacherUserId: DEMO_SEED_IDS.teacherUserId,
        title: "一次函数与方程关系分层练习",
        status: "PUBLISHED",
        source: "DEMO_SEED",
        publishedAt,
      },
    });

    const tiers = [
      {
        id: IDS.tierBasicId,
        level: "BASIC" as const,
        title: "基础层",
        rationaleMd: "先稳住图像与方程的对应关系。",
      },
      {
        id: IDS.tierConsolidationId,
        level: "CONSOLIDATION" as const,
        title: "巩固层",
        rationaleMd: "重点练习从函数图像条件列方程。",
      },
      {
        id: IDS.tierChallengeId,
        level: "CHALLENGE" as const,
        title: "挑战层",
        rationaleMd: "加入不等式和交点迁移，观察解集含义。",
      },
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
          rationaleMd: tier.rationaleMd,
        },
        create: {
          id: tier.id,
          assignmentId: IDS.assignmentId,
          level: tier.level,
          title: tier.title,
          rationaleMd: tier.rationaleMd,
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
        stemMd:
          "已知一次函数 y = 2x + 1，求它与 x 轴交点的横坐标，并说明这个横坐标与方程 2x + 1 = 0 的解有什么关系。",
        type: "CALCULATION",
        answerMd: "x = -1/2",
        solutionMd:
          "与 x 轴相交时 y = 0，所以 2x + 1 = 0，解得 x = -1/2。这个横坐标就是方程 2x + 1 = 0 的解。",
        kpHints: ["一次函数与一元一次方程关系"],
      },
      create: {
        id: IDS.assignmentItemId,
        tierId: IDS.tierConsolidationId,
        questionId: IDS.questionId,
        position: 1,
        stemMd:
          "已知一次函数 y = 2x + 1，求它与 x 轴交点的横坐标，并说明这个横坐标与方程 2x + 1 = 0 的解有什么关系。",
        type: "CALCULATION",
        answerMd: "x = -1/2",
        solutionMd:
          "与 x 轴相交时 y = 0，所以 2x + 1 = 0，解得 x = -1/2。这个横坐标就是方程 2x + 1 = 0 的解。",
        kpHints: ["一次函数与一元一次方程关系"],
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
        rootCauseReasoning:
          "把与 x 轴相交的条件 y = 0 漏掉了，直接把常数项当成横坐标。",
        actualAnswerMd: "x = 1",
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
        rootCauseReasoning:
          "把与 x 轴相交的条件 y = 0 漏掉了，直接把常数项当成横坐标。",
        actualAnswerMd: "x = 1",
        reviewCount: 0,
        nextReviewAt,
      },
    });

    const extraEntries = [
      {
        id: IDS.errorBookEntryReadingId,
        questionId: IDS.questionIntersectionId,
        rootCause: "READING_ERROR" as const,
        rootCauseReasoning:
          "读题时只代入了其中一个函数，忽略交点处两个函数值相等。",
        actualAnswerMd: "A(4, 4)",
      },
      {
        id: IDS.errorBookEntryTransferId,
        questionId: IDS.questionParameterId,
        rootCause: "TRANSFER_GAP" as const,
        rootCauseReasoning:
          "能代入点坐标，但没有把两个条件合并成待定系数过程。",
        actualAnswerMd: "k = 5，b = 1",
      },
    ] as const;
    for (const entry of extraEntries) {
      await tx.errorBookEntry.upsert({
        where: { id: entry.id },
        update: {
          userId: DEMO_SEED_IDS.studentUserId,
          questionId: entry.questionId,
          status: "ACTIVE",
          rootCause: entry.rootCause,
          rootCauseReasoning: entry.rootCauseReasoning,
          actualAnswerMd: entry.actualAnswerMd,
          reviewCount: 0,
          nextReviewAt,
          lastReviewedAt: null,
        },
        create: {
          id: entry.id,
          userId: DEMO_SEED_IDS.studentUserId,
          questionId: entry.questionId,
          status: "ACTIVE",
          rootCause: entry.rootCause,
          rootCauseReasoning: entry.rootCauseReasoning,
          actualAnswerMd: entry.actualAnswerMd,
          reviewCount: 0,
          nextReviewAt,
        },
      });
    }

    await tx.assignmentAnswer.upsert({
      where: {
        studentAssignmentId_itemId: {
          studentAssignmentId: IDS.studentAssignmentId,
          itemId: IDS.assignmentItemId,
        },
      },
      update: {
        answerJson: { text: "x = 1" },
        gradeStatus: "WRONG",
        teacherFeedbackMd: "先写出 y = 0，再把交点横坐标和方程的解对应起来。",
        errorBookEntryId: IDS.errorBookEntryId,
        gradedAt,
      },
      create: {
        id: IDS.assignmentAnswerId,
        studentAssignmentId: IDS.studentAssignmentId,
        itemId: IDS.assignmentItemId,
        answerJson: { text: "x = 1" },
        gradeStatus: "WRONG",
        teacherFeedbackMd: "先写出 y = 0，再把交点横坐标和方程的解对应起来。",
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

    const extraPerformance = [
      {
        id: IDS.stableAssignmentPerformanceId,
        studentUserId: DEMO_SEED_IDS.stableStudentUserId,
        gradeStatus: "CORRECT" as const,
        kpIds: [kp.id, kpIntersection.id],
      },
      {
        id: IDS.consolidatingAssignmentPerformanceId,
        studentUserId: DEMO_SEED_IDS.consolidatingStudentUserId,
        gradeStatus: "PARTIAL" as const,
        kpIds: [kp.id, kpParameter.id],
      },
    ] as const;
    for (const item of extraPerformance) {
      await tx.assignmentPerformance.upsert({
        where: {
          assignmentId_studentUserId_itemId: {
            assignmentId: IDS.assignmentId,
            studentUserId: item.studentUserId,
            itemId: IDS.assignmentItemId,
          },
        },
        update: { gradeStatus: item.gradeStatus, kpIds: [...item.kpIds] },
        create: {
          id: item.id,
          assignmentId: IDS.assignmentId,
          studentUserId: item.studentUserId,
          itemId: IDS.assignmentItemId,
          gradeStatus: item.gradeStatus,
          kpIds: [...item.kpIds],
        },
      });
    }

    const variantGroup = await tx.variantGroup.upsert({
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

    const variants = [
      {
        itemId: IDS.variantItemL1Id,
        questionId: IDS.variantQuestionL1Id,
        level: "L1" as const,
        position: 1,
        stemMd:
          "L1：已知一次函数 y = 3x - 6，求它与 x 轴交点的横坐标，并说明它对应哪个方程的解。",
        answerMd: "x = 2，对应方程 3x - 6 = 0 的解。",
        solutionMd:
          "与 x 轴相交时 y = 0，列 3x - 6 = 0，解得 x = 2。",
        hints: ["一次函数与一元一次方程关系"],
        kpId: kp.id,
      },
      {
        itemId: IDS.variantItemL2Id,
        questionId: IDS.variantQuestionL2Id,
        level: "L2" as const,
        position: 2,
        stemMd:
          "L2：一次函数 y = -2x + 4 的图像在 x 轴上方时，x 的取值范围是什么？",
        answerMd: "x < 2",
        solutionMd:
          "图像在 x 轴上方表示 y > 0，所以 -2x + 4 > 0，解得 x < 2。",
        hints: ["一次函数与一元一次方程关系", "函数图像交点"],
        kpId: kpIntersection.id,
      },
      {
        itemId: IDS.variantItemL3Id,
        questionId: IDS.variantQuestionL3Id,
        level: "L3" as const,
        position: 3,
        stemMd:
          "L3：某校打印资料的总费用 y 元与页数 x 满足 y = 0.5x + 3。如果预算不超过 15 元，最多能打印多少页？",
        answerMd: "最多 24 页。",
        solutionMd:
          "预算不超过 15 元表示 0.5x + 3 <= 15，解得 x <= 24，所以最多打印 24 页。",
        hints: ["一次函数与一元一次方程关系", "待定系数法"],
        kpId: kpParameter.id,
      },
    ] as const;
    for (const variant of variants) {
      await tx.question.upsert({
        where: { id: variant.questionId },
        update: {
          subjectId: subject.id,
          stemMd: variant.stemMd,
          type: "CALCULATION",
          difficulty: variant.position + 1,
          status: "PUBLISHED",
          source: "VARIANT_GENERATED",
          createdByUserId: DEMO_SEED_IDS.studentUserId,
        },
        create: {
          id: variant.questionId,
          subjectId: subject.id,
          stemMd: variant.stemMd,
          type: "CALCULATION",
          difficulty: variant.position + 1,
          status: "PUBLISHED",
          source: "VARIANT_GENERATED",
          createdByUserId: DEMO_SEED_IDS.studentUserId,
        },
      });
      await tx.questionAnswer.upsert({
        where: { questionId: variant.questionId },
        update: {
          contentMd: variant.answerMd,
          solutionMd: variant.solutionMd,
        },
        create: {
          questionId: variant.questionId,
          contentMd: variant.answerMd,
          solutionMd: variant.solutionMd,
        },
      });
      await tx.questionKPLink.upsert({
        where: {
          questionId_kpId: { questionId: variant.questionId, kpId: variant.kpId },
        },
        update: { weight: 1 },
        create: { questionId: variant.questionId, kpId: variant.kpId, weight: 1 },
      });
      await tx.variantItem.upsert({
        where: { questionId: variant.questionId },
        update: {
          groupId: variantGroup.id,
          level: variant.level,
          position: variant.position,
          stemMd: variant.stemMd,
          solutionMd: variant.solutionMd,
          knowledgePointHints: [...variant.hints],
        },
        create: {
          id: variant.itemId,
          groupId: variantGroup.id,
          questionId: variant.questionId,
          level: variant.level,
          position: variant.position,
          stemMd: variant.stemMd,
          solutionMd: variant.solutionMd,
          knowledgePointHints: [...variant.hints],
        },
      });
    }
  });
}

export async function verifyDemoData(
  prisma: DemoPrisma,
): Promise<DemoVerifyResult> {
  const checks: Array<[string, Promise<number>, number]> = [
    [
      "teacher user",
      prisma.user.count({ where: { id: DEMO_SEED_IDS.teacherUserId } }),
      1,
    ],
    [
      "student user",
      prisma.user.count({ where: { id: DEMO_SEED_IDS.studentUserId } }),
      1,
    ],
    [
      "parent user",
      prisma.user.count({ where: { id: DEMO_SEED_IDS.parentUserId } }),
      1,
    ],
    [
      "classroom",
      prisma.classroom.count({ where: { id: DEMO_SEED_IDS.classroomId } }),
      1,
    ],
    [
      "teacher wallet",
      prisma.wallet.count({ where: { userId: DEMO_SEED_IDS.teacherUserId } }),
      1,
    ],
    [
      "demo knowledge points",
      prisma.knowledgePoint.count({
        where: { subjectId: IDS.subjectId, code: { startsWith: "demo-g8-" } },
      }),
      3,
    ],
    [
      "published assignment",
      prisma.assignment.count({
        where: { id: IDS.assignmentId, status: "PUBLISHED" },
      }),
      1,
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
      1,
    ],
    [
      "error book entries",
      prisma.errorBookEntry.count({
        where: { userId: DEMO_SEED_IDS.studentUserId, status: "ACTIVE" },
      }),
      3,
    ],
    [
      "variant group",
      prisma.variantGroup.count({ where: { id: IDS.variantGroupId } }),
      1,
    ],
    [
      "variant items",
      prisma.variantItem.count({
        where: { group: { userId: DEMO_SEED_IDS.studentUserId } },
      }),
      3,
    ],
    [
      "assignment performance rows",
      prisma.assignmentPerformance.count({
        where: { assignmentId: IDS.assignmentId },
      }),
      3,
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
      1,
    ],
  ];

  const checked: string[] = [];
  for (const [label, countPromise, minimum] of checks) {
    const count = await countPromise;
    if (count < minimum) {
      throw new Error(
        `Demo data verification failed: ${label} count is ${count}, expected at least ${minimum}`,
      );
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
