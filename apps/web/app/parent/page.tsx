import { AppShell } from "@/components/shell/AppShell";
import { PageHeader } from "@/components/ui/page-header";
import { isDemoModeEnabled } from "@/server/demo/config";
import { ParentView } from "./parent-view";

export const dynamic = "force-dynamic";

export default function ParentHome() {
  return (
    <AppShell role="PARENT" demoMode={isDemoModeEnabled()}>
      <PageHeader
        eyebrow="家长视角"
        title="家长视角"
        description="只呈现必要的巩固方向，不做横向比较或焦虑化提醒。"
      />
      <div className="mt-6">
        <ParentView />
      </div>
    </AppShell>
  );
}
