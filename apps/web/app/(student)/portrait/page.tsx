import { AppShell } from "@/components/shell/AppShell";
import { PageHeader } from "@/components/ui/page-header";
import { PortraitView } from "./portrait-view";

export const dynamic = "force-dynamic";

export default function PortraitPage() {
  return (
    <AppShell>
      <PageHeader
        eyebrow="学生学习"
        title="我的学情"
        description="看看自己各知识点的掌握情况，找到下一步重点。"
      />
      <div className="mt-6">
        <PortraitView />
      </div>
    </AppShell>
  );
}
