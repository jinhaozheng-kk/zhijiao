export type AnalyticsWindow = "D30" | "D90" | "ALL";

export type MasteryTier =
  | "INSUFFICIENT_DATA"
  | "FOCUS"
  | "PROGRESSING"
  | "SOLID";

export type GradeStatusSignal = "CORRECT" | "PARTIAL" | "WRONG";

export interface KpMastery {
  kpId: string;
  kpName: string;
  tier: MasteryTier;
  score: number | null; // null when INSUFFICIENT_DATA
  weightedSampleSize: number;
  rawSampleSize: number;
  recentErrorCount: number;
}

export interface LearningProfile {
  window: AnalyticsWindow;
  generatedAt: string; // ISO
  totalGradedItems: number;
  overallScore: number | null;
  hasData: boolean;
  masteries: KpMastery[]; // sorted FOCUS→PROGRESSING→SOLID→INSUFFICIENT_DATA
  focusAreas: string[]; // kpNames where tier === FOCUS
  strengths: string[]; // kpNames where tier === SOLID
}

export interface ClassKpStat {
  kpId: string;
  kpName: string;
  classTier: MasteryTier;
  avgScore: number | null;
  focusStudentCount: number;
  sampleStudents: number;
}

export interface ClassDiagnosis {
  window: AnalyticsWindow;
  generatedAt: string;
  classroomId: string;
  studentCount: number;
  kpStats: ClassKpStat[];
  topFocusKps: string[];
}

// core.ts 的纯输入
export interface PerfSample {
  kpIds: string[];
  gradeStatus: GradeStatusSignal;
  ageDays: number; // now - createdAt, in days (>= 0)
}
export interface ErrorSample {
  kpIds: string[];
}
