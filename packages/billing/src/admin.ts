import type { PrismaClient } from "@prisma/client";

export type AdjustReasonCode =
  | "FAULT_RECOVERY"
  | "CUSTOMER_SERVICE_GIFT"
  | "PROMO"
  | "FRAUD_CLAWBACK"
  | "OTHER";

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
    await tx.wallet.update({
      where: { id: w.id },
      data: { balance: { increment: args.delta } },
    });
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
