import { TRPCError } from "@trpc/server";
import type { PrismaClient } from "@prisma/client";

export type ProfileRelationship = "self" | "parent" | "teacher";

// 返回 viewer 对 target 学情的访问关系；无任何关系 → NOT_FOUND（不用 FORBIDDEN，
// 避免暴露 "此 userId 存在"。与 validateEntryOwnership / validateQuestionAccess 同款隐私不变量）。
export async function requireProfileAccess(
  db: PrismaClient,
  viewerId: string,
  targetId: string,
): Promise<ProfileRelationship> {
  if (viewerId === targetId) return "self";

  const parentLink = await db.familyLink.findFirst({
    where: { parentUserId: viewerId, studentUserId: targetId, status: "ACTIVE" },
    select: { id: true },
  });
  if (parentLink) return "parent";

  // teacher: viewer 拥有的 classroom（role TEACHER）中存在 target 作为 STUDENT 成员
  const teacherClassrooms = await db.classroomMember.findMany({
    where: { userId: viewerId, role: "TEACHER" },
    select: { classroomId: true },
  });
  if (teacherClassrooms.length > 0) {
    const shared = await db.classroomMember.findFirst({
      where: {
        userId: targetId,
        role: "STUDENT",
        classroomId: { in: teacherClassrooms.map((c) => c.classroomId) },
      },
      select: { classroomId: true },
    });
    if (shared) return "teacher";
  }

  throw new TRPCError({
    code: "NOT_FOUND",
    message: "无法访问该学情",
    cause: { reason: "PROFILE_NOT_ACCESSIBLE" },
  });
}
