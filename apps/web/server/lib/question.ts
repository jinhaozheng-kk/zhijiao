import "server-only";
import crypto from "node:crypto";
import { Prisma, type Question } from "@prisma/client";

export const QUESTION_SOURCE_USER_ADHOC = "USER_ADHOC";

/**
 * spec §4.2: 仅 trim + 空白折叠，不 lowercase。
 * 数学文本大小写可有义（点 A vs a / 变量 X vs x / 集合矩阵符号 / sin x vs SIN x）。
 * 本 plan 仅"防膨胀"，不做语义相似题合并。
 */
export function normalizeStem(stem: string): string {
  return stem.trim().replace(/\s+/g, " ");
}

/**
 * 128-bit prefix is enough for dedup; keeps the indexed value compact.
 * This is not a privacy boundary.
 */
export function stemHashHex(stem: string): string {
  return crypto.createHash("sha256").update(normalizeStem(stem)).digest("hex").slice(0, 32);
}

export interface UpsertUserAdhocQuestionArgs {
  userId: string;
  stemMd: string;
}

/**
 * spec §4.4: upsert USER_ADHOC Question 行。
 *
 * 流程：
 *   1. normalize + hash
 *   2. findFirst by (createdByUserId, source=USER_ADHOC, normalizedStemHash)
 *      —— 命中即返（少一次写尝试 + 不污染 DB error log）
 *   3. 未命中 → tx.subject lookup math by code @unique（不缓存，test reset DB 会失效）
 *   4. tx.question.create
 *   5. P2002 catch → 重读 → 命中返回 / 未命中原样抛
 *      （不依赖 meta.target —— Prisma 在 raw SQL partial unique 上 meta.target 行为版本不稳，
 *      与 Plan 4 isErrorBookPartialUniqueP2002 不同手艺，是本 plan 主动改进）
 */
export async function upsertUserAdhocQuestion(
  tx: Prisma.TransactionClient,
  args: UpsertUserAdhocQuestionArgs,
): Promise<Question> {
  const normalizedStemHash = stemHashHex(args.stemMd);

  const existing = await tx.question.findFirst({
    where: {
      createdByUserId: args.userId,
      source: QUESTION_SOURCE_USER_ADHOC,
      normalizedStemHash,
    },
  });
  if (existing) return existing;

  const math = await tx.subject.findUniqueOrThrow({
    where: { code: "math" },
    select: { id: true },
  });

  try {
    return await tx.question.create({
      data: {
        subjectId: math.id,
        stemMd: args.stemMd,
        type: "ESSAY",
        status: "DRAFT",
        source: QUESTION_SOURCE_USER_ADHOC,
        createdByUserId: args.userId,
        normalizedStemHash,
      },
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const winner = await tx.question.findFirst({
        where: {
          createdByUserId: args.userId,
          source: QUESTION_SOURCE_USER_ADHOC,
          normalizedStemHash,
        },
      });
      if (winner) return winner;
    }
    throw e;
  }
}
