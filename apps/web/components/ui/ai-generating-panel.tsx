"use client";

import { useState, useEffect } from "react";

const PHASE_COPY: Array<{ minSeconds: number; text: string }> = [
  { minSeconds: 90, text: "出卷耗时较长，感谢耐心等待，请勿刷新页面" },
  { minSeconds: 45, text: "AI 生成中，即将完成…" },
  { minSeconds: 15, text: "AI 正在生成新题目…" },
  { minSeconds: 0, text: "正在从题库匹配已有题目…" },
];

function getPhaseCopy(seconds: number): string {
  // PHASE_COPY 末项 minSeconds 为 0，必命中；找不到时兜底文案。
  const phase = PHASE_COPY.find((p) => seconds >= p.minSeconds);
  return phase?.text ?? "AI 出卷中…";
}

export function AiGeneratingPanel({ label }: { label?: string }) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    setElapsed(0);
    const id = setInterval(() => {
      setElapsed((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(id);
  }, []);

  const displayText = label ?? getPhaseCopy(elapsed);

  return (
    <div
      className="rounded-lg bg-slate-50 p-4 text-sm text-slate-600"
      data-testid="ai-generating-panel"
      role="status"
      aria-live="polite"
    >
      <div className="flex items-center gap-3">
        <span className="h-2 w-2 animate-pulse rounded-full bg-slate-400" />
        <span>{displayText}</span>
      </div>
      {!label && (
        <p className="mt-1.5 text-xs text-slate-400" data-testid="ai-generating-elapsed">
          已等待 {elapsed}s · 真 AI 出卷通常需 1–3 分钟
        </p>
      )}
    </div>
  );
}
