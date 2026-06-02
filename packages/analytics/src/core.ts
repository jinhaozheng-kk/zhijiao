import type {
  GradeStatusSignal,
  KpMastery,
  MasteryTier,
  PerfSample,
  ErrorSample,
  LearningProfile,
  AnalyticsWindow,
  ClassDiagnosis,
  ClassKpStat,
} from "./types.js";

export const HALF_LIFE_DAYS = 30;
const DATA_FLOOR = 1.0; // weighted sample size below this → INSUFFICIENT_DATA

export function scoreOf(g: GradeStatusSignal): number {
  return g === "CORRECT" ? 1 : g === "PARTIAL" ? 0.5 : 0;
}

export function decayWeight(ageDays: number, halfLifeDays: number): number {
  const age = ageDays < 0 ? 0 : ageDays;
  return Math.pow(0.5, age / halfLifeDays);
}

export function tierOf(score: number, weightedSampleSize: number): MasteryTier {
  if (weightedSampleSize < DATA_FLOOR) return "INSUFFICIENT_DATA";
  if (score < 0.5) return "FOCUS";
  if (score < 0.8) return "PROGRESSING";
  return "SOLID";
}

const TIER_ORDER: Record<MasteryTier, number> = {
  FOCUS: 0,
  PROGRESSING: 1,
  SOLID: 2,
  INSUFFICIENT_DATA: 3,
};

export function aggregateMastery(args: {
  samples: PerfSample[];
  errors: ErrorSample[];
  kpMeta: Map<string, string>;
  halfLifeDays: number;
}): Pick<LearningProfile, "masteries" | "overallScore" | "totalGradedItems" | "hasData"> {
  const acc = new Map<
    string,
    { wScore: number; wSum: number; raw: number; errors: number }
  >();
  const ensure = (kpId: string) => {
    let a = acc.get(kpId);
    if (!a) {
      a = { wScore: 0, wSum: 0, raw: 0, errors: 0 };
      acc.set(kpId, a);
    }
    return a;
  };

  let overallW = 0;
  let overallWScore = 0;
  for (const s of args.samples) {
    const w = decayWeight(s.ageDays, args.halfLifeDays) * (s.sourceWeight ?? 1);
    const sc = scoreOf(s.gradeStatus);
    for (const kpId of s.kpIds) {
      const a = ensure(kpId);
      a.wScore += w * sc;
      a.wSum += w;
      a.raw += 1;
    }
    overallW += w;
    overallWScore += w * sc;
  }
  for (const e of args.errors) {
    for (const kpId of e.kpIds) ensure(kpId).errors += 1;
  }

  const masteries: KpMastery[] = [...acc.entries()].map(([kpId, a]) => {
    const score = a.wSum > 0 ? a.wScore / a.wSum : 0;
    const tier = tierOf(score, a.wSum);
    return {
      kpId,
      kpName: args.kpMeta.get(kpId) ?? kpId,
      tier,
      score: tier === "INSUFFICIENT_DATA" ? null : Number(score.toFixed(4)),
      weightedSampleSize: Number(a.wSum.toFixed(4)),
      rawSampleSize: a.raw,
      recentErrorCount: a.errors,
    };
  });
  masteries.sort((x, y) =>
    TIER_ORDER[x.tier] !== TIER_ORDER[y.tier]
      ? TIER_ORDER[x.tier] - TIER_ORDER[y.tier]
      : (x.score ?? -1) - (y.score ?? -1),
  );

  return {
    masteries,
    overallScore: overallW > 0 ? Number((overallWScore / overallW).toFixed(4)) : null,
    totalGradedItems: args.samples.length,
    hasData: args.samples.length > 0,
  };
}

export function aggregateClassDiagnosis(args: {
  classroomId: string;
  window: AnalyticsWindow;
  studentCount: number;
  // 每个学生已聚合好的 per-KP masteries（来自 aggregateMastery）
  perStudent: KpMastery[][];
  kpMeta: Map<string, string>;
}): ClassDiagnosis {
  const acc = new Map<
    string,
    { scoreSum: number; scored: number; focus: number; students: number }
  >();
  for (const studentMasteries of args.perStudent) {
    for (const m of studentMasteries) {
      let a = acc.get(m.kpId);
      if (!a) {
        a = { scoreSum: 0, scored: 0, focus: 0, students: 0 };
        acc.set(m.kpId, a);
      }
      a.students += 1;
      if (m.tier === "FOCUS") a.focus += 1;
      if (m.score !== null) {
        a.scoreSum += m.score;
        a.scored += 1;
      }
    }
  }
  const kpStats: ClassKpStat[] = [...acc.entries()].map(([kpId, a]) => {
    const avg = a.scored > 0 ? a.scoreSum / a.scored : null;
    return {
      kpId,
      kpName: args.kpMeta.get(kpId) ?? kpId,
      avgScore: avg === null ? null : Number(avg.toFixed(4)),
      classTier: avg === null ? "INSUFFICIENT_DATA" : tierOf(avg, a.scored),
      focusStudentCount: a.focus,
      sampleStudents: a.students,
    };
  });
  kpStats.sort((x, y) =>
    TIER_ORDER[x.classTier] !== TIER_ORDER[y.classTier]
      ? TIER_ORDER[x.classTier] - TIER_ORDER[y.classTier]
      : y.focusStudentCount - x.focusStudentCount,
  );
  return {
    classroomId: args.classroomId,
    window: args.window,
    generatedAt: new Date().toISOString(),
    studentCount: args.studentCount,
    kpStats,
    topFocusKps: kpStats
      .filter((s) => s.classTier === "FOCUS")
      .slice(0, 5)
      .map((s) => s.kpName),
  };
}
