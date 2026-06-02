"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { copyForReason } from "@/lib/error-copy";
import { trpc } from "@/lib/trpc-client";
import { AiGeneratingPanel } from "@/components/ui/ai-generating-panel";

interface EntryActionsProps {
  entryId: string;
  status: string; // ACTIVE | ARCHIVED — DELETED never reaches the UI
}

export function EntryActions({ entryId, status }: EntryActionsProps) {
  const router = useRouter();
  const utils = trpc.useUtils();
  const [err, setErr] = useState<string | null>(null);
  // Plan 4 spec §5.2: variant.generateForEntry uses chargedProcedure with a
  // UUID v4 clientRequestId. Mint a fresh one per click so retries get a new
  // request (no accidental idemKey hit) but a double-click within the same
  // pending state reuses it (handled by isPending guard below).
  const [pendingVariantReqId, setPendingVariantReqId] = useState<string | null>(
    null,
  );
  // INSUFFICIENT_BALANCE → deep-link to /wallet, mirrors TutorForm UX
  const [insufficientBalance, setInsufficientBalance] = useState(false);

  const variantMutation = trpc.variant.generateForEntry.useMutation({
    onSuccess: async () => {
      setErr(null);
      setInsufficientBalance(false);
      setPendingVariantReqId(null);
      await utils.error.getById.invalidate({ entryId });
      await utils.wallet.balance.invalidate();
      await utils.wallet.ledgerList.invalidate();
    },
    onError: (e) => {
      const reason = (e.data as { reason?: string } | undefined)?.reason;
      setInsufficientBalance(reason === "INSUFFICIENT_BALANCE");
      setErr(copyForReason(reason));
      setPendingVariantReqId(null);
    },
  });

  const markReviewedMutation = trpc.error.markReviewed.useMutation({
    onSuccess: async () => {
      setErr(null);
      await utils.error.getById.invalidate({ entryId });
      await utils.error.list.invalidate();
      await utils.error.dueForReview.invalidate();
    },
    onError: (e) => setErr(copyForReason((e.data as { reason?: string } | undefined)?.reason)),
  });

  const archiveMutation = trpc.error.archive.useMutation({
    onSuccess: async () => {
      setErr(null);
      await utils.error.getById.invalidate({ entryId });
      await utils.error.list.invalidate();
      await utils.error.dueForReview.invalidate();
    },
    onError: (e) => setErr(copyForReason((e.data as { reason?: string } | undefined)?.reason)),
  });

  const deleteMutation = trpc.error.delete.useMutation({
    onSuccess: async () => {
      setErr(null);
      await utils.error.list.invalidate();
      await utils.error.dueForReview.invalidate();
      router.push("/error-book");
    },
    onError: (e) => setErr(copyForReason((e.data as { reason?: string } | undefined)?.reason)),
  });

  const anyPending =
    variantMutation.isPending ||
    markReviewedMutation.isPending ||
    archiveMutation.isPending ||
    deleteMutation.isPending;

  function onGenerateVariant() {
    if (anyPending) return;
    const clientRequestId =
      pendingVariantReqId ?? crypto.randomUUID();
    if (!pendingVariantReqId) setPendingVariantReqId(clientRequestId);
    variantMutation.mutate({ entryId, clientRequestId });
  }

  function onArchive() {
    if (anyPending) return;
    archiveMutation.mutate({ entryId, archived: status === "ACTIVE" });
  }

  function onDelete() {
    if (anyPending) return;
    // Plan 4 spec §6.4 文案规范: "从错题本移除" 不 "删除"，不出现 "回收站"
    if (!window.confirm("从错题本移除这道题？")) return;
    deleteMutation.mutate({ entryId });
  }

  return (
    <section className="space-y-2" data-testid="entry-actions">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onGenerateVariant}
          disabled={anyPending}
          className="rounded bg-slate-900 px-3 py-2 text-sm text-white disabled:opacity-50"
          data-testid="btn-generate-variant"
        >
          {variantMutation.isPending
            ? "生成中…"
            : "生成变式（举一反三 · 3 credits）"}
        </button>
        {status === "ACTIVE" && (
          <button
            type="button"
            onClick={() => markReviewedMutation.mutate({ entryId })}
            disabled={anyPending}
            className="rounded border px-3 py-2 text-sm disabled:opacity-50"
            data-testid="btn-mark-reviewed"
          >
            {markReviewedMutation.isPending ? "记录中…" : "标记已复习"}
          </button>
        )}
        <button
          type="button"
          onClick={onArchive}
          disabled={anyPending}
          className="rounded border px-3 py-2 text-sm disabled:opacity-50"
          data-testid="btn-archive"
        >
          {archiveMutation.isPending
            ? "处理中…"
            : status === "ACTIVE"
              ? "归档"
              : "取消归档"}
        </button>
        <button
          type="button"
          onClick={onDelete}
          disabled={anyPending}
          className="rounded border border-red-300 px-3 py-2 text-sm text-red-600 disabled:opacity-50"
          data-testid="btn-delete"
        >
          {deleteMutation.isPending ? "处理中…" : "从错题本移除"}
        </button>
      </div>

      {variantMutation.isPending && (
        <AiGeneratingPanel label="举一反三生成中…" />
      )}

      {err && (
        <p className="text-sm text-red-600" data-testid="entry-actions-error">
          {err}
          {insufficientBalance ? (
            <>
              {" "}
              <Link
                href="/wallet"
                className="underline text-emerald-700"
                data-testid="entry-actions-recharge-link"
              >
                去充值
              </Link>
            </>
          ) : (
            <>
              {" "}
              <button
                type="button"
                onClick={onGenerateVariant}
                className="underline"
                data-testid="entry-actions-retry"
              >
                重试
              </button>
            </>
          )}
        </p>
      )}
    </section>
  );
}
