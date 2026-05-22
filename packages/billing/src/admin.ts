import type { PrismaClient } from "@prisma/client";

export type AdjustReasonCode =
  | "FAULT_RECOVERY"
  | "CUSTOMER_SERVICE_GIFT"
  | "PROMO"
  | "FRAUD_CLAWBACK"
  | "OTHER";

export class InsufficientBalanceForAdjustError extends Error {
  constructor(public balance: number, public requested: number) {
    super(
      `cannot adjust by -${requested}: current balance ${balance} would go negative`,
    );
    this.name = "InsufficientBalanceForAdjustError";
  }
}

export interface AdminAdjustArgs {
  targetUserId: string;
  delta: number;
  reasonCode: AdjustReasonCode;
  reasonDetail: string;
  opsUserId: string;
}

export async function adminAdjust(
  prisma: PrismaClient,
  args: AdminAdjustArgs,
): Promise<{ ledgerId: string; balanceAfter: number }> {
  if (args.delta === 0) {
    throw new Error("delta must be non-zero");
  }
  return prisma.$transaction(async (tx) => {
    const w = await tx.wallet.findUniqueOrThrow({
      where: { userId: args.targetUserId },
      select: { id: true, balance: true },
    });
    if (args.delta < 0) {
      // Predicate-on-update: only deduct if balance covers it. Mirrors
      // chargeForAction's pattern so OPS clawback can never push balance < 0.
      const claimed = await tx.wallet.updateMany({
        where: { id: w.id, balance: { gte: -args.delta } },
        data: { balance: { increment: args.delta } },
      });
      if (claimed.count !== 1) {
        const fresh = await tx.wallet.findUniqueOrThrow({
          where: { id: w.id },
          select: { balance: true },
        });
        throw new InsufficientBalanceForAdjustError(fresh.balance, -args.delta);
      }
    } else {
      await tx.wallet.update({
        where: { id: w.id },
        data: { balance: { increment: args.delta } },
      });
    }
    const after = await tx.wallet.findUniqueOrThrow({
      where: { id: w.id },
      select: { balance: true },
    });
    const idemKey = `adjust:${args.reasonCode.toLowerCase()}:${args.opsUserId}:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`;
    const entry = await tx.creditLedger.create({
      data: {
        walletId: w.id,
        kind: args.delta > 0 ? "ADJUST_ADD" : "ADJUST_SUB",
        delta: args.delta,
        balanceAfter: after.balance,
        idemKey,
        actionKind: null,
        createdByUserId: args.opsUserId,
        metadata: {
          reasonCode: args.reasonCode,
          reasonDetail: args.reasonDetail,
        },
      },
    });
    return { ledgerId: entry.id, balanceAfter: after.balance };
  });
}
