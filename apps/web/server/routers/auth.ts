import "server-only";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import {
  AuthError, issueOtp, verifyOtp,
  takeRule, RedisRateLimitStore, RULE_OTP_SEND_PHONE, RULE_OTP_SEND_IP, RULE_OTP_VERIFY_PH, RULE_REGISTER_IP,
  putRegisterPayload, buildRegisterCookie,
  peekRegisterPayload, markRegisterUsed, abortRegister,
  COOKIE_REGISTER, clearCookie,
  RateLimitBackendDownError,
} from "@zhijiao/auth";
import { buildSmsAdapter } from "@zhijiao/integrations";
import { router, publicProcedure, authedProcedure } from "../trpc.js";
import { appendSetCookie } from "../cookie-utils.js";
import { issueSessionAndCookies, findUserByPhone } from "../auth-service.js";
import { deriveIsMinor, type Persona } from "@zhijiao/domain";
import { Prisma, SessionRevokeReason } from "@prisma/client";
import { env } from "../env.js";

const PhoneSchema = z.string().regex(/^1\d{10}$/, "手机号格式不正确（11 位以 1 开头）");

const RegisterInput = z.object({
  persona: z.enum(["STUDENT", "TEACHER", "PARENT"]),
  gradeLevel: z.enum(["G5","G6","G7","G8","G9","G10","G11","G12"]).optional().nullable(),
  name: z.string().min(1).max(40).optional(),
});

const isPrismaUnique = (e: unknown): boolean =>
  e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";

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
      const { code } = await issueOtp(ctx.db, { phone: input.phone, purpose: "LOGIN", pepper: env.OTP_PEPPER, ipCreated: ctx.ip, userAgent: ctx.ua });
      const sms = buildSmsAdapter(process.env);
      await sms.send(input.phone, code);
      // In E2E test mode, stash the code in Redis so /api/e2e-hooks/last-otp can retrieve it
      // across webpack bundle boundaries (each Next.js route is an isolated bundle).
      if (process.env.E2E_TEST_HOOKS === "1") {
        await ctx.redis.set(`e2e:last-otp:${input.phone}`, code, "EX", 300);
      }
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
        await verifyOtp(ctx.db, input.phone, input.code, env.OTP_PEPPER);
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

  registerInfo: publicProcedure.query(async ({ ctx }) => {
    const nonce = ctx.cookies[COOKIE_REGISTER];
    if (!nonce) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "REGISTER_TOKEN_MISSING", cause: { reason: "REGISTER_TOKEN_MISSING" } });
    }
    try {
      const payload = await peekRegisterPayload(ctx.redis, nonce);
      return { provider: payload.provider, providerScope: payload.providerScope, suggestedName: payload.profile?.nickname ?? null };
    } catch {
      // 清前端 cookie，避免反复重试
      appendSetCookie(ctx.resHeaders, clearCookie(COOKIE_REGISTER, "/"));
      throw new TRPCError({ code: "BAD_REQUEST", message: "REGISTER_TOKEN_MISSING", cause: { reason: "REGISTER_TOKEN_MISSING" } });
    }
  }),

  register: publicProcedure
    .input(RegisterInput)
    .mutation(async ({ ctx, input }) => {
      // 限频闸门（fail-open；Redis 挂时不踩用户脚）。先于 nonce / payload 检查，
      // 抗"同源大量注册尝试"——无论 nonce 是否合法，IP 维度的桶都会扣。
      const store = ratelimitStore(ctx.redis);
      try {
        const r = await takeRule(store, RULE_REGISTER_IP, ctx.ip);
        if (!r.allowed) toTRPCError("REGISTER_TOO_FREQUENT", "TOO_MANY_REQUESTS", { retryAfterMs: r.retryAfterMs });
      } catch (e) {
        if (e instanceof RateLimitBackendDownError) toTRPCError("RATELIMIT_BACKEND_DOWN", "INTERNAL_SERVER_ERROR");
        throw e;
      }

      const nonce = ctx.cookies[COOKIE_REGISTER];
      if (!nonce) toTRPCError("REGISTER_TOKEN_MISSING", "BAD_REQUEST");

      let payload;
      try {
        payload = await peekRegisterPayload(ctx.redis, nonce);
      } catch {
        appendSetCookie(ctx.resHeaders, clearCookie(COOKIE_REGISTER, "/"));
        toTRPCError("REGISTER_TOKEN_MISSING", "BAD_REQUEST");
      }

      if (input.persona === "STUDENT" && !input.gradeLevel) {
        // 表单错误 —— 不清 cookie，让用户改完再交（spec §3.3）
        toTRPCError("REGISTER_GRADE_REQUIRED", "BAD_REQUEST");
      }

      const isMinor = deriveIsMinor(input.persona as Persona, input.gradeLevel ?? null);

      try {
        const userId = await ctx.db.$transaction(async (tx) => {
          const u = await tx.user.create({
            data: {
              persona: input.persona,
              gradeLevel: input.gradeLevel ?? undefined,
              isMinor,
              name: input.name ?? payload!.profile?.nickname ?? null,
              identities: {
                create: [{
                  provider: payload!.provider,
                  providerScope: payload!.providerScope,
                  providerUserId: payload!.providerUserId,
                  unionId: payload!.unionId,
                  metadata: payload!.profile as object | undefined,
                }],
              },
            },
          });
          return u.id;
        });

        await markRegisterUsed(ctx.redis, nonce, payload!);
        appendSetCookie(ctx.resHeaders, clearCookie(COOKIE_REGISTER, "/"));
        const { user, defaultRoute } = await issueSessionAndCookies({
          prisma: ctx.db, userId, resHeaders: ctx.resHeaders, ip: ctx.ip, ua: ctx.ua,
        });
        return { user, defaultRoute };
      } catch (e) {
        if (isPrismaUnique(e)) {
          // 并发/双击：identity 已被另一个并发请求建出来
          await abortRegister(ctx.redis, nonce, payload!);
          appendSetCookie(ctx.resHeaders, clearCookie(COOKIE_REGISTER, "/"));
          toTRPCError("REGISTER_CONFLICT", "CONFLICT");
        }
        throw e;
      }
    }),

  me: authedProcedure.query(async ({ ctx }) => {
    const user = await ctx.db.user.findUniqueOrThrow({
      where: { id: ctx.auth.userId }, include: { roles: true },
    });
    const sessions = await ctx.db.session.findMany({
      where: { userId: user.id, revokedAt: null },
      select: { id: true, deviceLabel: true, ipCreated: true, userAgent: true, createdAt: true, lastUsedAt: true, expiresAt: true },
      orderBy: { lastUsedAt: "desc" },
    });
    return {
      user: { id: user.id, name: user.name, persona: user.persona, gradeLevel: user.gradeLevel, isMinor: user.isMinor, roles: user.roles.map(r => r.role) },
      sessions,
    };
  }),

  revokeSession: authedProcedure
    .input(z.object({ sessionId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const sess = await ctx.db.session.findUnique({ where: { id: input.sessionId } });
      if (!sess || sess.userId !== ctx.auth.userId) {
        throw new TRPCError({ code: "FORBIDDEN", message: "not yours", cause: { reason: "PERMISSION_DENIED" } });
      }
      await ctx.db.session.update({
        where: { id: input.sessionId },
        data: { revokedAt: new Date(), revokedReason: SessionRevokeReason.ADMIN_REVOKED },
      });
      return { ok: true as const };
    }),
});
