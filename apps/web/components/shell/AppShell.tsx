import type { ReactNode } from "react";
import { isDemoModeEnabled } from "@/server/demo/config";
import { getShellIdentity, roleBadgeLabel } from "@/server/shell-identity";
import { DemoModeBanner } from "./DemoModeBanner";
import { RoleNav } from "./RoleNav";

export async function AppShell({
  title,
  children,
}: {
  title?: string;
  children: ReactNode;
}) {
  const identity = await getShellIdentity();
  const demoMode = isDemoModeEnabled();

  return (
    <div className="min-h-screen bg-slate-50 text-slate-950">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-6 py-4">
          <a href="/" className="text-lg font-semibold tracking-tight">
            智教
          </a>
          {identity ? (
            <div className="flex flex-wrap items-center gap-4">
              <RoleNav role={identity.persona} classroomId={identity.primaryClassroomId} />
              <span
                className="flex items-center gap-2 text-sm text-slate-600"
                data-testid="shell-identity"
              >
                <span className="font-medium text-slate-950">{identity.displayName}</span>
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs">
                  {roleBadgeLabel(identity.persona)}
                </span>
              </span>
            </div>
          ) : null}
        </div>
      </header>
      {demoMode ? <DemoModeBanner /> : null}
      <main className="mx-auto max-w-7xl px-6 py-8">
        {title ? (
          <h1 className="mb-6 text-3xl font-semibold tracking-tight">{title}</h1>
        ) : null}
        {children}
      </main>
    </div>
  );
}
