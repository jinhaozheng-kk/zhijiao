import { NextResponse } from "next/server";
import { prisma } from "@zhijiao/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  if (process.env.E2E_TEST_HOOKS !== "1") {
    return NextResponse.json({ error: "disabled" }, { status: 404 });
  }

  const [teacher, student, classroom, subject] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: "dev-teacher-01" } }),
    prisma.user.findUniqueOrThrow({ where: { id: "dev-student-01" } }),
    prisma.classroom.findUniqueOrThrow({
      where: { id: "dev-classroom-math-g8-01" },
    }),
    prisma.subject.findUniqueOrThrow({ where: { code: "math" } }),
  ]);

  const question = await prisma.question.create({
    data: {
      subjectId: subject.id,
      stemMd: "Solve x + 3 = 7.",
      type: "CALCULATION",
      difficulty: 2,
      status: "PUBLISHED",
      source: "ASSIGNMENT_GENERATED",
      createdByUserId: teacher.id,
      answer: {
        create: {
          contentMd: "x = 4",
          solutionMd: "Subtract 3 from both sides.",
        },
      },
    },
  });

  const assignment = await prisma.assignment.create({
    data: {
      classroomId: classroom.id,
      teacherUserId: teacher.id,
      title: "E2E Tiered Assignment",
      source: "MANUAL_AI",
      status: "PUBLISHED",
      publishedAt: new Date(),
      tiers: {
        create: {
          level: "CONSOLIDATION",
          title: "Practice",
          rationaleMd: "E2E deterministic fixture",
          items: {
            create: {
              questionId: question.id,
              position: 1,
              stemMd: "Solve x + 3 = 7.",
              type: "CALCULATION",
              answerMd: "x = 4",
              solutionMd: "Subtract 3 from both sides.",
              kpHints: ["linear equations"],
            },
          },
        },
      },
    },
    include: { tiers: { include: { items: true } } },
  });
  const tier = assignment.tiers[0]!;
  const item = tier.items[0]!;
  const studentAssignment = await prisma.studentAssignment.create({
    data: {
      assignmentId: assignment.id,
      studentUserId: student.id,
      tierId: tier.id,
      suggestedTier: "CONSOLIDATION",
    },
  });

  return NextResponse.json({
    assignmentId: assignment.id,
    studentAssignmentId: studentAssignment.id,
    itemId: item.id,
  });
}
