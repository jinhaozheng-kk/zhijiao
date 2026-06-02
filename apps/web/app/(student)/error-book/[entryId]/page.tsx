import Link from "next/link";
import { AppShell } from "@/components/shell/AppShell";
import { PageHeader } from "@/components/ui/page-header";
import { isDemoModeEnabled } from "@/server/demo/config";
import { EntryDetail } from "./entry-detail";

export const dynamic = "force-dynamic";

export default function EntryDetailPage({
  params,
}: {
  params: { entryId: string };
}) {
  return (
    <AppShell role="STUDENT" demoMode={isDemoModeEnabled()}>
      <div className="text-sm">
        <Link href="/error-book" className="text-slate-500 hover:underline">
          ← 返回错题本
        </Link>
      </div>
      <div className="mt-5">
        <PageHeader eyebrow="学生学习" title="错题详情" />
      </div>
      <EntryDetail entryId={params.entryId} />
    </AppShell>
  );
}
