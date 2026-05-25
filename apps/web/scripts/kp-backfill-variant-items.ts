#!/usr/bin/env tsx
// Plan 9 spec Section 7.2: one-time backfill for existing
// VariantItem.knowledgePointHints rows.
//
// Run manually:
//   pnpm.cmd --filter @zhijiao/web exec tsx scripts/kp-backfill-variant-items.ts
//
// Idempotency is enforced by KpReconcileMatch unique
// (sourceRefType, sourceRefId, normalizedHint). Since sourceRefType is
// VARIANT_ITEM, exact/alias hits become PENDING_REVIEW and never write the
// parent QuestionKPLink automatically.

import { PrismaClient } from "@prisma/client";
import { reconcileHintsSync } from "../server/lib/kp-reconcile.js";

const BATCH_SIZE = 200;

async function main() {
  const prisma = new PrismaClient();
  let cursor: string | undefined;
  let totalItemsSeen = 0;
  let totalItemsWithHints = 0;
  let totalLinked = 0;
  let totalQueued = 0;
  let totalSeen = 0;

  try {
    for (;;) {
      const items = await prisma.variantItem.findMany({
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        take: BATCH_SIZE,
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        include: {
          group: {
            include: {
              entry: { select: { questionId: true } },
            },
          },
        },
      });

      if (items.length === 0) break;

      for (const item of items) {
        totalItemsSeen++;
        if (item.knowledgePointHints.length === 0) continue;

        const result = await reconcileHintsSync(prisma, {
          questionId: item.group.entry.questionId,
          hints: item.knowledgePointHints,
          source: "BACKFILL",
          sourceRefType: "VARIANT_ITEM",
          sourceRefId: item.id,
        });

        totalItemsWithHints++;
        totalLinked += result.linked;
        totalQueued += result.queued;
        totalSeen += result.alreadySeen;
      }

      cursor = items[items.length - 1]!.id;
      // eslint-disable-next-line no-console
      console.log(
        `Processed ${totalItemsSeen} VariantItem rows so far (cursor=${cursor})`,
      );
    }

    // eslint-disable-next-line no-console
    console.log(
      `Done. VariantItems=${totalItemsSeen}, withHints=${totalItemsWithHints}, ` +
        `new linked=${totalLinked}, queued=${totalQueued}, alreadySeen=${totalSeen}`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});
