import "server-only";
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import { z } from "zod";
import { hasPermission, type Permission } from "@zhijiao/domain";
import {
  ensureWallet,
  chargeForAction,
  compensate,
  shouldCompensate,
  errorReason,
  ActionAlreadyChargedError,
  priceOf,
  type ActionKind,
} from "@zhijiao/billing";
import { logger } from "./logger.js";
import type { Ctx } from "./context.js";

const t = initTRPC.context<Ctx>().create({
  transformer: superjson,
  errorFormatter({ shape, error }) {
    const cause = error.cause as { reason?: string } | undefined;
    return {
      ...shape,
      data: { ...shape.data, reason: cause?.reason ?? null },
    };
  },
});

export const router = t.router;
export const publicProcedure = t.procedure;

export const authedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.auth) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "请先登录",
      cause: { reason: ctx.authError ?? "NO_SESSION" },
    });
  }
  return next({ ctx: { ...ctx, auth: ctx.auth } });
});

export const permissionProcedure = (perm: Permission) =>
  authedProcedure.use(({ ctx, next }) => {
    if (!hasPermission(ctx.auth.roles, perm)) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "权限不足",
        cause: { reason: "PERMISSION_DENIED" },
      });
    }
    return next();
  });

// Plan 3 Task 9: replace creditPlaceholder.
//
// Charges 1 priceOf(kind) credit before next() runs the procedure body.
// Two pre-conditions before debit:
//   1. clientRequestId (UUID v4) MUST be present in the raw input. We
//      validate via getRawInput() because the downstream procedure's own
//      .input() schema is opaque to this middleware. UUID specifically —
//      not a free string — to make accidental collisions across users
//      effectively impossible.
//   2. The user has an open wallet (ensureWallet upserts on first use).
//
// On successful debit, next() runs. If next() throws:
//   - default: refund via compensate(originalLedgerId). The debit ledger
//     and the COMPENSATION entry are both audit-visible; balance ends up
//     where it started.
//   - shouldCompensate(e) === false (only ComplianceRejectedError today):
//     keep the debit. The user got a real, deterministic service answer
//     even if it was a refusal; rewarding retries with a free pass would
//     let an attacker probe the compliance filter for free. The debit
//     ledger row is annotated with metadata.compensationStatus so audit
//     can tell intentional non-refund apart from a missing comp entry.
//
// Idempotency: idemKey = debit:<kind>:<userId>:<clientRequestId>.
// A retry with the same UUID hits CreditLedger.idemKey UNIQUE → throws
// ActionAlreadyChargedError → CONFLICT with reason ACTION_IDEMPOTENCY_HIT.
// The procedure body does NOT re-run, so the caller can safely retry an
// in-flight mutation without double-charging or double-side-effects.
export const chargedProcedure = (kind: ActionKind) =>
  authedProcedure.use(async ({ ctx, next, getRawInput }) => {
    const raw = await getRawInput();
    const parsed = z
      .object({ clientRequestId: z.string().uuid() })
      .safeParse(raw);
    if (!parsed.success) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "请求缺少 clientRequestId（UUID）",
        cause: { reason: "CLIENT_REQUEST_ID_REQUIRED" },
      });
    }
    const { clientRequestId } = parsed.data;

    const wallet = await ensureWallet(ctx.db, ctx.auth.userId);
    const cost = priceOf(kind);
    const idemKey = `debit:${kind.toLowerCase()}:${ctx.auth.userId}:${clientRequestId}`;

    let debit: Awaited<ReturnType<typeof chargeForAction>>;
    try {
      debit = await chargeForAction(ctx.db, {
        walletId: wallet.id,
        kind,
        cost,
        idemKey,
        createdByUserId: ctx.auth.userId,
      });
    } catch (e) {
      if (e instanceof ActionAlreadyChargedError) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "该请求已处理，请勿重复提交",
          cause: { reason: "ACTION_IDEMPOTENCY_HIT" },
        });
      }
      throw e;
    }

    if (debit.kind === "INSUFFICIENT_BALANCE") {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "余额不足",
        cause: {
          reason: "INSUFFICIENT_BALANCE",
          required: cost,
          balance: debit.balance,
        },
      });
    }

    // tRPC v11 middleware: next() RESOLVES with a MiddlewareResult — even
    // when the downstream procedure throws. result.ok === false carries
    // the error. A try/catch around next() would never fire and silently
    // skip compensation. We must inspect result.ok explicitly.
    const result = await next();
    if (result.ok) return result;

    const e = result.error;
    if (shouldCompensate(e)) {
      await compensate(ctx.db, {
        originalLedgerId: debit.ledgerId,
        walletId: wallet.id,
        cost,
        kind,
        reason: errorReason(e),
      });
    } else {
      // Annotate the existing debit so audit can distinguish
      // "no compensation because whitelist" from a buggy missing comp.
      //
      // errorClass prefers the upstream (pre-tRPC-wrap) error class name
      // when discoverable, since that's the audit-meaningful identity.
      // Routers that catch a domain error and re-throw TRPCError set
      // `cause.original = <upstreamError>` (see routers/tutor.ts) so we
      // can recover the class through the wrap. We also accept a bare
      // Error as cause for routers that pass the original directly.
      const causeObj = (e as { cause?: unknown } | null)?.cause;
      const originalFromCauseObj =
        causeObj && typeof causeObj === "object" && "original" in causeObj
          ? (causeObj as { original?: unknown }).original
          : undefined;
      const originalClass =
        originalFromCauseObj instanceof Error
          ? originalFromCauseObj.constructor.name
          : causeObj instanceof Error
            ? causeObj.constructor.name
            : (e as { constructor?: { name?: string } } | null)?.constructor
                ?.name ?? "Unknown";
      const existing = await ctx.db.creditLedger.findUnique({
        where: { id: debit.ledgerId },
        select: { metadata: true },
      });
      const prior =
        (existing?.metadata as Record<string, unknown> | null) ?? {};
      await ctx.db.creditLedger.update({
        where: { id: debit.ledgerId },
        data: {
          metadata: {
            ...prior,
            compensationStatus: "not_compensated_whitelisted",
            errorClass: originalClass,
          },
        },
      });
      logger.warn(
        {
          event: "charged_action_not_compensated",
          ledgerId: debit.ledgerId,
          walletId: wallet.id,
          userId: ctx.auth.userId,
          actionKind: kind,
          cost,
          errorClass: originalClass,
          requestId: ctx.requestId,
        },
        "Action failed but whitelisted as non-compensable",
      );
    }
    return result;
  });
