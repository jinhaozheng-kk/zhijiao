import { AppShell } from "@/components/shell/AppShell";
import { PageHeader } from "@/components/ui/page-header";
import { ChildPortrait } from "./child-portrait";

export const dynamic = "force-dynamic";

export default function ChildPage({ params }: { params: { childId: string } }) {
  return (
    <AppShell>
      <PageHeader
        eyebrow="家长视角"
        title="孩子学情"
        description="聚焦近期巩固方向，不展示横向比较或压力化信息。"
      />
      <div className="mt-6">
        <ChildPortrait childId={params.childId} />
      </div>
    </AppShell>
  );
}
