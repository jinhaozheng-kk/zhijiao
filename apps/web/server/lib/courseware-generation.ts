import type { Prisma, PrismaClient, GradeLevel } from "@prisma/client";
import { LESSON_SECTION_ORDER } from "@zhijiao/ai";

export interface CwSection {
  type: string;
  title: string;
  contentMd: string;
}

// 落库按固定 type 顺序 position 1..5（不信任 AI 返回顺序）。schema 已保证五类型各一。
export async function persistGeneratedCourseware(
  db: PrismaClient,
  args: {
    teacherUserId: string;
    subjectId: string;
    title: string;
    gradeLevel: GradeLevel | null;
    paramsJson: Prisma.InputJsonValue;
    debitLedgerId: string | null;
    modelCallId: string | null;
    sections: CwSection[];
  },
) {
  const ordered = LESSON_SECTION_ORDER.map((type) => {
    const s = args.sections.find((x) => x.type === type);
    if (!s) throw new Error(`missing section ${type}`);
    return s;
  });
  return db.courseware.create({
    data: {
      teacherUserId: args.teacherUserId,
      subjectId: args.subjectId,
      title: args.title,
      gradeLevel: args.gradeLevel ?? undefined,
      paramsJson: args.paramsJson,
      generationLedgerId: args.debitLedgerId,
      generationCallId: args.modelCallId,
      sections: {
        create: ordered.map((s, i) => ({
          position: i + 1,
          type: s.type as never,
          title: s.title,
          contentMd: s.contentMd,
        })),
      },
    },
  });
}
