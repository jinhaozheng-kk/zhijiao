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

  // 家长绑定
  bindByCode: authedProcedure
    .input(z.object({ code: z.string().min(4).max(16) }))
    .mutation(async ({ ctx, input }) => {
      const studentUserId = await ctx.redis.get(inviteKey(input.code));
      if (!studentUserId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "邀请码无效或已过期", cause: { reason: "INVITE_INVALID" } });
      }
      if (studentUserId === ctx.auth.userId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "不能绑定自己", cause: { reason: "CANNOT_BIND_SELF" } });
      }
      // upsert：复活 REVOKED / 幂等 ACTIVE
      await ctx.db.familyLink.upsert({
        where: { parentUserId_studentUserId: { parentUserId: ctx.auth.userId, studentUserId } },
        update: { status: "ACTIVE", revokedAt: null },
        create: { parentUserId: ctx.auth.userId, studentUserId, status: "ACTIVE" },
      });
      await ctx.redis.del(inviteKey(input.code)); // 单次用尽
      const student = await ctx.db.user.findUnique({
        where: { id: studentUserId },
        select: { id: true, name: true, gradeLevel: true },
      });
      return { studentUserId, name: student?.name ?? null, gradeLevel: student?.gradeLevel ?? null };
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
      if (link.status === "ACTIVE") {
        await ctx.db.familyLink.update({
          where: { id: link.id },
          data: { status: "REVOKED", revokedAt: new Date() },
        });
      }
      return { ok: true as const };
    }),
});
