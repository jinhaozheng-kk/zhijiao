import type { PrismaClient } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { getBillingLogger } from "./logger";

export interface VerifyOk {
  ok: true;
  outTradeNo: string;
  amountCents: number;
  tradeState: string;
  transactionId: string;
  appId: string;
  mchId: string;
  successTime: string;
}

export type ApplyNotifyResult =
  | { kind: "PAID" }
  | { kind: "FAILED" }
  | { kind: "ALREADY_PAID" }
  | { kind: "ORDER_NOT_FOUND" }
  | { kind: "AMOUNT_MISMATCH" }
  | { kind: "APP_OR_MCH_MISMATCH" }
  | { kind: "INTERMEDIATE_STATE_NOTPAY" }
  | { kind: "INTERMEDIATE_STATE_USERPAYING" }
  | { kind: "UNEXPECTED_REFUND" }
  | { kind: "UNKNOWN_TRADE_STATE" }
  | { kind: "DUPLICATE_TRANSACTION_ID" };

export async function applyWechatPayNotify(
  prisma: PrismaClient,
  verify: VerifyOk,
  expectedAppId: string,
  expectedMchId: string,
): Promise<ApplyNotifyResult> {
  try {
    return await prisma.$transaction(async (tx) => {
      const order = await tx.topupOrder.findUnique({
        where: { outTradeNo: verify.outTradeNo },
      });
      if (!order) return { kind: "ORDER_NOT_FOUND" as const };

      if (verify.amountCents !== order.amountCents) {
        return { kind: "AMOUNT_MISMATCH" as const };
      }
      if (verify.appId !== expectedAppId || verify.mchId !== expectedMchId) {
        return { kind: "APP_OR_MCH_MISMATCH" as const };
      }

      if (order.status === "PAID" && verify.tradeState === "SUCCESS") {
        if (
          order.transactionId &&
          order.transactionId !== verify.transactionId
        ) {
          return { kind: "DUPLICATE_TRANSACTION_ID" as const };
        }
        return { kind: "ALREADY_PAID" as const };
      }

      if (verify.tradeState === "NOTPAY") {
        return { kind: "INTERMEDIATE_STATE_NOTPAY" as const };
      }
      if (verify.tradeState === "USERPAYING") {
        return { kind: "INTERMEDIATE_STATE_USERPAYING" as const };
      }
      if (["CLOSED", "PAYERROR", "REVOKED"].includes(verify.tradeState)) {
        await tx.topupOrder.update({
          where: { outTradeNo: verify.outTradeNo },
          data: {
            status: "FAILED",
            transactionId: verify.transactionId ?? null,
          },
        });
        return { kind: "FAILED" as const };
      }
      if (verify.tradeState === "REFUND") {
        return { kind: "UNEXPECTED_REFUND" as const };
      }
      if (verify.tradeState !== "SUCCESS") {
        return { kind: "UNKNOWN_TRADE_STATE" as const };
      }

      await tx.wallet.update({
        where: { userId: order.userId },
        data: { balance: { increment: order.credits } },
      });
      const w = await tx.wallet.findUniqueOrThrow({
        where: { userId: order.userId },
        select: { id: true, balance: true },
      });
      await tx.creditLedger.create({
        data: {
          walletId: w.id,
          kind: "TOPUP",
          delta: order.credits,
          balanceAfter: w.balance,
          idemKey: `topup:${verify.outTradeNo}`,
          refTable: "topup_orders",
          refId: order.id,
          createdByUserId: null,
        },
      });
      await tx.topupOrder.update({
        where: { outTradeNo: verify.outTradeNo },
        data: {
          status: "PAID",
          transactionId: verify.transactionId,
          paidAt: new Date(verify.successTime),
        },
      });
      return { kind: "PAID" as const };
    });
  } catch (e) {
    if (
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === "P2002"
    ) {
      if (isUniqueTargetMatching(e, ["idemKey", "idem_key"])) {
        const [existingLedger, order] = await Promise.all([
          prisma.creditLedger.findUnique({
            where: { idemKey: `topup:${verify.outTradeNo}` },
            select: { id: true },
          }),
          prisma.topupOrder.findUnique({
            where: { outTradeNo: verify.outTradeNo },
            select: { status: true },
          }),
        ]);
        if (existingLedger && order?.status === "PAID") {
          return { kind: "ALREADY_PAID" as const };
        }
        getBillingLogger().error(
          {
            event: "p2002_idemkey_inconsistent",
            outTradeNo: verify.outTradeNo,
            hasLedger: !!existingLedger,
            orderStatus: order?.status,
          },
          "P2002 on CreditLedger.idemKey but DB state not as expected",
        );
        throw e;
      }
      if (isUniqueTargetMatching(e, ["transactionId", "transaction_id"])) {
        const conflicting = await prisma.topupOrder.findUnique({
          where: { transactionId: verify.transactionId },
          select: { id: true, outTradeNo: true, status: true },
        });
        getBillingLogger().error(
          {
            event: "wechat_pay_duplicate_transaction_id",
            incomingOutTradeNo: verify.outTradeNo,
            existingOrderId: conflicting?.id,
            existingOutTradeNo: conflicting?.outTradeNo,
            existingStatus: conflicting?.status,
          },
          "Duplicate transaction_id from WeChat Pay webhook",
        );
        return { kind: "DUPLICATE_TRANSACTION_ID" as const };
      }
    }
    throw e;
  }
}

function isUniqueTargetMatching(
  e: Prisma.PrismaClientKnownRequestError,
  fields: string[],
): boolean {
  const target = (e.meta as { target?: string[] | string } | undefined)?.target;
  const targetStr = Array.isArray(target) ? target.join(",") : (target ?? "");
  return fields.some((f) => targetStr.includes(f));
}
