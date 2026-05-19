"use client";
import type { Persona } from "@zhijiao/domain";

const OPTIONS: { value: Persona; label: string; desc: string }[] = [
  { value: "STUDENT", label: "学生", desc: "进入答疑、错题本、训练" },
  { value: "TEACHER", label: "教师", desc: "进入出卷、教案、PPT 工作台" },
  { value: "PARENT",  label: "家长", desc: "查看孩子学情报告" },
];

export function PersonaPicker({ value, onChange }: { value: Persona | null; onChange: (p: Persona) => void }) {
  return (
    <div className="grid gap-2">
      {OPTIONS.map((o) => (
        <button
          key={o.value} type="button"
          onClick={() => onChange(o.value)}
          className={`text-left border rounded p-3 ${value === o.value ? "border-slate-900 bg-slate-50" : "border-slate-200"}`}
          data-testid={`persona-${o.value}`}
        >
          <div className="font-semibold">{o.label}</div>
          <div className="text-sm text-slate-500">{o.desc}</div>
        </button>
      ))}
    </div>
  );
}
