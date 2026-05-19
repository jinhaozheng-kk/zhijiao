"use client";
import type { GradeLevel } from "@zhijiao/domain";

const GRADES: GradeLevel[] = ["G5","G6","G7","G8","G9","G10","G11","G12"];

export function GradePicker({ value, onChange }: { value: GradeLevel | null; onChange: (g: GradeLevel) => void }) {
  return (
    <select
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value as GradeLevel)}
      className="border rounded px-2 py-2"
      data-testid="grade-picker"
    >
      <option value="" disabled>请选择学段</option>
      {GRADES.map((g) => <option key={g} value={g}>{g}</option>)}
    </select>
  );
}
