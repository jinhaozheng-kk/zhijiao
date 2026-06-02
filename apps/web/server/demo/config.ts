import "server-only";
import { env } from "../env.js";

export type DemoRole = "student" | "teacher" | "parent";

export const DEMO_IDS = {
  classroomId: "demo-classroom-g8-math-01",
  teacherUserId: "demo-teacher-math-01",
  studentUserId: "demo-student-focus-01",
  stableStudentUserId: "demo-student-stable-01",
  consolidatingStudentUserId: "demo-student-consolidating-01",
  parentUserId: "demo-parent-01",
} as const;

export const DEMO_TARGETS: Record<DemoRole, string> = {
  student: "/tutor?demo=1",
  teacher: `/teacher/classes/${DEMO_IDS.classroomId}`,
  parent: "/parent",
};

export function isDemoRuntimeAllowed(): boolean {
  return process.env.NODE_ENV !== "production" || env.E2E_TEST_HOOKS === "1";
}

export function isDemoModeEnabled(): boolean {
  return env.DEMO_MODE === "1" && isDemoRuntimeAllowed();
}

export function userIdForDemoRole(role: DemoRole): string {
  if (role === "student") return DEMO_IDS.studentUserId;
  if (role === "teacher") return DEMO_IDS.teacherUserId;
  return DEMO_IDS.parentUserId;
}
