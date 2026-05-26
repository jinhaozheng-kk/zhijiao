import "server-only";
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import { z } from "zod";
import { findForbidden, hasPermission, type Permission } from "@zhijiao/domain";
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

// Plan 3 Task 9 (extracted into reusable middleware by Plan 4 Task 3).
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
// On successful debit, next() runs with ctx.debit = { ledgerId } injected
// so mutation bodies can persist the DEBIT ledger row id alongside their
// domain entity (e.g. VariantGroup.debitLedgerId). If next() throws:
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
//
// Must be chained AFTER authedProcedure (depends on ctx.auth). For pure
// "auth → charge → body" the convenience wrapper `chargedProcedure(kind)`
// below already does this. For "auth → validate-entry → charge → body"
// (Plan 4 variant.generateForEntry), compose explicitly:
//   authedProcedure.use(validateEntryOwnership).use(chargeMiddleware(kind))
// so entry validation fails BEFORE the DEBIT row gets written (spec
// Blocker 1 — entry-not-found / cross-user / DELETED must not charge).
export const chargeMiddleware = (kind: ActionKind) =>
  t.middleware(async ({ ctx, next, getRawInput }) => {
    if (!ctx.auth) {
      // Defensive: in normal use authedProcedure precedes us and has already
      // thrown. Repeat the check so TypeScript can narrow ctx.auth below and
      // so accidental misuse (chargeMiddleware on publicProcedure) fails fast.
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "请先登录",
        cause: { reason: ctx.authError ?? "NO_SESSION" },
      });
    }
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
    //
    // Plan 4 addition: inject ctx.debit so mutation bodies can persist
    // the DEBIT ledger row id alongside their domain entity (e.g.
    // VariantGroup.debitLedgerId). Plan 3 callers (tutor.ask) don't read
    // ctx.debit, so this is backwards-compatible.
    //
    // `auth: ctx.auth` is explicit (not just `...ctx`) so the non-null
    // narrowing from the guard above survives the spread — same idiom as
    // authedProcedure. Without it, the downstream procedure body sees
    // ctx.auth as possibly-null and breaks Plan 3 typecheck.
    const result = await next({
      ctx: { ...ctx, auth: ctx.auth, debit: { ledgerId: debit.ledgerId } },
    });
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

// Plan 3 sugar form preserved unchanged for existing call sites
// (tutor.ask, wallet.* etc.). Zero behavior diff vs the inline Plan 3
// implementation — chargeMiddleware was extracted verbatim.
export const chargedProcedure = (kind: ActionKind) =>
  authedProcedure.use(chargeMiddleware(kind));

// Plan 4 Task 3 new middleware.
// Loads ctx.entry from rawInput.entryId, with three failures collapsed into
// a single NOT_FOUND / ENTRY_NOT_FOUND so cross-user existence is not
// observable (spec §5.3 / Blocker 1 + Blocker 2):
//   a) entryId missing or malformed → BAD_REQUEST / ENTRY_ID_REQUIRED
//      (separate from the not-found case because zod fires before DB lookup
//      and the client should learn this is a request-shape bug, not a
//      missing resource).
//   b) entry row doesn't exist → NOT_FOUND / ENTRY_NOT_FOUND
//   c) entry.userId !== ctx.auth.userId (cross-user) → NOT_FOUND / ENTRY_NOT_FOUND
//      DO NOT return FORBIDDEN here: distinguishing "exists but yours" from
//      "doesn't exist" leaks the existence of other users' entries.
//   d) entry.status === DELETED → NOT_FOUND / ENTRY_NOT_FOUND
//      DELETED is terminal; any student-facing surface must behave as if
//      the row is not in the database.
//
// Must be chained BEFORE chargeMiddleware so that (b/c/d) abort the request
// before the DEBIT ledger row gets written:
//   authedProcedure.use(validateEntryOwnership).use(chargeMiddleware(kind))
//
// Loads question + answer + knowledgePoints (with the KP rows joined) so
// variant.generateForEntry's body has everything it needs to call the AI
// without another DB round trip.
export const validateEntryOwnership = t.middleware(
  async ({ ctx, next, getRawInput }) => {
    if (!ctx.auth) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "请先登录",
        cause: { reason: ctx.authError ?? "NO_SESSION" },
      });
    }
    const raw = await getRawInput();
    const parsed = z
      .object({ entryId: z.string().cuid() })
      .safeParse(raw);
    if (!parsed.success) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "缺少 entryId",
        cause: { reason: "ENTRY_ID_REQUIRED" },
      });
    }
    const entry = await ctx.db.errorBookEntry.findUnique({
      where: { id: parsed.data.entryId },
      include: {
        question: {
          include: {
            answer: true,
            knowledgePoints: { include: { kp: true } },
          },
        },
      },
    });
    if (
      !entry ||
      entry.userId !== ctx.auth.userId ||
      entry.status === "DELETED"
    ) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "错题不存在",
        cause: { reason: "ENTRY_NOT_FOUND" },
      });
    }
    // `auth: ctx.auth` explicit so the non-null narrowing survives the
    // spread (same reason as chargeMiddleware above).
    return next({ ctx: { ...ctx, auth: ctx.auth, entry } });
  },
);

const OWNER_ONLY_QUESTION_SOURCES = new Set(["USER_ADHOC", "VARIANT_GENERATED"]);

// Plan 8 hotfix (P1 from review): error.diagnose 必须在扣费前校验 questionId 归属，
// 否则用户 A 可拿用户 B 的 USER_ADHOC / VARIANT_GENERATED questionId 调 diagnose，被扣费 + 信息泄露
// (B 的题面会被读出并写入 A 的错题本)。同 Plan 4 validateEntryOwnership 同款隐私
// 不变量：USER_ADHOC / VARIANT_GENERATED 跨用户与 questionId 不存在合并为同一 NOT_FOUND，避免存在性侧信道。
//
// 链顺序硬约束（与 Plan 4 Blocker 1 同理）：
//   authedProcedure.use(validateQuestionAccess).use(chargeMiddleware("ERROR_ANALYSIS"))
// 反了即"拿到不存在 / 跨用户 questionId 也扣费"，写 DEBIT 然后 compensate，
// 余额虽然没变但 ledger 噪音 + 无意义 AI 调用。
//
// 访问规则：
//   USER_ADHOC / VARIANT_GENERATED: createdByUserId === ctx.auth.userId → 允许；否则 NOT_FOUND
//   其它 source（含 null / 自有 / PUBLISHED 等）：允许（题库公共题）
//   missing questionId / 不存在的 id → BAD_REQUEST / NOT_FOUND
//
// 注入 ctx.question (含 answer + knowledgePoints) 省一次 DB round trip，模式跟
// validateEntryOwnership 一致。
export const validateQuestionAccess = t.middleware(
  async ({ ctx, next, getRawInput }) => {
    if (!ctx.auth) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "请先登录",
        cause: { reason: ctx.authError ?? "NO_SESSION" },
      });
    }
    const raw = await getRawInput();
    const parsed = z
      .object({ questionId: z.string().cuid() })
      .safeParse(raw);
    if (!parsed.success) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "缺少 questionId",
        cause: { reason: "QUESTION_ID_REQUIRED" },
      });
    }
    const question = await ctx.db.question.findUnique({
      where: { id: parsed.data.questionId },
      include: {
        answer: true,
        knowledgePoints: { include: { kp: true } },
      },
    });
    if (
      !question ||
      (question.source != null &&
        OWNER_ONLY_QUESTION_SOURCES.has(question.source) &&
        question.createdByUserId !== ctx.auth.userId)
    ) {
      // 合并 missing + cross-user owner-only questions 为同一 NOT_FOUND/QUESTION_NOT_FOUND
      // 关键：必须在 chargeMiddleware 之前抛出，不写 DEBIT
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "题目不存在",
        cause: { reason: "QUESTION_NOT_FOUND" },
      });
    }
    return next({ ctx: { ...ctx, auth: ctx.auth, question } });
  },
);

/**
 * Plan 8 spec §3.2: tutor.ask 输入合规中间件。链顺序：
 *   authedProcedure.use(validateTutorInputCompliance).use(chargeMiddleware("TUTOR_ASK"))
 *
 * 边界处理：
 *   非 string / 空 string / 超长 (>4000) → return next()，让 zod 后续抛常规 BAD_REQUEST
 *     （注意 spec §3.2 副作用：超长 stem 因 chargeMiddleware 在 zod 之前，会产生
 *      DEBIT + COMPENSATION 配对净余额不变；与违禁词路径不同。test 断言要分清两者）
 *   合法长度 → 扫 findForbidden；命中 → 抛 BAD_REQUEST / INPUT_COMPLIANCE_REJECTED
 *     （在 chargeMiddleware 之前 → 不扣费、不写 Question、不调 AI）
 *
 * 不复制 zod max(4000) 约束（单一真理源）。
 */
export const validateTutorInputCompliance = t.middleware(async ({ next, getRawInput }) => {
  const raw = (await getRawInput()) as { questionStem?: unknown } | undefined;
  const stem = typeof raw?.questionStem === "string" ? raw.questionStem : "";
  if (stem.length === 0 || stem.length > 4000) return next();
  const hits = findForbidden(stem);
  if (hits.length > 0) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "题目内容未通过安全检查，请修改后再试。",
      cause: { reason: "INPUT_COMPLIANCE_REJECTED", hits },
    });
  }
  return next();
});
