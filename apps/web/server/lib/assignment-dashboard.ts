import type { PrismaClient } from "@prisma/client";

export async function getClassroomAssignmentSummary(
  db: PrismaClient,
  classroomId: string,
) {
  const [assignmentCount, studentAssignmentCount] = await Promise.all([
    db.assignment.count({ where: { classroomId } }),
    db.studentAssignment.count({ where: { assignment: { classroomId } } }),
  ]);
  return { assignmentCount, studentAssignmentCount };
}
