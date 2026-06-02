import type { ReactNode } from "react";

type StatusTone = "slate" | "green" | "blue" | "amber";

const toneClass: Record<StatusTone, string> = {
  slate: "bg-slate-100 text-slate-700",
  green: "bg-emerald-50 text-emerald-700",
  blue: "bg-sky-50 text-sky-700",
  amber: "bg-amber-50 text-amber-700",
};

export function StatusPill({
  children,
  tone = "slate",
}: {
  children: ReactNode;
  tone?: StatusTone;
}) {
  return (
    <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${toneClass[tone]}`}>
      {children}
    </span>
  );
}
