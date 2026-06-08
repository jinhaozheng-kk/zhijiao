import "server-only";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { authedProcedure, router } from "../trpc.js";
import {
  takeRule, RedisRateLimitStore, RULE_DSAR_EXPORT, RULE_DSAR_VERIFY_PH,
  RULE_OTP_SEND_PHONE, RULE_OTP_SEND_IP, RateLimitBackendDownError, issueOtp, verifyOtp, AuthError,
} from "@zhijiao/auth";
import { env } from "../env.js";
import { exportUserData } from "../lib/pii-governance.js";
import {
  recordExportRequest, createDeletionRequest, approveChildDeletion, cancelDeletionRequest,
  listOwnRequests, listPendingChildApprovals, NeedsGuardianError,
} from "../lib/dsar.js";

const store = (redis: import("ioredis").default) => new RedisRateLimitStore(redis);

function shouldApplyOtpSendRateLimit(): boolean {
  return process.env.E2E_TEST_HOOKS !== "1";
}

async function ownPhone(db: typeof import("@zhijiao/db").prisma, userId: string): Promise<string | null> {
  const id = await db.authIdentity.findFirst({ where: { userId, provider: "PHONE", providerScope: "GLOBAL" }, select: { providerUserId: true } });
  return id?.providerUserId ?? null;
}

export const dsarRouter = router({
  exportMine: authedProcedure.mutation(async ({ ctx }) => {
    try {
      const a = await takeRule(store(ctx.redis), RULE_DSAR_EXPORT, ctx.auth.userId);
      if (!a.allowed) throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "导出过于频繁,请稍后再试", cause: { reason: "DSAR_EXPORT_TOO_FREQUENT" } });
      const b = await takeRule(store(ctx.redis), RULE_DSAR_EXPORT, ctx.ip);
      if (!b.allowed) throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "导出过于频繁,请稍后再试", cause: { reason: "DSAR_EXPORT_TOO_FREQUENT" } });
    } catch (e) {
      if (e instanceof RateLimitBackendDownError) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "服务暂时不可用", cause: { reason: "RATELIMIT_BACKEND_DOWN" } });
      throw e;
    }
    return ctx.db.$transaction(async (tx) => {
      const data = await exportUserData(tx, ctx.auth.userId);
      const rec = await recordExportRequest(tx, { userId: ctx.auth.userId, isMinor: ctx.auth.isMinor });
      return { export: data, requestId: rec.id };
    });
  }),

  sendDeletionOtp: authedProcedure.mutation(async ({ ctx }) => {
    const phone = await ownPhone(ctx.db, ctx.auth.userId);
    if (!phone) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "未绑定手机号,请通过客服渠道办理注销", cause: { reason: "DSAR_NO_PHONE" } });
    if (shouldApplyOtpSendRateLimit()) {
      try {
        const a = await takeRule(store(ctx.redis), RULE_OTP_SEND_PHONE, phone);
        if (!a.allowed) throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "验证码发送过于频繁", cause: { reason: "OTP_SEND_TOO_FREQUENT" } });
        const b = await takeRule(store(ctx.redis), RULE_OTP_SEND_IP, ctx.ip);
        if (!b.allowed) throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "验证码发送过于频繁", cause: { reason: "OTP_SEND_TOO_FREQUENT" } });
      } catch (e) {
        if (e instanceof RateLimitBackendDownError) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "服务暂时不可用", cause: { reason: "RATELIMIT_BACKEND_DOWN" } });
        throw e;
      }
    }
    const { code } = await issueOtp(ctx.db, { phone, purpose: "DSAR_DELETION", pepper: env.OTP_PEPPER, ipCreated: ctx.ip, userAgent: ctx.ua });
    if (process.env.E2E_TEST_HOOKS === "1") await ctx.redis.set(`e2e:last-otp:${phone}`, code, "EX", 300);
    return { ok: true as const };
  }),

  requestDeletion: authedProcedure
    .input(z.object({ otpCode: z.string().min(4).max(8), reason: z.string().max(500).optional() }))
    .mutation(async ({ ctx, input }) => {
      const phone = await ownPhone(ctx.db, ctx.auth.userId);
      if (!phone) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "未绑定手机号", cause: { reason: "DSAR_NO_PHONE" } });
      try {
        const v = await takeRule(store(ctx.redis), RULE_DSAR_VERIFY_PH, phone);
        if (!v.allowed) throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "验证过于频繁", cause: { reason: "OTP_VERIFY_TOO_FREQUENT" } });
      } catch (e) {
        if (e instanceof RateLimitBackendDownError) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "服务暂时不可用", cause: { reason: "RATELIMIT_BACKEND_DOWN" } });
        throw e;
      }
      try {
        await verifyOtp(ctx.db, phone, input.otpCode, env.OTP_PEPPER, "DSAR_DELETION");
      } catch (e) {
        if (e instanceof AuthError) throw new TRPCError({ code: "BAD_REQUEST", message: "验证码无效或已过期", cause: { reason: e.reason } });
        throw e;
      }
      const needsGuardian = ctx.auth.isMinor || ctx.auth.guardianConsentStatus !== "NOT_REQUIRED";
      const hasActiveGuardian = needsGuardian
        ? (await ctx.db.familyLink.count({ where: { studentUserId: ctx.auth.userId, status: "ACTIVE" } })) > 0
        : false;
      try {
        const { request } = await createDeletionRequest(ctx.db, { userId: ctx.auth.userId, needsGuardian, hasActiveGuardian, reason: input.reason ?? null });
        return { request };
      } catch (e) {
        if (e instanceof NeedsGuardianError) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "未成年人注销需由已绑定的监护人在站内确认,请先绑定监护人或通过客服渠道办理", cause: { reason: "DSAR_GUARDIAN_REQUIRED" } });
        throw e;
      }
    }),

  approveChildDeletion: authedProcedure
    .input(z.object({ childUserId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const link = await ctx.db.familyLink.findFirst({ where: { parentUserId: ctx.auth.userId, studentUserId: input.childUserId, status: "ACTIVE" } });
      if (!link) throw new TRPCError({ code: "NOT_FOUND", message: "未找到可审批的注销申请", cause: { reason: "DSAR_NOT_FOUND" } });
      const approved = await approveChildDeletion(ctx.db, { childUserId: input.childUserId, guardianUserId: ctx.auth.userId });
      if (!approved) throw new TRPCError({ code: "NOT_FOUND", message: "未找到可审批的注销申请", cause: { reason: "DSAR_NOT_FOUND" } });
      return approved;
    }),

  cancelDeletion: authedProcedure.mutation(async ({ ctx }) => {
    const cancelled = await cancelDeletionRequest(ctx.db, { userId: ctx.auth.userId });
    if (!cancelled) throw new TRPCError({ code: "NOT_FOUND", message: "没有进行中的注销申请", cause: { reason: "DSAR_NOT_FOUND" } });
    return cancelled;
  }),

  myRequests: authedProcedure.query(async ({ ctx }) => ({ requests: await listOwnRequests(ctx.db, ctx.auth.userId) })),

  pendingChildApprovals: authedProcedure.query(async ({ ctx }) => ({ items: await listPendingChildApprovals(ctx.db, ctx.auth.userId) })),
});
