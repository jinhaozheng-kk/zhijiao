import type { PrismaClient } from "@prisma/client";
import { Prisma } from "@prisma/client";

export class ActionAlreadyChargedError extends Error {
  constructor(public idemKey: string) {
    super(`action already charged: ${idemKey}`);
    this.name = "ActionAlreadyChargedError";
  }
}

export class CompensationAlreadyAppliedError extends Error {
  constructor(public originalLedgerId: string) {
    super(`compensation already applied for ledger entry: ${originalLedgerId}`);
    this.name = "CompensationAlreadyAppliedError";
  }
}

export type ChargeResult =
  | { kind: "OK"; ledgerId: string; balanceAfter: number }
  | { kind: "INSUFFICIENT_BALANCE"; balance: number };

export interface ChargeArgs {
  walletId: string;
  kind: string;
  cost: number;
  idemKey: string;
  createdByUserId: string;
}

export async function chargeForAction(
  prisma: PrismaClient,
  args: ChargeArgs,
): Promise<ChargeResult> {
  try {
    return await prisma.$transaction(async (tx) => {
      const claimed = await tx.wallet.updateMany({
        where: { id: args.walletId, balance: { gte: args.cost } },
        data: { balance: { decrement: args.cost } },
      });
      if (claimed.count !== 1) {
        const w = await tx.wallet.findUniqueOrThrow({
          where: { id: args.walletId },
          select: { balance: true },
        });
        return { kind: "INSUFFICIENT_BALANCE" as const, balance: w.balance };
      }
      const after = await tx.wallet.findUniqueOrThrow({
        where: { id: args.walletId },
        select: { balance: true },
      });
      const entry = await tx.creditLedger.create({
        data: {
          walletId: args.walletId,
          kind: "DEBIT",
          delta: -args.cost,
          balanceAfter: after.balance,
          idemKey: args.idemKey,
          actionKind: args.kind,
          createdByUserId: args.createdByUserId,
        },
      });
      return {
        kind: "OK" as const,
        ledgerId: entry.id,
        balanceAfter: after.balance,
      };
    });
  } catch (e) {
    if (
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === "P2002"
    ) {
      const target = (e.meta as { target?: string[] | string } | undefined)
        ?.target;
      const targetStr = Array.isArray(target) ? target.join(",") : (target ?? "");
      if (targetStr.includes("idem_key") || targetStr.includes("idemKey")) {
        throw new ActionAlreadyChargedError(args.idemKey);
      }
    }
    throw e;
  }
}

export interface CompensateArgs {
  originalLedgerId: string;
  walletId: string;
  cost: number;
  kind: string;
  reason: string;
}

export async function compensate(
  prisma: PrismaClient,
  args: CompensateArgs,
): Promise<{ ledgerId: string; balanceAfter: number }> {
  try {
    return await prisma.$transaction(async (tx) => {
      await tx.wallet.update({
        where: { id: args.walletId },
        data: { balance: { increment: args.cost } },
      });
      const after = await tx.wallet.findUniqueOrThrow({
        where: { id: args.walletId },
        select: { balance: true },
      });
      const entry = await tx.creditLedger.create({
        data: {
          walletId: args.walletId,
          kind: "COMPENSATION",
          delta: args.cost,
          balanceAfter: after.balance,
          idemKey: `comp:${args.originalLedgerId}`,
          refTable: "credit_ledger",
          refId: args.originalLedgerId,
          actionKind: args.kind,
          metadata: { reason: args.reason, originalLedgerId: args.originalLedgerId },
        },
      });
      return { ledgerId: entry.id, balanceAfter: after.balance };
    });
  } catch (e) {
    if (
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === "P2002"
    ) {
      const target = (e.meta as { target?: string[] | string } | undefined)
        ?.target;
      const targetStr = Array.isArray(target) ? target.join(",") : (target ?? "");
      if (targetStr.includes("idem_key") || targetStr.includes("idemKey")) {
        throw new CompensationAlreadyAppliedError(args.originalLedgerId);
      }
    }
    throw e;
  }
}

/**
 * fail-open compensation whitelist: explicit non-compensable errors return false.
 * ComplianceRejectedError: user received service output (even if it was a rejection) — don't refund.
 */
// Compensation whitelist: errors that the user is considered to have
// "received service for" — refunding them would reward retries that
// exercise the same filter (e.g. probing the compliance scanner for free)
// and obscure the cost of running the upstream that produced the refusal.
//
// Two recognition paths because tRPC routers conventionally catch domain
// errors and re-throw as TRPCError with a structured `cause: { reason }`:
//   1. Direct instance: error.name === "ComplianceRejectedError".
//      Hits when chargeForAction's caller throws the original error and
//      the middleware sees it un-wrapped (covered by billing unit tests).
//   2. Wrapped cause: error.cause.reason === "COMPLIANCE_REJECTED".
//      Hits when a tRPC router catches the domain error and re-throws
//      a TRPCError with our standard `{ reason }` cause-object envelope
//      (covered by charged-procedure-compensation integration tests).
//
// The reason string contract ("COMPLIANCE_REJECTED") is the same one the
// errorFormatter surfaces to clients via shape.data.reason, so the whole
// system speaks one vocabulary.
export function shouldCompensate(e: unknown): boolean {
  const name = (e as { name?: string } | null)?.name ?? "";
  if (name === "ComplianceRejectedError") return false;
  const causeReason = (e as { cause?: { reason?: string } | null } | null)
    ?.cause?.reason;
  if (causeReason === "COMPLIANCE_REJECTED") return false;
  return true;
}

export function errorReason(e: unknown): string {
  return (e as { constructor?: { name?: string } } | null)?.constructor?.name ?? "Unknown";
}
