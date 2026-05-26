import crypto from "node:crypto";
import { type Prisma, type Question } from "@prisma/client";

export const QUESTION_SOURCE_USER_ADHOC = "USER_ADHOC";
export const QUESTION_SOURCE_VARIANT_GENERATED = "VARIANT_GENERATED";

export function normalizeStem(stem: string): string {
  return stem.trim().replace(/\s+/g, " ");
}

export function stemHashHex(stem: string): string {
  return crypto.createHash("sha256").update(normalizeStem(stem)).digest("hex").slice(0, 32);
}

export interface CreateVariantQuestionArgs {
  stemMd: string;
  userId: string;
  subjectId: string;
}

export async function createVariantQuestion(
  tx: Prisma.TransactionClient,
  args: CreateVariantQuestionArgs,
): Promise<Question> {
  return tx.question.create({
    data: {
      subjectId: args.subjectId,
      stemMd: args.stemMd,
      type: "ESSAY",
      status: "DRAFT",
      source: QUESTION_SOURCE_VARIANT_GENERATED,
      createdByUserId: args.userId,
      normalizedStemHash: stemHashHex(args.stemMd),
    },
  });
}
