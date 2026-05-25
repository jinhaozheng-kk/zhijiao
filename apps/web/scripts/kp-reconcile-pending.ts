#!/usr/bin/env tsx
// Plan 9 spec §4.1: 异步 LLM batch CLI。
//   pnpm.cmd --filter @zhijiao/web kp:reconcile-pending [-- --limit N]
//
// 取 UNMATCHED 行 limit 条 (默认 50)，按 subjectId 分桶，对每个 subject 一轮
// LLM 调 (aiRouter.kpReconcile)，状态机分流 (spec §3.3 + §4.3) 写回。
//
// 不进 cron (spec §1 / §10.2) — 手动触发，便于观察 LLM 成本和 prompt 质量。

import { PrismaClient } from "@prisma/client";
import { AiRouter, DashScopeAdapter, MockAdapter, type ModelAdapter } from "@zhijiao/ai";
import {
  processBatch,
  type KpReconcileThresholds,
} from "../server/lib/kp-reconcile-pending.js";

// CLI-safe adapter factory. Do NOT import @/lib/ai-client — it's server-only
// (Next bundler-gated; tsx can't resolve). Mirror the env contract validated
// by server/env.ts: AI_USE_MOCK="true" → MockAdapter; otherwise require real
// DashScope credentials (fail-close). The runtime is allowed to override via
// AI_USE_MOCK because operators may want to dry-run prompt iterations against
// the mock without touching DashScope.
function buildCliAdapter(): ModelAdapter {
  if (process.env.AI_USE_MOCK === "true") return new MockAdapter();
  if (!process.env.DASHSCOPE_API_KEY || !process.env.DASHSCOPE_BASE_URL) {
    throw new Error(
      "Real AI requires DASHSCOPE_API_KEY + DASHSCOPE_BASE_URL. Set AI_USE_MOCK=true to use the mock adapter.",
    );
  }
  return new DashScopeAdapter({
    apiKey: process.env.DASHSCOPE_API_KEY,
    baseURL: process.env.DASHSCOPE_BASE_URL,
  });
}

// Read thresholds from env with same defaults as server/env.ts superRefine
// (defaults 0.85 / 0.6; review < auto_link enforced).
function loadThresholds(): KpReconcileThresholds {
  const autoLinkRaw = process.env.KP_RECONCILE_AUTO_LINK_THRESHOLD ?? "0.85";
  const reviewRaw = process.env.KP_RECONCILE_REVIEW_THRESHOLD ?? "0.6";
  const autoLink = Number(autoLinkRaw);
  const review = Number(reviewRaw);
  if (!Number.isFinite(autoLink) || autoLink < 0 || autoLink > 1) {
    throw new Error(`Invalid KP_RECONCILE_AUTO_LINK_THRESHOLD: ${autoLinkRaw}`);
  }
  if (!Number.isFinite(review) || review < 0 || review > 1) {
    throw new Error(`Invalid KP_RECONCILE_REVIEW_THRESHOLD: ${reviewRaw}`);
  }
  if (review >= autoLink) {
    throw new Error(
      `KP_RECONCILE_REVIEW_THRESHOLD (${review}) must be strictly less than KP_RECONCILE_AUTO_LINK_THRESHOLD (${autoLink})`,
    );
  }
  return { autoLink, review };
}

function parseLimit(args: string[]): number {
  const limitFlag = args.indexOf("--limit");
  if (limitFlag < 0) return 50;
  const raw = args[limitFlag + 1];
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`Invalid --limit: ${raw ?? "(missing)"}`);
  }
  return n;
}

async function main() {
  const args = process.argv.slice(2);
  const limit = parseLimit(args);
  const thresholds = loadThresholds();

  const prisma = new PrismaClient();
  const adapter = buildCliAdapter();
  const router = new AiRouter({ prisma, adapter });

  try {
    // eslint-disable-next-line no-console
    console.log(
      `[kp:reconcile-pending] limit=${limit} autoLink=${thresholds.autoLink} review=${thresholds.review}`,
    );
    const result = await processBatch(prisma, router, { limit, thresholds });
    // eslint-disable-next-line no-console
    console.log(
      `Done. Total UNMATCHED processed: ${result.totalProcessed}, Batches: ${result.batches.length}.`,
    );
    for (const [i, b] of result.batches.entries()) {
      // eslint-disable-next-line no-console
      console.log(
        `  Batch ${i + 1}/${result.batches.length} (subject=${b.subjectId}, hints=${b.hintsCount}): ` +
          `${b.linked} LINKED, ${b.pendingReview} PENDING_REVIEW, ${b.dropped} DROPPED, ${b.failed} FAILED`,
      );
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});
