export function AiGeneratingPanel({ label = "AI 生成中…" }: { label?: string }) {
  return (
    <div
      className="flex items-center gap-3 rounded-lg bg-slate-50 p-4 text-sm text-slate-600"
      data-testid="ai-generating"
      role="status"
      aria-live="polite"
    >
      <span className="h-2 w-2 animate-pulse rounded-full bg-slate-400" />
      {label}
    </div>
  );
}
