"use client";
import { useState } from "react";
import { trpc } from "@/lib/trpc-client";
import { StatePanel } from "@/components/ui/state-panel";
import { SkeletonList } from "@/components/ui/skeleton";
import { TIER_COLOR, tierLabel } from "@/lib/mastery-copy";
import { AdviceCard } from "./advice-card";

export function PortraitView() {
  const [window, setWindow] = useState<"D30" | "D90" | "ALL">("D90");
  const q = trpc.analytics.profile.mine.useQuery({ window });

  if (q.isLoading) return <SkeletonList rows={3} />;
  const profile = q.data?.profile;
  if (!profile || !profile.hasData) {
    return (
      <div data-testid="portrait-empty">
        <StatePanel
          title="还没有足够的学情数据"
          description="完成一些练习或作业后，这里会显示你的知识点掌握情况。"
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex gap-2" data-testid="portrait-window">
        {(["D30", "D90", "ALL"] as const).map((w) => (
          <button
            key={w}
            onClick={() => setWindow(w)}
            className={`rounded border px-3 py-1 text-sm ${w === window ? "bg-slate-900 text-white" : ""}`}
          >
            {w === "D30" ? "近30天" : w === "D90" ? "近90天" : "全部"}
          </button>
        ))}
      </div>

      <section>
        <h2 className="mb-3 font-medium">知识点掌握情况</h2>
        <div className="grid gap-2 sm:grid-cols-2" data-testid="portrait-masteries">
          {profile.masteries.map((m) => (
            <div key={m.kpId} className={`rounded-lg border px-3 py-2 ${TIER_COLOR[m.tier]}`}>
              <div className="flex items-center justify-between">
                <span className="font-medium">{m.kpName}</span>
                <span className="text-xs">{tierLabel(m.tier)}</span>
              </div>
              {m.recentErrorCount > 0 && (
                <p className="mt-1 text-xs opacity-80">近期错题 {m.recentErrorCount} 道</p>
              )}
            </div>
          ))}
        </div>
      </section>

      <AdviceCard window={window} />
    </div>
  );
}
