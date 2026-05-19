import "server-only";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import {
  AuthError, issueOtp, verifyOtp,
  takeRule, RedisRateLimitStore, RULE_OTP_SEND_PHONE, RULE_OTP_SEND_IP, RULE_OTP_VERIFY_PH,
  putRegisterPayload, buildRegisterCookie,
  RateLimitBackendDownError,
} from "@zhijiao/auth";
import { buildSmsAdapter } from "@zhijiao/integrations";
import { router, publicProcedure } from "../trpc.js";
import { appendSetCookie } from "../cookie-utils.js";
import { issueSessionAndCookies, findUserByPhone } from "../auth-service.js";

const PhoneSchema = z.string().regex(/^1\d{10}$/, "手机号格式不正确（11 位以 1 开头）");

function ratelimitStore(redis: import("ioredis").default) { return new RedisRateLimitStore(redis); }

function toTRPCError(reason: string, code: "BAD_REQUEST" | "TOO_MANY_REQUESTS" | "UNAUTHORIZED" | "INTERNAL_SERVER_ERROR" | "CONFLICT", extra?: object): never {
  throw new TRPCError({ code, message: reason, cause: { reason, ...extra } });
}

export const authRouter = router({
  otpRequest: publicProcedure
    .input(z.object({ phone: PhoneSchema }))
    .mutation(async ({ ctx, input }) => {
      const store = ratelimitStore(ctx.redis);
      try {
        const r1 = await takeRule(store, RULE_OTP_SEND_PHONE, input.phone);
        if (!r1.allowed) toTRPCError("OTP_SEND_TOO_FREQUENT", "TOO_MANY_REQUESTS", { retryAfterMs: r1.retryAfterMs });
        const r2 = await takeRule(store, RULE_OTP_SEND_IP, ctx.ip);
        if (!r2.allowed) toTRPCError("OTP_SEND_TOO_FREQUENT", "TOO_MANY_REQUESTS", { retryAfterMs: r2.retryAfterMs });
      } catch (e) {
        if (e instanceof RateLimitBackendDownError) toTRPCError("RATELIMIT_BACKEND_DOWN", "INTERNAL_SERVER_ERROR");
        throw e;
      }
      const { code } = await issueOtp(ctx.db, { phone: input.phone, purpose: "LOGIN", pepper: process.env.OTP_PEPPER ?? "", ipCreated: ctx.ip, userAgent: ctx.ua });
      const sms = buildSmsAdapter(process.env);
      await sms.send(input.phone, code);
      return { ok: true as const };
    }),

  otpVerify: publicProcedure
    .input(z.object({ phone: PhoneSchema, code: z.string().regex(/^\d{6}$/) }))
    .mutation(async ({ ctx, input }) => {
      const store = ratelimitStore(ctx.redis);
      try {
        const r = await takeRule(store, RULE_OTP_VERIFY_PH, input.phone);
        if (!r.allowed) toTRPCError("OTP_VERIFY_TOO_FREQUENT", "TOO_MANY_REQUESTS", { retryAfterMs: r.retryAfterMs });
      } catch (e) {
        if (e instanceof RateLimitBackendDownError) toTRPCError("RATELIMIT_BACKEND_DOWN", "INTERNAL_SERVER_ERROR");
        throw e;
      }
      try {
        await verifyOtp(ctx.db, input.phone, input.code, process.env.OTP_PEPPER ?? "");
      } catch (e) {
        if (e instanceof AuthError) toTRPCError(e.reason, "BAD_REQUEST", e.extra);
        throw e;
      }

      // 命中已注册 → issueSession
      const existing = await findUserByPhone(ctx.db, input.phone);
      if (existing) {
        const { user, defaultRoute } = await issueSessionAndCookies({
          prisma: ctx.db, userId: existing.id, resHeaders: ctx.resHeaders, ip: ctx.ip, ua: ctx.ua,
        });
        return { status: "logged_in" as const, user, defaultRoute };
      }

      // 未注册 → 写 register payload + set cookie nonce
      const nonce = await putRegisterPayload(ctx.redis, {
        provider: "PHONE", providerScope: "GLOBAL", providerUserId: input.phone,
      });
      appendSetCookie(ctx.resHeaders, buildRegisterCookie(nonce));
      return { status: "need_register" as const };
    }),
});
