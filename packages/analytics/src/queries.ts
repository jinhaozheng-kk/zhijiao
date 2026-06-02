import type { PrismaClient } from "@prisma/client";
import { aggregateMastery, aggregateClassDiagnosis, HALF_LIFE_DAYS } from "./core.js";
import type {
  AnalyticsWindow,
  LearningProfile,
  ClassDiagnosis,
  PerfSample,
  ErrorSample,
  KpMastery,
} from "./types.js";

const WINDOW_DAYS: Record<AnalyticsWindow, number | null> = {
  D30: 30,
  D90: 90,
  ALL: null,
};

function cutoffFor(window: AnalyticsWindow, now: Date): Date | null {
  const days = WINDOW_DAYS[window];
  return days === null ? null : new Date(now.getTime() - days * 86_400_000);
}

function ageDays(createdAt: Date, now: Date): number {
  return (now.getTime() - createdAt.getTime()) / 86_400_000;
}

// 把一批 kpId 解析成 kpMeta（KP 名）。
async function loadKpMeta(
  db: PrismaClient,
  kpIds: Set<string>,
): Promise<Map<string, string>> {
  if (kpIds.size === 0) return new Map();
  const kps = await db.knowledgePoint.findMany({
    where: { id: { in: [...kpIds] } },
    select: { id: true, name: true },
  });
  return new Map(kps.map((k) => [k.id, k.name]));
}

export async function profileForStudent(
  db: PrismaClient,
  args: { userId: string; window: AnalyticsWindow; now?: Date },
): Promise<LearningProfile> {
  const now = args.now ?? new Date();
  const cutoff = cutoffFor(args.window, now);

  const perf = await db.assignmentPerformance.findMany({
    where: {
      studentUserId: args.userId,
      ...(cutoff ? { createdAt: { gte: cutoff } } : {}),
    },
    select: { kpIds: true, gradeStatus: true, createdAt: true },
  });

  // 靶向训练自评结果：降权（自评比教师批改软）混入掌握度，闭合 训练→学情。
  // 不进 classDiagnosis（自主练习不喂班级诊断）。
  const TRAINING_SOURCE_WEIGHT = 0.5;
  const training = await db.trainingAttempt.findMany({
    where: {
      studentUserId: args.userId,
      ...(cutoff ? { createdAt: { gte: cutoff } } : {}),
    },
    select: { kpIds: true, gradeStatus: true, createdAt: true },
  });

  // 错题弱信号：ACTIVE entry → question.knowledgePoints（QuestionKPLink）→ kpId
  const errorEntries = await db.errorBookEntry.findMany({
    where: { userId: args.userId, status: "ACTIVE" },
    select: { question: { select: { knowledgePoints: { select: { kpId: true } } } } },
  });

  const samples: PerfSample[] = [
    ...perf
      .filter((p) => p.gradeStatus !== "UNGRADED")
      .map((p) => ({
        kpIds: p.kpIds,
        gradeStatus: p.gradeStatus as PerfSample["gradeStatus"],
        ageDays: ageDays(p.createdAt, now),
      })),
    ...training
      .filter((t) => t.gradeStatus !== "UNGRADED")
      .map((t) => ({
        kpIds: t.kpIds,
        gradeStatus: t.gradeStatus as PerfSample["gradeStatus"],
        ageDays: ageDays(t.createdAt, now),
        sourceWeight: TRAINING_SOURCE_WEIGHT,
      })),
  ];
  const errors: ErrorSample[] = errorEntries.map((e) => ({
    kpIds: e.question.knowledgePoints.map((l) => l.kpId),
  }));

  const kpIds = new Set<string>();
  for (const s of samples) for (const k of s.kpIds) kpIds.add(k);
  for (const e of errors) for (const k of e.kpIds) kpIds.add(k);
  const kpMeta = await loadKpMeta(db, kpIds);

  const agg = aggregateMastery({ samples, errors, kpMeta, halfLifeDays: HALF_LIFE_DAYS });
  return {
    window: args.window,
    generatedAt: now.toISOString(),
    ...agg,
    focusAreas: agg.masteries.filter((m) => m.tier === "FOCUS").map((m) => m.kpName),
    strengths: agg.masteries.filter((m) => m.tier === "SOLID").map((m) => m.kpName),
  };
}

export async function classDiagnosis(
  db: PrismaClient,
  args: { classroomId: string; window: AnalyticsWindow; now?: Date },
): Promise<ClassDiagnosis> {
  const now = args.now ?? new Date();
  const cutoff = cutoffFor(args.window, now);

  const studentMembers = await db.classroomMember.findMany({
    where: { classroomId: args.classroomId, role: "STUDENT" },
    select: { userId: true },
  });
  const studentIds = studentMembers.map((m) => m.userId);

  const perf = studentIds.length
    ? await db.assignmentPerformance.findMany({
        where: {
          studentUserId: { in: studentIds },
          gradeStatus: { not: "UNGRADED" },
          ...(cutoff ? { createdAt: { gte: cutoff } } : {}),
        },
        select: { studentUserId: true, kpIds: true, gradeStatus: true, createdAt: true },
      })
    : [];

  const kpIds = new Set<string>();
  for (const p of perf) for (const k of p.kpIds) kpIds.add(k);
  const kpMeta = await loadKpMeta(db, kpIds);

  // 按学生分桶 → 每个学生 aggregateMastery → perStudent KpMastery[][]
  const byStudent = new Map<string, PerfSample[]>();
  for (const p of perf) {
    const arr = byStudent.get(p.studentUserId) ?? [];
    arr.push({
      kpIds: p.kpIds,
      gradeStatus: p.gradeStatus as PerfSample["gradeStatus"],
      ageDays: ageDays(p.createdAt, now),
    });
    byStudent.set(p.studentUserId, arr);
  }
  const perStudent: KpMastery[][] = [...byStudent.values()].map(
    (samples) =>
      aggregateMastery({ samples, errors: [], kpMeta, halfLifeDays: HALF_LIFE_DAYS })
        .masteries,
  );

  return aggregateClassDiagnosis({
    classroomId: args.classroomId,
    window: args.window,
    studentCount: studentIds.length,
    perStudent,
    kpMeta,
  });
}
