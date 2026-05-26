import { type Prisma, type PrismaClient } from "@prisma/client";

type DbClient = PrismaClient | Prisma.TransactionClient;

export interface DeactivatePayload {
  scrubbed: {
    sessions: number;
    topupOrders: number;
    modelCalls: number;
    kpAliases: number;
    kpReconcileMatches: number;
    authIdentities: number;
    otpRequests: number;
  };
  deleted: {
    errorBookEntries: number;
    variantGroups: number;
    variantItems: number;
    userAdhocQuestions: number;
  };
  dryRun: boolean;
}

export interface DeactivateResult {
  alreadyDeactivated: boolean;
  payload: DeactivatePayload;
}

export interface UserDataExport {
  schemaVersion: "2026-05-26";
  exportedAt: string;
  userId: string;
  user: {
    name: string | null;
    avatarUrl: string | null;
    persona: string;
    gradeLevel: string | null;
    isMinor: boolean;
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
  ]);

  return {
    schemaVersion: "2026-05-26",
    exportedAt: new Date().toISOString(),
    userId: user.id,
    user: {
      name: user.name,
      avatarUrl: user.avatarUrl,
      persona: user.persona,
      gradeLevel: user.gradeLevel,
      isMinor: user.isMinor,
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
  };
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

    await tx.user.update({
      where: { id: args.userId },
      data: {
        name: null,
        avatarUrl: null,
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
        authIdentities: authIdentities.count,
        otpRequests: otpRequests.count,
      },
      deleted: plan.payload.deleted,
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
      authIdentities: 0,
      otpRequests: 0,
    },
    deleted: {
      errorBookEntries: 0,
      variantGroups: 0,
      variantItems: 0,
      userAdhocQuestions: 0,
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
    authIdentities,
    otpRequests,
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
    prisma.authIdentity.count({ where: { userId } }),
    phoneNumbers.length ? prisma.otpRequest.count({ where: { phone: { in: phoneNumbers } } }) : 0,
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
        authIdentities,
        otpRequests,
      },
      deleted: {
        errorBookEntries,
        variantGroups,
        variantItems,
        userAdhocQuestions,
      },
      dryRun: false,
    },
  };
}
