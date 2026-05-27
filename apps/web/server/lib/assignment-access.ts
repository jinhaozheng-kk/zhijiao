import { TRPCError } from "@trpc/server";
import type { PrismaClient } from "@prisma/client";

export async function requireTeacherClassroom(
  db: PrismaClient,
  userId: string,
  classroomId: string,
) {
  const member = await db.classroomMember.findUnique({
    where: { classroomId_userId: { classroomId, userId } },
    include: { classroom: true },
  });
  if (!member || member.role !== "TEACHER") {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Classroom not found",
      cause: { reason: "CLASSROOM_NOT_FOUND" },
    });
  }
  return member.classroom;
}

export async function requireTeacherAssignment(
  db: PrismaClient,
  userId: string,
  assignmentId: string,
) {
  const assignment = await db.assignment.findUnique({
    where: { id: assignmentId },
    include: { classroom: true, tiers: { include: { items: true } } },
  });
  if (!assignment || assignment.teacherUserId !== userId) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Assignment not found",
      cause: { reason: "ASSIGNMENT_NOT_FOUND" },
    });
  }
  return assignment;
}
