import type { ReactNode } from "react";

export function PageHeader({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-5">
      <div>
        {eyebrow ? <p className="text-sm font-medium text-slate-500">{eyebrow}</p> : null}
        <h1 className="mt-2 text-4xl font-semibold tracking-tight text-slate-950">{title}</h1>
        {description ? (
          <p className="mt-3 max-w-2xl text-base leading-7 text-slate-600">{description}</p>
        ) : null}
      </div>
      {action}
    </div>
  );
}
