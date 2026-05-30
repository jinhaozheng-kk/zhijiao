import "server-only";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { authedProcedure, router } from "../trpc.js";

const INVITE_TTL_SEC = 900; // 15 分钟
const inviteKey = (code: string) => `family:invite:${code}`;

// 8 字符 URL-safe（base64url 去歧义字符）
function genCode(): string {
  return randomBytes(6).toString("base64url").slice(0, 8);
}

export const familyRouter = router({
  // 学生发码（数据主体持发起权）
  createInviteCode: authedProcedure.mutation(async ({ ctx }) => {
    const code = genCode();
    await ctx.redis.set(inviteKey(code), ctx.auth.userId, "EX", INVITE_TTL_SEC);
    return { code, expiresInSec: INVITE_TTL_SEC };
  }),

  // 家长绑定。Plan 14a：<14 child（guardianConsentStatus=PENDING）必须勾选监护人同意
  // 才能绑定，且同事务写 GuardianConsent 审计行 + 激活（GRANTED）。
  bindByCode: authedProcedure
    .input(z.object({ code: z.string().min(4).max(16), guardianConsent: z.boolean().optional() }))
    .mutation(async ({ ctx, input }) => {
      const studentUserId = await ctx.redis.get(inviteKey(input.code));
      if (!studentUserId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "邀请码无效或已过期", cause: { reason: "INVITE_INVALID" } });
      }
      if (studentUserId === ctx.auth.userId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "不能绑定自己", cause: { reason: "CANNOT_BIND_SELF" } });
      }
      const child = await ctx.db.user.findUnique({
        where: { id: studentUserId },
        select: { id: true, name: true, gradeLevel: true, guardianConsentStatus: true },
      });
      if (!child) {
        throw new TRPCError({ code: "NOT_FOUND", message: "邀请码无效或已过期", cause: { reason: "INVITE_INVALID" } });
      }
      // <14 child（PENDING 或已 GRANTED）每个监护人绑定都需记录其同意；NOT_REQUIRED（≥14/成年）不需。
      const needsConsent = child.guardianConsentStatus !== "NOT_REQUIRED";
      if (needsConsent && input.guardianConsent !== true) {
        // 同意未提供 —— 不消费邀请码（家长可阅读声明后带 guardianConsent:true 重试）
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "请阅读并确认监护人同意声明",
          cause: { reason: "GUARDIAN_CONSENT_NOT_PROVIDED" },
        });
      }

      await ctx.db.$transaction(async (tx) => {
        // upsert：复活 REVOKED / 幂等 ACTIVE
        await tx.familyLink.upsert({
          where: { parentUserId_studentUserId: { parentUserId: ctx.auth.userId, studentUserId } },
          update: { status: "ACTIVE", revokedAt: null },
          create: { parentUserId: ctx.auth.userId, studentUserId, status: "ACTIVE" },
        });
        if (needsConsent) {
          // 幂等：同一 (child, guardian) 已有有效 consent 则不重复写
          const existing = await tx.guardianConsent.findFirst({
            where: { childUserId: studentUserId, guardianUserId: ctx.auth.userId, revokedAt: null },
            select: { id: true },
          });
          if (!existing) {
            await tx.guardianConsent.create({
              data: {
                childUserId: studentUserId,
                guardianUserId: ctx.auth.userId,
                consentScope: "FULL_SERVICE",
                method: "FAMILY_LINK_BIND",
              },
            });
          }
          await tx.user.update({
            where: { id: studentUserId },
            data: { guardianConsentStatus: "GRANTED" },
          });
        }
      });

      await ctx.redis.del(inviteKey(input.code)); // 单次用尽
      return { studentUserId, name: child.name ?? null, gradeLevel: child.gradeLevel ?? null };
    }),

  listMyChildren: authedProcedure.query(async ({ ctx }) => {
    const links = await ctx.db.familyLink.findMany({
      where: { parentUserId: ctx.auth.userId, status: "ACTIVE" },
      orderBy: { createdAt: "desc" },
      select: { id: true, student: { select: { id: true, name: true, gradeLevel: true } } },
    });
    return {
      children: links.map((l) => ({
        linkId: l.id,
        userId: l.student.id,
        name: l.student.name,
        gradeLevel: l.student.gradeLevel,
      })),
    };
  }),

  // 任一方可撤销；非 link 双方 → NOT_FOUND（不暴露存在性）
  revoke: authedProcedure
    .input(z.object({ linkId: z.string().cuid() }))
    .mutation(async ({ ctx, input }) => {
      const link = await ctx.db.familyLink.findUnique({ where: { id: input.linkId } });
      if (!link || (link.parentUserId !== ctx.auth.userId && link.studentUserId !== ctx.auth.userId)) {
        throw new TRPCError({ code: "NOT_FOUND", message: "绑定不存在", cause: { reason: "LINK_NOT_FOUND" } });
      }
      await ctx.db.$transaction(async (tx) => {
        if (link.status === "ACTIVE") {
          await tx.familyLink.update({
            where: { id: link.id },
            data: { status: "REVOKED", revokedAt: new Date() },
          });
        }
        // Plan 14a：撤回该 (parent, child) 的有效监护人同意；若 child 失去全部有效 consent → 回 PENDING（重新硬门禁）。
        await tx.guardianConsent.updateMany({
          where: { childUserId: link.studentUserId, guardianUserId: link.parentUserId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        const remaining = await tx.guardianConsent.count({
          where: { childUserId: link.studentUserId, revokedAt: null },
        });
        const childRow = await tx.user.findUnique({
          where: { id: link.studentUserId }, select: { guardianConsentStatus: true },
        });
        if (remaining === 0 && childRow?.guardianConsentStatus === "GRANTED") {
          await tx.user.update({
            where: { id: link.studentUserId }, data: { guardianConsentStatus: "PENDING" },
          });
        }
      });
      return { ok: true as const };
    }),
});
