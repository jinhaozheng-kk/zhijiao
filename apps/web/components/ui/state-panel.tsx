import type { ReactNode } from "react";

export function StatePanel({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <section className="rounded-lg bg-white p-8 text-center shadow-sm ring-1 ring-slate-200">
      <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
      {description ? (
        <p className="mx-auto mt-3 max-w-lg text-sm leading-6 text-slate-600">{description}</p>
      ) : null}
      {action ? <div className="mt-6">{action}</div> : null}
    </section>
  );
}
