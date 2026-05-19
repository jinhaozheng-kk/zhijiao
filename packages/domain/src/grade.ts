export type GradeLevel = "G5" | "G6" | "G7" | "G8" | "G9" | "G10" | "G11" | "G12";

import type { Persona } from "./persona.js";

const MINOR_GRADES: ReadonlySet<GradeLevel> = new Set(["G5","G6","G7","G8","G9"]);

export function deriveIsMinor(persona: Persona, gradeLevel: GradeLevel | null | undefined): boolean {
  if (persona !== "STUDENT") return false;
  if (!gradeLevel) return true;          // 学生未选学段时保守视为未成年
  return MINOR_GRADES.has(gradeLevel);
}
