import "server-only";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import {
  ensureWallet,
  adminAdjust,
  sumMonthlyTopupCents,
  type AdjustReasonCode,
} from "@zhijiao/billing";
import {
  RedisRateLimitStore,
  takeRule,
  RULE_TOPUP_CREATE_IP,
  RULE_TOPUP_CREATE_USER,
  RateLimitBackendDownError,
} from "@zhijiao/auth";
import { authedProcedure, permissionProcedure, router } from "../trpc.js";
import { env } from "../env.js";
import { getWechatPayAdapter } from "../wechat-pay-adapter.js";
import { logger } from "../logger.js";
import { toTRPCError } from "../errors.js";

// outTradeNo shape: zj_<userPrefix>_<12 url-safe chars>. WeChat allows up to
// 32 chars [A-Za-z0-9_-]; the userPrefix gives operators a quick "which user
// is this order for" without joining, and the random tail keeps collision
// probability astronomically low without a DB round-trip.
function mintOutTradeNo(userId: string): string {
  const tail = randomBytes(9).toString("base64url"); // 12 chars
  return `zj_${userId.slice(0, 8)}_${tail}`;
}

const ratelimitStore = (redis: import("ioredis").default) =>
  new RedisRateLimitStore(redis);

const REASON_CODES = [
  "FAULT_RECOVERY",
  "CUSTOMER_SERVICE_GIFT",
  "PROMO",
  "FRAUD_CLAWBACK",
  "OTHER",
] as const;

export const walletRouter = router({
  balance: authedProcedure.query(async ({ ctx }) => {
    const wallet = await ensureWallet(ctx.db, ctx.auth.userId);
    let monthly: {
      topupYuan: number;
      remainingYuan: number;
      limitYuan: number;
    } | null = null;
    if (ctx.auth.isMinor) {
      const used = await sumMonthlyTopupCents(ctx.db, ctx.auth.userId);
      const limit = env.MINOR_MONTHLY_LIMIT_YUAN;
      monthly = {
        topupYuan: used / 100,
        limitYuan: limit,
        remainingYuan: Math.max(0, limit - used / 100),
      };
    }
    return { balance: wallet.balance, monthly };
  }),

  topupCreate: authedProcedure
    .input(
      z.object({
        amountCents: z
          .number()
          .int()
          .min(100)
          .max(100_000)
          .refine(
            (v) => v % 100 === 0,
            "amountCents must be a whole-yuan multiple of 100",
          ),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Rate limits are fail-CLOSE: a Redis outage means we cannot
      // guarantee per-user / per-IP caps, so refuse to create the order
      // rather than let an unbounded burst land charges we can't reconcile.
      const store = ratelimitStore(ctx.redis);
      try {
        const r1 = await takeRule(store, RULE_TOPUP_CREATE_IP, ctx.ip);
        if (!r1.allowed) {
          throw toTRPCError("TOPUP_TOO_FREQUENT", "TOO_MANY_REQUESTS", {
            retryAfterMs: r1.retryAfterMs,
          });
        }
        const r2 = await takeRule(
          store,
          RULE_TOPUP_CREATE_USER,
          ctx.auth.userId,
        );
        if (!r2.allowed) {
          throw toTRPCError("TOPUP_TOO_FREQUENT", "TOO_MANY_REQUESTS", {
            retryAfterMs: r2.retryAfterMs,
          });
        }
      } catch (e) {
        if (e instanceof RateLimitBackendDownError) {
          throw toTRPCError(
            "TOPUP_RATE_LIMIT_UNAVAILABLE",
            "INTERNAL_SERVER_ERROR",
          );
        }
        throw e;
      }

      await ensureWallet(ctx.db, ctx.auth.userId);

      // Minor cap: spec §6.3 sums CREATED+PENDING (by createdAt) and PAID
      // (by paidAt) within the Asia/Shanghai natural month; the new attempt
      // would push the running total past MINOR_MONTHLY_LIMIT_YUAN * 100.
      if (ctx.auth.isMinor) {
        const used = await sumMonthlyTopupCents(ctx.db, ctx.auth.userId);
        const limit = env.MINOR_MONTHLY_LIMIT_YUAN * 100;
        if (used + input.amountCents > limit) {
          throw toTRPCError(
            "MINOR_MONTHLY_LIMIT_REACHED",
            "PRECONDITION_FAILED",
            {
              monthlyYuan: used / 100,
              limitYuan: limit / 100,
              attemptYuan: input.amountCents / 100,
            },
          );
        }
      }

      const credits = (input.amountCents / 100) * env.CREDIT_PER_YUAN;
      const outTradeNo = mintOutTradeNo(ctx.auth.userId);
      const expiredAt = new Date(Date.now() + 30 * 60 * 1000);

      const order = await ctx.db.topupOrder.create({
        data: {
          userId: ctx.auth.userId,
          amountCents: input.amountCents,
          credits,
          outTradeNo,
          expiredAt,
          ipCreated: ctx.ip,
          userAgent: ctx.ua,
        },
      });

      const adapter = getWechatPayAdapter();
      let prepayId: string;
      let qrCode: string | undefined;
      let h5Url: string | undefined;
      try {
        const r = await adapter.unifiedOrder({
          outTradeNo,
          amountCents: input.amountCents,
          description: `智教 Credit 充值 ${input.amountCents / 100} 元`,
        });
        prepayId = r.prepayId;
        qrCode = r.qrCode;
        h5Url = r.h5Url;
      } catch (e) {
        // unifiedOrder failure → mark order FAILED so the webhook handler
        // and topupStatus query both report consistently. Do not throw the
        // raw upstream error — it may contain transport details we don't
        // want to surface.
        await ctx.db.topupOrder.update({
          where: { id: order.id },
          data: { status: "FAILED" },
        });
        logger.error(
          {
            event: "topup_unified_order_failed",
            orderId: order.id,
            outTradeNo,
            error: String(e),
            requestId: ctx.requestId,
          },
          "unifiedOrder threw",
        );
        throw toTRPCError("TOPUP_ADAPTER_ERROR", "INTERNAL_SERVER_ERROR");
      }

      // Mark PENDING only after unifiedOrder succeeded. This ordering matters:
      // the mock adapter's signalOrderReady fires a webhook that hits
      // applyWechatPayNotify, which expects the order to be in PENDING (or
      // CREATED/EXPIRED) — never lit-up-to-PENDING simultaneously with the
      // notify arrival.
      await ctx.db.topupOrder.update({
        where: { id: order.id },
        data: { status: "PENDING", prepayId },
      });

      // signalOrderReady is contractually no-reject: mock fires the local
      // webhook (async-delayed in dev, manual in test), real is no-op.
      await adapter.signalOrderReady(outTradeNo, input.amountCents);

      return {
        orderId: order.id,
        outTradeNo,
        prepayId,
        qrCode,
        h5Url,
        expiresAt: expiredAt,
        credits,
      };
    }),

  topupStatus: authedProcedure
    .input(z.object({ orderId: z.string() }))
    .query(async ({ ctx, input }) => {
      // Scoped by userId so one user can't poll another's order even
      // armed with the order id.
      const o = await ctx.db.topupOrder.findFirst({
        where: { id: input.orderId, userId: ctx.auth.userId },
      });
      if (!o) {
        throw toTRPCError("ORDER_NOT_FOUND", "NOT_FOUND");
      }
      return {
        status: o.status,
        paidAt: o.paidAt,
        credits: o.credits,
        expiredAt: o.expiredAt,
      };
    }),

  ledgerList: authedProcedure
    .input(
      z.object({
        limit: z.number().int().min(1).max(50).default(20),
        cursor: z.string().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const wallet = await ensureWallet(ctx.db, ctx.auth.userId);
      // Cursor semantics: nextCursor is set to the popped (limit+1)-th
      // entry's id. The next page's cursor query is INCLUSIVE (no skip:1)
      // so that boundary entry is the first row of page 2 — using skip:1
      // here would drop one entry per page boundary.
      const entries = await ctx.db.creditLedger.findMany({
        where: { walletId: wallet.id },
        orderBy: { createdAt: "desc" },
        take: input.limit + 1,
        ...(input.cursor ? { cursor: { id: input.cursor } } : {}),
      });
      const nextCursor =
        entries.length > input.limit ? entries.pop()!.id : null;
      return {
        entries: entries.map((e) => ({
          id: e.id,
          kind: e.kind,
          delta: e.delta,
          balanceAfter: e.balanceAfter,
          actionKind: e.actionKind,
          createdAt: e.createdAt,
        })),
        nextCursor,
      };
    }),

  walletAdminAdjust: permissionProcedure("OPS_ADJUST_CREDIT")
    .input(
      z.object({
        targetUserId: z.string(),
        delta: z
          .number()
          .int()
          .refine(
            (n) => n !== 0 && Math.abs(n) <= 1_000_000,
            "delta must be non-zero and |delta| <= 1,000,000 credits",
          ),
        reasonCode: z.enum(REASON_CODES),
        reasonDetail: z
          .string()
          .min(10, "reasonDetail must be >= 10 chars (audit trail)")
          .max(500),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await ensureWallet(ctx.db, input.targetUserId);
      const result = await adminAdjust(ctx.db, {
        targetUserId: input.targetUserId,
        delta: input.delta,
        reasonCode: input.reasonCode as AdjustReasonCode,
        reasonDetail: input.reasonDetail,
        opsUserId: ctx.auth.userId,
      });
      // OPS-facing actions: log with full context so audit can reconstruct
      // who-did-what-to-whom from the structured stream alone.
      logger.info(
        {
          event: "ops_wallet_adjust",
          opsUserId: ctx.auth.userId,
          targetUserId: input.targetUserId,
          delta: input.delta,
          reasonCode: input.reasonCode,
          ledgerId: result.ledgerId,
          requestId: ctx.requestId,
        },
        "OPS adjusted wallet",
      );
      return result;
    }),
});
