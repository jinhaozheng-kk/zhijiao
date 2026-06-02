import type { Persona } from "@prisma/client";
import Link from "next/link";
import type { ReactNode } from "react";
import { DemoModeBanner } from "./DemoModeBanner";
import { RoleNav } from "./RoleNav";

export function AppShell({
  role,
  title,
  children,
  demoMode = false,
}: {
  role: Persona;
  title?: string;
  children: ReactNode;
  demoMode?: boolean;
}) {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-950">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-6 py-4">
          <Link href="/" className="text-lg font-semibold tracking-tight">
            智教
          </Link>
          <RoleNav role={role} />
        </div>
      </header>
      {demoMode ? <DemoModeBanner /> : null}
      <main className="mx-auto max-w-7xl px-6 py-8">
        {title ? <h1 className="mb-6 text-3xl font-semibold tracking-tight">{title}</h1> : null}
        {children}
      </main>
    </div>
  );
}
