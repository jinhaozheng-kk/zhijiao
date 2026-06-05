import { type Prisma, type PrismaClient } from "@prisma/client";

type DbClient = PrismaClient | Prisma.TransactionClient;

export interface DeactivatePayload {
  scrubbed: {
    sessions: number;
    topupOrders: number;
    modelCalls: number;
    kpAliases: number;
    kpReconcileMatches: number;
    variantGeneratedQuestions: number;
    paperGeneratedQuestions: number;
    authIdentities: number;
    otpRequests: number;
    dsarRequests: number;
  };
  deleted: {
    errorBookEntries: number;
    variantGroups: number;
    variantItems: number;
    userAdhocQuestions: number;
    assignmentAnswers: number;
    assignmentPerformance: number;
    studentAssignments: number;
    papers: number;
    coursewares: number;
    familyLinks: number;
    guardianConsentsAsChild: number;
    guardianConsentsAsGuardian: number;
  };
  dryRun: boolean;
}

export interface DeactivateResult {
  alreadyDeactivated: boolean;
  payload: DeactivatePayload;
}

export interface UserDataExport {
  schemaVersion: "2026-05-31";
  exportedAt: string;
  userId: string;
  user: {
    name: string | null;
    avatarUrl: string | null;
    persona: string;
    gradeLevel: string | null;
    isMinor: boolean;
    birthYear: number | null;
    createdAt: Date;
    deletedAt: Date | null;
    deactivationReason: string | null;
  };
  authIdentities: Array<{
    provider: string;
    providerScope: string;
    providerUserIdMasked: string;
    createdAt: Date;
    lastUsedAt: Date | null;
  }>;
  wallet: { id: string; balance: number; createdAt: Date } | null;
  creditLedger: Array<{
    kind: string;
    delta: number;
    balanceAfter: number;
    actionKind: string | null;
    createdAt: Date;
    refTable: string | null;
    refId: string | null;
    idemKey: string;
  }>;
  topupOrders: Array<{
    outTradeNo: string;
    amountCents: number;
    credits: number;
    status: string;
    transactionId: string | null;
    paidAt: Date | null;
    expiredAt: Date;
    createdAt: Date;
  }>;
  errorBookEntries: Array<{
    id: string;
    questionId: string;
    status: string;
    rootCause: string;
    rootCauseReasoning: string;
    actualAnswerMd: string | null;
    reviewCount: number;
    nextReviewAt: Date | null;
    createdAt: Date;
  }>;
  userAdhocQuestions: Array<{
    id: string;
    stemMd: string;
    type: string;
    normalizedStemHash: string | null;
    createdAt: Date;
  }>;
  modelCalls: Array<{
    taskKind: string;
    status: string;
    latencyMs: number | null;
    tokensIn: number | null;
    tokensOut: number | null;
    createdAt: Date;
  }>;
  studentAssignments: Array<{
    id: string;
    assignmentId: string;
    tierId: string;
    status: string;
    suggestedTier: string | null;
    tierOverrideReason: string | null;
    submittedAt: Date | null;
    gradedAt: Date | null;
    createdAt: Date;
  }>;
  assignmentAnswers: Array<{
    id: string;
    studentAssignmentId: string;
    itemId: string;
    answerJson: Prisma.JsonValue;
    gradeStatus: string;
    teacherFeedbackMd: string | null;
    errorBookEntryId: string | null;
    gradedAt: Date | null;
  }>;
  assignmentPerformance: Array<{
    id: string;
    assignmentId: string;
    studentUserId: string;
    itemId: string;
    gradeStatus: string;
    kpIds: string[];
    createdAt: Date;
  }>;
  papers: Array<{
    id: string;
    title: string;
    status: string;
    paramsJson: Prisma.JsonValue;
    createdAt: Date;
    items: Array<{
      position: number;
      source: string;
      stemMd: string;
      type: string;
      answerMd: string;
      solutionMd: string;
      points: number;
      difficulty: number;
      cognitiveLevel: string;
      kpHints: string[];
    }>;
  }>;
  coursewares: Array<{
    id: string;
    title: string;
    status: string;
    gradeLevel: string | null;
    createdAt: Date;
    sections: Array<{
      position: number;
      type: string;
      title: string;
      contentMd: string;
    }>;
  }>;
  familyLinks: Array<{
    id: string;
    role: "parent" | "student";
    counterpartUserId: string;
    status: string;
    createdAt: Date;
  }>;
  guardianConsents: Array<{
    consentScope: string;
    method: string;
    consentedAt: Date;
    revokedAt: Date | null;
    guardianUserId: string;
  }>;
  dsarRequests: Array<{
    type: string;
    status: string;
    requestedAt: Date;
    dueAt: Date;
    resolvedAt: Date | null;
  }>;
}

export type SweepBucket = "short" | "medium" | "orphan";

export interface SweepResult {
  bucket: SweepBucket;
  table: string;
  affected: number;
  dryRun: boolean;
  hasMore: boolean;
}

export async function sweepPii(
  prisma: PrismaClient,
  args: {
    bucket: SweepBucket | "all";
    shortDays: number;
    mediumDays: number;
    orphanDays: number;
    now?: Date;
    dryRun?: boolean;
    operatorId?: string | null;
    initiatorRef?: string;
  },
): Promise<SweepResult[]> {
  const now = args.now ?? new Date();
  const dryRun = args.dryRun ?? false;
  const buckets: SweepBucket[] =
    args.bucket === "all" ? ["short", "medium", "orphan"] : [args.bucket];
  const results: SweepResult[] = [];

  for (const bucket of buckets) {
    const bucketResults =
      bucket === "short"
        ? await sweepShort(prisma, { now, days: args.shortDays, dryRun })
        : bucket === "medium"
          ? await sweepMedium(prisma, { now, days: args.mediumDays, dryRun })
          : await sweepOrphan(prisma, { now, days: args.orphanDays, dryRun });
    results.push(...bucketResults);
    if (!dryRun) {
      await prisma.opsActionLog.create({
        data: {
          kind:
            bucket === "short"
              ? "GC_SWEEP_SHORT"
              : bucket === "medium"
                ? "GC_SWEEP_MEDIUM"
                : "GC_SWEEP_ORPHAN",
          initiatorId: args.operatorId ?? null,
          initiatorRef: args.initiatorRef ?? "cli:unknown-host:unknown-user",
          targetUserId: null,
          payload: { results: bucketResults } as unknown as Prisma.InputJsonObject,
        },
      });
    }
  }

  return results;
}

export async function exportUserData(
  prisma: DbClient,
  userId: string,
): Promise<UserDataExport> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      avatarUrl: true,
      persona: true,
      gradeLevel: true,
      isMinor: true,
      birthYear: true,
      createdAt: true,
      deletedAt: true,
      deactivationReason: true,
    },
  });
  if (!user) {
    throw new Error(`User not found: ${userId}`);
  }

  const [
    authIdentities,
    wallet,
    topupOrders,
    errorBookEntries,
    userAdhocQuestions,
    modelCalls,
    studentAssignments,
    assignmentAnswers,
    assignmentPerformance,
    papers,
    coursewares,
    familyLinks,
    guardianConsents,
    dsarRequests,
  ] = await Promise.all([
    prisma.authIdentity.findMany({
      where: { userId },
      orderBy: { createdAt: "asc" },
      select: {
        provider: true,
        providerScope: true,
        providerUserId: true,
        createdAt: true,
        lastUsedAt: true,
      },
    }),
    prisma.wallet.findUnique({
      where: { userId },
      select: {
        id: true,
        balance: true,
        createdAt: true,
        ledger: {
          orderBy: { createdAt: "asc" },
          select: {
            kind: true,
            delta: true,
            balanceAfter: true,
            actionKind: true,
            createdAt: true,
            refTable: true,
            refId: true,
            idemKey: true,
          },
        },
      },
    }),
    prisma.topupOrder.findMany({
      where: { userId },
      orderBy: { createdAt: "asc" },
      select: {
        outTradeNo: true,
        amountCents: true,
        credits: true,
        status: true,
        transactionId: true,
        paidAt: true,
        expiredAt: true,
        createdAt: true,
      },
    }),
    prisma.errorBookEntry.findMany({
      where: { userId, status: { in: ["ACTIVE", "ARCHIVED"] } },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        questionId: true,
        status: true,
        rootCause: true,
        rootCauseReasoning: true,
        actualAnswerMd: true,
        reviewCount: true,
        nextReviewAt: true,
        createdAt: true,
      },
    }),
    prisma.question.findMany({
      where: { source: "USER_ADHOC", createdByUserId: userId },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        stemMd: true,
        type: true,
        normalizedStemHash: true,
        createdAt: true,
      },
    }),
    prisma.modelCall.findMany({
      where: { userId },
      orderBy: { createdAt: "asc" },
      select: {
        taskKind: true,
        status: true,
        latencyMs: true,
        tokensIn: true,
        tokensOut: true,
        createdAt: true,
      },
    }),
    prisma.studentAssignment.findMany({
      where: { studentUserId: userId },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        assignmentId: true,
        tierId: true,
        status: true,
        suggestedTier: true,
        tierOverrideReason: true,
        submittedAt: true,
        gradedAt: true,
        createdAt: true,
      },
    }),
    prisma.assignmentAnswer.findMany({
      where: { studentAssignment: { studentUserId: userId } },
      orderBy: { id: "asc" },
      select: {
        id: true,
        studentAssignmentId: true,
        itemId: true,
        answerJson: true,
        gradeStatus: true,
        teacherFeedbackMd: true,
        errorBookEntryId: true,
        gradedAt: true,
      },
    }),
    prisma.assignmentPerformance.findMany({
      where: { studentUserId: userId },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        assignmentId: true,
        studentUserId: true,
        itemId: true,
        gradeStatus: true,
        kpIds: true,
        createdAt: true,
      },
    }),
    prisma.paper.findMany({
      where: { teacherUserId: userId },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        title: true,
        status: true,
        paramsJson: true,
        createdAt: true,
        items: {
          orderBy: { position: "asc" },
          select: {
            position: true,
            source: true,
            stemMd: true,
            type: true,
            answerMd: true,
            solutionMd: true,
            points: true,
            difficulty: true,
            cognitiveLevel: true,
            kpHints: true,
          },
        },
      },
    }),
    prisma.courseware.findMany({
      where: { teacherUserId: userId },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        title: true,
        status: true,
        gradeLevel: true,
        createdAt: true,
        sections: {
          orderBy: { position: "asc" },
          select: {
            position: true,
            type: true,
            title: true,
            contentMd: true,
          },
        },
      },
    }),
    prisma.familyLink.findMany({
      where: { OR: [{ parentUserId: userId }, { studentUserId: userId }] },
      orderBy: { createdAt: "asc" },
      select: { id: true, parentUserId: true, studentUserId: true, status: true, createdAt: true },
    }),
    prisma.guardianConsent.findMany({
      where: { childUserId: userId },
      orderBy: { createdAt: "asc" },
      select: { guardianUserId: true, consentScope: true, method: true, consentedAt: true, revokedAt: true },
    }),
    prisma.dsarRequest.findMany({
      where: { userId },
      orderBy: { createdAt: "asc" },
      select: { type: true, status: true, requestedAt: true, dueAt: true, resolvedAt: true },
    }),
  ]);

  return {
    schemaVersion: "2026-05-31",
    exportedAt: new Date().toISOString(),
    userId: user.id,
    user: {
      name: user.name,
      avatarUrl: user.avatarUrl,
      persona: user.persona,
      gradeLevel: user.gradeLevel,
      isMinor: user.isMinor,
      birthYear: user.birthYear,
      createdAt: user.createdAt,
      deletedAt: user.deletedAt,
      deactivationReason: user.deactivationReason,
    },
    authIdentities: authIdentities.map((identity) => ({
      provider: identity.provider,
      providerScope: identity.providerScope,
      providerUserIdMasked: maskProviderUserId(identity.provider, identity.providerUserId),
      createdAt: identity.createdAt,
      lastUsedAt: identity.lastUsedAt,
    })),
    wallet: wallet
      ? { id: wallet.id, balance: wallet.balance, createdAt: wallet.createdAt }
      : null,
    creditLedger: wallet?.ledger ?? [],
    topupOrders,
    errorBookEntries,
    userAdhocQuestions,
    modelCalls,
    studentAssignments,
    assignmentAnswers,
    assignmentPerformance,
    papers,
    coursewares: coursewares.map((cw) => ({
      id: cw.id,
      title: cw.title,
      status: cw.status,
      gradeLevel: cw.gradeLevel,
      createdAt: cw.createdAt,
      sections: cw.sections,
    })),
    familyLinks: familyLinks.map((l) => ({
      id: l.id,
      role: l.parentUserId === userId ? ("parent" as const) : ("student" as const),
      counterpartUserId: l.parentUserId === userId ? l.studentUserId : l.parentUserId,
      status: l.status,
      createdAt: l.createdAt,
    })),
    guardianConsents: guardianConsents.map((c) => ({
      consentScope: c.consentScope,
      method: c.method,
      consentedAt: c.consentedAt,
      revokedAt: c.revokedAt,
      guardianUserId: maskProviderUserId("USER", c.guardianUserId),
    })),
    dsarRequests,
  };
}

function cutoff(now: Date, days: number): Date {
  return new Date(now.getTime() - days * 86_400_000);
}

async function sweepShort(
  prisma: PrismaClient,
  args: { now: Date; days: number; dryRun: boolean },
): Promise<SweepResult[]> {
  const before = cutoff(args.now, args.days);
  const otpWhere = {
    OR: [
      { consumedAt: { not: null, lt: before } },
      { consumedAt: null, expiredAt: { not: null, lt: before } },
    ],
  } satisfies Prisma.OtpRequestWhereInput;
  const sessionWhere = {
    OR: [
      { revokedAt: { not: null, lt: before } },
      { revokedAt: null, expiresAt: { lt: before } },
    ],
  } satisfies Prisma.SessionWhereInput;

  const otpCount = args.dryRun
    ? await prisma.otpRequest.count({ where: otpWhere })
    : (await prisma.otpRequest.deleteMany({ where: otpWhere })).count;
  const sessionCount = args.dryRun
    ? await prisma.session.count({ where: sessionWhere })
    : (await prisma.session.deleteMany({ where: sessionWhere })).count;

  return [
    { bucket: "short", table: "otp_requests", affected: otpCount, dryRun: args.dryRun, hasMore: false },
    { bucket: "short", table: "sessions", affected: sessionCount, dryRun: args.dryRun, hasMore: false },
  ];
}

async function sweepMedium(
  prisma: PrismaClient,
  args: { now: Date; days: number; dryRun: boolean },
): Promise<SweepResult[]> {
  const before = cutoff(args.now, args.days);
  const rawWhere = {
    createdAt: { lt: before },
    rawBody: { not: null },
  } satisfies Prisma.WechatPayEventWhereInput;
  const topupWhere = {
    status: { in: ["PAID", "FAILED", "EXPIRED"] },
    updatedAt: { lt: before },
    OR: [{ ipCreated: { not: null } }, { userAgent: { not: null } }],
  } satisfies Prisma.TopupOrderWhereInput;

  const rawCount = args.dryRun
    ? await prisma.wechatPayEvent.count({ where: rawWhere })
    : (await prisma.wechatPayEvent.updateMany({ where: rawWhere, data: { rawBody: null } })).count;
  const topupCount = args.dryRun
    ? await prisma.topupOrder.count({ where: topupWhere })
    : (await prisma.topupOrder.updateMany({
        where: topupWhere,
        data: { ipCreated: null, userAgent: null },
      })).count;

  return [
    { bucket: "medium", table: "wechat_pay_events", affected: rawCount, dryRun: args.dryRun, hasMore: false },
    { bucket: "medium", table: "topup_orders", affected: topupCount, dryRun: args.dryRun, hasMore: false },
  ];
}

async function sweepOrphan(
  prisma: PrismaClient,
  args: { now: Date; days: number; dryRun: boolean },
): Promise<SweepResult[]> {
  const before = cutoff(args.now, args.days);
  if (args.dryRun) {
    const rows = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint AS count
      FROM "topup_orders" t
      WHERE t."status" = 'EXPIRED'
        AND t."paid_at" IS NULL
        AND t."created_at" < ${before}
        AND NOT EXISTS (
          SELECT 1 FROM "credit_ledger" l
          WHERE l."ref_table" = 'topup_orders' AND l."ref_id" = t."id"
        )
    `;
    return [
      {
        bucket: "orphan",
        table: "topup_orders_orphan",
        affected: Number(rows[0]?.count ?? 0),
        dryRun: true,
        hasMore: false,
      },
    ];
  }

  const affected = await prisma.$executeRaw`
    DELETE FROM "topup_orders" t
    WHERE t."status" = 'EXPIRED'
      AND t."paid_at" IS NULL
      AND t."created_at" < ${before}
      AND NOT EXISTS (
        SELECT 1 FROM "credit_ledger" l
        WHERE l."ref_table" = 'topup_orders' AND l."ref_id" = t."id"
      )
  `;
  return [
    {
      bucket: "orphan",
      table: "topup_orders_orphan",
      affected,
      dryRun: false,
      hasMore: false,
    },
  ];
}

export async function previewDeactivateUser(
  prisma: DbClient,
  userId: string,
): Promise<DeactivateResult> {
  const plan = await buildDeactivatePlan(prisma, userId);
  return {
    alreadyDeactivated: plan.alreadyDeactivated,
    payload: { ...plan.payload, dryRun: true },
  };
}

export async function deactivateUser(
  prisma: PrismaClient,
  args: {
    userId: string;
    operatorId: string | null;
    initiatorRef: string;
    reason?: string;
    dryRun?: boolean;
  },
): Promise<DeactivateResult> {
  if (args.dryRun) {
    return previewDeactivateUser(prisma, args.userId);
  }

  return prisma.$transaction(async (tx) => {
    const plan = await buildDeactivatePlan(tx, args.userId);
    if (plan.alreadyDeactivated) {
      return {
        alreadyDeactivated: true,
        payload: { ...plan.payload, dryRun: false },
      };
    }

    const now = new Date();

    await tx.errorBookEntry.deleteMany({ where: { userId: args.userId } });
    await tx.question.deleteMany({
      where: { source: "USER_ADHOC", createdByUserId: args.userId },
    });

    const authIdentities = await tx.authIdentity.deleteMany({
      where: { userId: args.userId },
    });

    const otpRequests = plan.phoneNumbers.length
      ? await tx.otpRequest.deleteMany({ where: { phone: { in: plan.phoneNumbers } } })
      : { count: 0 };

    await tx.session.updateMany({
      where: { userId: args.userId, revokedAt: null },
      data: { revokedAt: now, revokedReason: "ADMIN_REVOKED" },
    });
    const sessions = await tx.session.updateMany({
      where: { userId: args.userId },
      data: { deviceLabel: null, ipCreated: null, userAgent: null },
    });

    const topupOrders = await tx.topupOrder.updateMany({
      where: { userId: args.userId },
      data: { ipCreated: null, userAgent: null },
    });
    const modelCalls = await tx.modelCall.updateMany({
      where: { userId: args.userId },
      data: { userId: null },
    });
    const kpAliases = await tx.kpAlias.updateMany({
      where: { createdByUserId: args.userId },
      data: { createdByUserId: null },
    });
    const kpReconcileMatches = await tx.kpReconcileMatch.updateMany({
      where: { reviewedByUserId: args.userId },
      data: { reviewedByUserId: null },
    });
    const variantGeneratedQuestions = await tx.question.updateMany({
      where: { source: "VARIANT_GENERATED", createdByUserId: args.userId },
      data: { createdByUserId: null },
    });
    const papers = await tx.paper.deleteMany({
      where: { teacherUserId: args.userId },
    });
    const coursewares = await tx.courseware.deleteMany({
      where: { teacherUserId: args.userId },
    });
    const paperGeneratedQuestions = await tx.question.updateMany({
      where: { source: "PAPER_GENERATED", createdByUserId: args.userId },
      data: { createdByUserId: null },
    });
    const assignmentAnswers = await tx.assignmentAnswer.count({
      where: { studentAssignment: { studentUserId: args.userId } },
    });
    const assignmentPerformance = await tx.assignmentPerformance.deleteMany({
      where: { studentUserId: args.userId },
    });
    const studentAssignments = await tx.studentAssignment.deleteMany({
      where: { studentUserId: args.userId },
    });
    const familyLinks = await tx.familyLink.deleteMany({
      where: { OR: [{ parentUserId: args.userId }, { studentUserId: args.userId }] },
    });

    // Plan 14a：监护人同意。先处理 guardian 侧（删 consent 后受影响 child 失去全部有效 consent → 回 PENDING），再删本人作 child 的行。
    const guardianOfChildren = await tx.guardianConsent.findMany({
      where: { guardianUserId: args.userId, revokedAt: null },
      select: { childUserId: true },
    });
    const consentsAsGuardian = await tx.guardianConsent.deleteMany({
      where: { guardianUserId: args.userId },
    });
    const affectedChildIds = [...new Set(guardianOfChildren.map((g) => g.childUserId))];
    for (const childId of affectedChildIds) {
      if (childId === args.userId) continue;
      const remaining = await tx.guardianConsent.count({
        where: { childUserId: childId, revokedAt: null },
      });
      if (remaining === 0) {
        await tx.user.updateMany({
          where: { id: childId, guardianConsentStatus: "GRANTED" },
          data: { guardianConsentStatus: "PENDING" },
        });
      }
    }
    const consentsAsChild = await tx.guardianConsent.deleteMany({
      where: { childUserId: args.userId },
    });

    // Plan 14b：DSAR 工单 —— 抹掉自由文本 reason 但保留行（审计）。
    const dsarReasonScrub = await tx.dsarRequest.updateMany({
      where: { userId: args.userId, reason: { not: null } },
      data: { reason: null },
    });
    // 悬挂工单收口：未结 DELETION → COMPLETED（避免 dsar:list 永久残留）。
    await tx.dsarRequest.updateMany({
      where: {
        userId: args.userId,
        type: "DELETION",
        status: { in: ["AWAITING_GUARDIAN", "PENDING"] },
      },
      data: { status: "COMPLETED", resolvedAt: now, resolvedByRef: args.initiatorRef },
    });

    await tx.user.update({
      where: { id: args.userId },
      data: {
        name: null,
        avatarUrl: null,
        birthYear: null,
        deletedAt: now,
        deactivationReason: args.reason ?? null,
      },
    });

    const payload: DeactivatePayload = {
      scrubbed: {
        sessions: sessions.count,
        topupOrders: topupOrders.count,
        modelCalls: modelCalls.count,
        kpAliases: kpAliases.count,
        kpReconcileMatches: kpReconcileMatches.count,
        variantGeneratedQuestions: variantGeneratedQuestions.count,
        paperGeneratedQuestions: paperGeneratedQuestions.count,
        authIdentities: authIdentities.count,
        otpRequests: otpRequests.count,
        dsarRequests: dsarReasonScrub.count,
      },
      deleted: {
        ...plan.payload.deleted,
        assignmentAnswers,
        assignmentPerformance: assignmentPerformance.count,
        studentAssignments: studentAssignments.count,
        papers: papers.count,
        coursewares: coursewares.count,
        familyLinks: familyLinks.count,
        guardianConsentsAsChild: consentsAsChild.count,
        guardianConsentsAsGuardian: consentsAsGuardian.count,
      },
      dryRun: false,
    };

    await tx.opsActionLog.create({
      data: {
        kind: "DEACTIVATE_USER",
        initiatorId: args.operatorId,
        initiatorRef: args.initiatorRef,
        targetUserId: args.userId,
        reason: args.reason ?? null,
        payload: payload as unknown as Prisma.InputJsonObject,
      },
    });

    return { alreadyDeactivated: false, payload };
  });
}

function maskProviderUserId(provider: string, providerUserId: string): string {
  if (provider === "PHONE") {
    if (providerUserId.length >= 7) {
      return `${providerUserId.slice(0, 3)}****${providerUserId.slice(-4)}`;
    }
    return "****";
  }
  if (providerUserId.length <= 6) {
    return "****";
  }
  return `${providerUserId.slice(0, 3)}****${providerUserId.slice(-3)}`;
}

async function buildDeactivatePlan(
  prisma: DbClient,
  userId: string,
): Promise<DeactivateResult & { phoneNumbers: string[] }> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { deletedAt: true },
  });
  if (!user) {
    throw new Error(`User not found: ${userId}`);
  }

  const empty: DeactivatePayload = {
    scrubbed: {
      sessions: 0,
      topupOrders: 0,
      modelCalls: 0,
      kpAliases: 0,
      kpReconcileMatches: 0,
      variantGeneratedQuestions: 0,
      paperGeneratedQuestions: 0,
      authIdentities: 0,
      otpRequests: 0,
      dsarRequests: 0,
    },
    deleted: {
      errorBookEntries: 0,
      variantGroups: 0,
      variantItems: 0,
      userAdhocQuestions: 0,
      assignmentAnswers: 0,
      assignmentPerformance: 0,
      studentAssignments: 0,
      papers: 0,
      coursewares: 0,
      familyLinks: 0,
      guardianConsentsAsChild: 0,
      guardianConsentsAsGuardian: 0,
    },
    dryRun: false,
  };

  if (user.deletedAt != null) {
    return { alreadyDeactivated: true, payload: empty, phoneNumbers: [] };
  }

  const phoneIdentities = await prisma.authIdentity.findMany({
    where: { userId, provider: "PHONE", providerScope: "GLOBAL" },
    select: { providerUserId: true },
  });
  const phoneNumbers = phoneIdentities.map((i) => i.providerUserId);

  const entryIds = (
    await prisma.errorBookEntry.findMany({
      where: { userId },
      select: { id: true },
    })
  ).map((e) => e.id);
  const groupIds = entryIds.length
    ? (
        await prisma.variantGroup.findMany({
          where: { entryId: { in: entryIds } },
          select: { id: true },
        })
      ).map((g) => g.id)
    : [];

  const [
    errorBookEntries,
    variantGroups,
    variantItems,
    userAdhocQuestions,
    sessions,
    topupOrders,
    modelCalls,
    kpAliases,
    kpReconcileMatches,
    variantGeneratedQuestions,
    paperGeneratedQuestions,
    authIdentities,
    otpRequests,
    assignmentAnswers,
    assignmentPerformance,
    studentAssignments,
    papers,
    coursewares,
    familyLinks,
    guardianConsentsAsChild,
    guardianConsentsAsGuardian,
    dsarRequests,
  ] = await Promise.all([
    prisma.errorBookEntry.count({ where: { userId } }),
    entryIds.length ? prisma.variantGroup.count({ where: { entryId: { in: entryIds } } }) : 0,
    groupIds.length ? prisma.variantItem.count({ where: { groupId: { in: groupIds } } }) : 0,
    prisma.question.count({ where: { source: "USER_ADHOC", createdByUserId: userId } }),
    prisma.session.count({ where: { userId } }),
    prisma.topupOrder.count({ where: { userId } }),
    prisma.modelCall.count({ where: { userId } }),
    prisma.kpAlias.count({ where: { createdByUserId: userId } }),
    prisma.kpReconcileMatch.count({ where: { reviewedByUserId: userId } }),
    prisma.question.count({
      where: { source: "VARIANT_GENERATED", createdByUserId: userId },
    }),
    prisma.question.count({
      where: { source: "PAPER_GENERATED", createdByUserId: userId },
    }),
    prisma.authIdentity.count({ where: { userId } }),
    phoneNumbers.length ? prisma.otpRequest.count({ where: { phone: { in: phoneNumbers } } }) : 0,
    prisma.assignmentAnswer.count({
      where: { studentAssignment: { studentUserId: userId } },
    }),
    prisma.assignmentPerformance.count({ where: { studentUserId: userId } }),
    prisma.studentAssignment.count({ where: { studentUserId: userId } }),
    prisma.paper.count({ where: { teacherUserId: userId } }),
    prisma.courseware.count({ where: { teacherUserId: userId } }),
    prisma.familyLink.count({
      where: { OR: [{ parentUserId: userId }, { studentUserId: userId }] },
    }),
    prisma.guardianConsent.count({ where: { childUserId: userId } }),
    prisma.guardianConsent.count({ where: { guardianUserId: userId } }),
    prisma.dsarRequest.count({ where: { userId, reason: { not: null } } }),
  ]);

  return {
    alreadyDeactivated: false,
    phoneNumbers,
    payload: {
      scrubbed: {
        sessions,
        topupOrders,
        modelCalls,
        kpAliases,
        kpReconcileMatches,
        variantGeneratedQuestions,
        paperGeneratedQuestions,
        authIdentities,
        otpRequests,
        dsarRequests,
      },
      deleted: {
        errorBookEntries,
        variantGroups,
        variantItems,
        userAdhocQuestions,
        assignmentAnswers,
        assignmentPerformance,
        studentAssignments,
        papers,
        coursewares,
        familyLinks,
        guardianConsentsAsChild,
        guardianConsentsAsGuardian,
      },
      dryRun: false,
    },
  };
}
