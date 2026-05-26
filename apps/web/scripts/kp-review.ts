#!/usr/bin/env tsx
// Plan 9 spec §5.2: PENDING_REVIEW 交互式 review CLI。
//   pnpm.cmd --filter @zhijiao/web kp:review
//
// 单键操作：
//   a              approve     → LINKED + 写 QuestionKPLink(weight=row.confidence)
//   r              reject      → REJECTED + 不写 link
//   m <kpCode>     remap       → LINKED with newKpCode (matchVia=MANUAL)
//   alias <kpCode> learn alias → 写 KpAlias(source=CLI_MANUAL) + LINKED
//   s              skip        → 不改 status，进下一条
//   q              quit        → 退出
//
// 单人 dev 不上 /ops/kp-reconcile Web 页面 (memory: zhijiao-single-dev-no-ops-ui)。
// 本 CLI 是 thin wrapper —— 所有动作走 server/lib/kp-reconcile.ts 的 service 函数；
// 未来真有 OPS 角色 + Web 页面，直接复用同 service。

import { PrismaClient } from "@prisma/client";
import readline from "node:readline";
import {
  approveMatch,
  rejectMatch,
  remapMatch,
  learnAliasAndLink,
  KpAliasConflictError,
} from "../server/lib/kp-reconcile.js";
import { resolveOperatorUserId } from "../server/lib/operator.js";

async function loadPending(prisma: PrismaClient) {
  return prisma.kpReconcileMatch.findMany({
    where: { status: "PENDING_REVIEW" },
    orderBy: { createdAt: "asc" },
    include: {
      kp: { select: { code: true, name: true } },
      question: { select: { id: true, stemMd: true, subjectId: true } },
    },
  });
}

type PendingRow = Awaited<ReturnType<typeof loadPending>>[number];

function render(m: PendingRow, idx: number, total: number) {
  const reasonStr = m.reviewReason ?? "—";
  const kpStr = m.kp ? `${m.kp.code} "${m.kp.name}"` : "(none)";
  const confStr = m.confidence?.toFixed(2) ?? "—";
  const stem = m.question.stemMd.length > 80 ? m.question.stemMd.slice(0, 80) + "…" : m.question.stemMd;
  // eslint-disable-next-line no-console
  console.log(`\n[${idx + 1}/${total}]  reviewReason=${reasonStr}`);
  // eslint-disable-next-line no-console
  console.log(`  Hint:        "${m.rawHint}"`);
  // eslint-disable-next-line no-console
  console.log(`  Source:      ${m.source}  refId=${m.sourceRefId}`);
  // eslint-disable-next-line no-console
  console.log(`  Suggested:   ${kpStr}  via ${m.matchVia ?? "—"}  confidence=${confStr}`);
  // eslint-disable-next-line no-console
  console.log(`  Parent question: ${m.question.id} "${stem}"`);
}

function prompt(rl: readline.Interface, q: string): Promise<string> {
  return new Promise((resolve) => rl.question(q, resolve));
}

type ActionResult = "DONE" | "RETRY" | "SKIP" | "QUIT";

// 处理单条 match；返回是否需要重新提示同一条（alias conflict 时给用户机会选别的动作）。
async function processOne(
  prisma: PrismaClient,
  rl: readline.Interface,
  m: PendingRow,
  reviewerUserId: string,
): Promise<ActionResult> {
  const raw = (await prompt(rl, `\nAction [a/r/m <code>/alias <code>/s/q]> `)).trim();

  if (raw === "q") return "QUIT";
  if (raw === "s" || raw === "") return "SKIP";

  if (raw === "a") {
    await approveMatch(prisma, { matchId: m.id, reviewedByUserId: reviewerUserId });
    // eslint-disable-next-line no-console
    console.log(`✓ LINKED. Wrote QuestionKPLink(${m.questionId}, ${m.kpId}).`);
    return "DONE";
  }

  if (raw === "r") {
    await rejectMatch(prisma, { matchId: m.id, reviewedByUserId: reviewerUserId });
    // eslint-disable-next-line no-console
    console.log(`✓ REJECTED.`);
    return "DONE";
  }

  if (raw.startsWith("m ")) {
    const kpCode = raw.slice(2).trim();
    if (!kpCode) {
      // eslint-disable-next-line no-console
      console.log(`Usage: m <kpCode>`);
      return "RETRY";
    }
    try {
      await remapMatch(prisma, {
        matchId: m.id,
        newKpCode: kpCode,
        reviewedByUserId: reviewerUserId,
      });
      // eslint-disable-next-line no-console
      console.log(`✓ REMAPPED to ${kpCode}.`);
      return "DONE";
    } catch (e) {
      // eslint-disable-next-line no-console
      console.log(`✗ Remap failed: ${e instanceof Error ? e.message : String(e)}`);
      return "RETRY";
    }
  }

  if (raw.startsWith("alias ")) {
    const kpCode = raw.slice(6).trim();
    if (!kpCode) {
      // eslint-disable-next-line no-console
      console.log(`Usage: alias <kpCode>`);
      return "RETRY";
    }
    try {
      await learnAliasAndLink(prisma, {
        matchId: m.id,
        targetKpCode: kpCode,
        reviewedByUserId: reviewerUserId,
      });
      // eslint-disable-next-line no-console
      console.log(
        `✓ LINKED via MANUAL. Wrote KpAlias("${m.normalizedHint}" → ${kpCode}, source=CLI_MANUAL).`,
      );
      return "DONE";
    } catch (e) {
      if (e instanceof KpAliasConflictError) {
        // eslint-disable-next-line no-console
        console.log(
          `✗ Alias conflict: "${m.normalizedHint}" already maps to kp ${e.existing.kpId} ` +
            `(source=${e.existing.source}).`,
        );
        // eslint-disable-next-line no-console
        console.log(
          `  Plan 9 不提供 alias 覆盖入口；如必须改：1) prisma studio 手动删旧 KpAlias 行；2) 写 ad-hoc 脚本。`,
        );
        // eslint-disable-next-line no-console
        console.log(
          `  当前可选：r 拒绝 / m <code> 改 kpId 不学 alias / s 跳过。重新选：`,
        );
        return "RETRY";
      }
      // eslint-disable-next-line no-console
      console.log(`✗ Learn alias failed: ${e instanceof Error ? e.message : String(e)}`);
      return "RETRY";
    }
  }

  // eslint-disable-next-line no-console
  console.log(`Unknown action "${raw}". Try: a / r / m <code> / alias <code> / s / q`);
  return "RETRY";
}

async function main() {
  const prisma = new PrismaClient();
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  try {
    const reviewerUserId = await resolveOperatorUserId(prisma);
    // eslint-disable-next-line no-console
    console.log(`[kp:review] reviewer=${reviewerUserId}`);

    const pending = await loadPending(prisma);
    if (pending.length === 0) {
      // eslint-disable-next-line no-console
      console.log("No PENDING_REVIEW matches. ✓");
      return;
    }
    // eslint-disable-next-line no-console
    console.log(`Loading PENDING_REVIEW... ${pending.length} entries.`);

    let processed = 0;
    let quit = false;
    for (const [i, m] of pending.entries()) {
      if (quit) break;
      render(m, i, pending.length);
      // 同一条可能反复 RETRY (输入错指令 / alias conflict)；直到 DONE / SKIP / QUIT
      for (;;) {
        const result = await processOne(prisma, rl, m, reviewerUserId);
        if (result === "DONE") { processed++; break; }
        if (result === "SKIP") break;
        if (result === "QUIT") { quit = true; break; }
        // RETRY: stay on same item
      }
    }

    // eslint-disable-next-line no-console
    console.log(`\nReviewed ${processed} / queued ${pending.length}. Run again to continue.`);
  } finally {
    rl.close();
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});
