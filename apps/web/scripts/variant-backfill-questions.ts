#!/usr/bin/env tsx
import { pathToFileURL } from "node:url";
import { PrismaClient, type Prisma } from "@prisma/client";
import { loadCliEnv } from "./load-cli-env.js";
import { createVariantQuestion } from "../server/lib/question-shared.js";

const BATCH = 200;

export interface BackfillVariantQuestionsArgs {
  limit: number;
  dryRun: boolean;
  afterCreateBeforeUpdate?: (args: {
    prisma: PrismaClient | Prisma.TransactionClient;
    itemId: string;
    questionId: string;
  }) => Promise<void>;
}

export interface BackfillVariantQuestionsResult {
  processed: number;
  created: number;
  alreadySeen: number;
  dryRun: boolean;
}

export function parseArgs(argv: string[]): BackfillVariantQuestionsArgs {
  let dryRun = false;
  let limit = 1000;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (arg === "--limit") {
      const raw = argv[i + 1];
      if (!raw) throw new Error("--limit requires a positive integer");
      const parsed = Number(raw);
      if (!Number.isInteger(parsed) || parsed <= 0) {
        throw new Error("--limit requires a positive integer");
      }
      limit = parsed;
      i += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return { limit, dryRun };
}

export async function backfillVariantQuestions(
  prisma: PrismaClient,
  args: BackfillVariantQuestionsArgs,
): Promise<BackfillVariantQuestionsResult> {
  let processed = 0;
  let created = 0;
  let alreadySeen = 0;

  while (processed < args.limit) {
    const remaining = args.limit - processed;
    const take = Math.min(BATCH, remaining);
    const items = await prisma.variantItem.findMany({
      where: { questionId: null },
      ...(args.dryRun ? { skip: processed } : {}),
      take,
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      include: {
        group: {
          include: {
            entry: {
              include: {
                question: {
                  select: { subjectId: true },
                },
              },
            },
          },
        },
      },
    });

    if (items.length === 0) break;

    for (const item of items) {
      processed += 1;

      if (args.dryRun) {
        created += 1;
        continue;
      }

      const outcome = await prisma.$transaction(async (tx) => {
        const q = await createVariantQuestion(tx, {
          stemMd: item.stemMd,
          userId: item.group.userId,
          subjectId: item.group.entry.question.subjectId,
        });

        await args.afterCreateBeforeUpdate?.({
          prisma: tx,
          itemId: item.id,
          questionId: q.id,
        });

        const update = await tx.variantItem.updateMany({
          where: { id: item.id, questionId: null },
          data: { questionId: q.id },
        });

        if (update.count === 0) {
          await tx.question.delete({ where: { id: q.id } });
          return "alreadySeen" as const;
        }

        return "created" as const;
      });

      if (outcome === "alreadySeen") {
        alreadySeen += 1;
      } else {
        created += 1;
      }
    }
  }

  return { processed, created, alreadySeen, dryRun: args.dryRun };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  loadCliEnv();
  const prisma = new PrismaClient();

  try {
    const result = await backfillVariantQuestions(prisma, args);
    console.log(JSON.stringify(result));
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
