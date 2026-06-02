import "server-only";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { consentGatedProcedure, router } from "../trpc.js";
import { advanceReviewLadder } from "../lib/error-book.js";
import { buildTrainingSession, ownsTrainingQuestion } from "../lib/training.js";

const windowSchema = z.enum(["D30", "D90", "ALL"]).default("ALL");

export const trainingRouter = router({
  // Free, reuse-first weak-point practice session. Reads only the caller's own
  // error book + variants; never charges, never calls AI.
  startSession: consentGatedProcedure
    .input(z.object({ window: windowSchema }).default({ window: "ALL" }))
    .query(async ({ ctx, input }) => {
      const built = await buildTrainingSession(
        ctx.db,
        ctx.auth.userId,
        input.window,
      );
      return { sessionId: randomUUID(), ...built };
    }),

  submitAttempt: consentGatedProcedure
    .input(
      z.object({
        sessionId: z.string().min(1),
        questionId: z.string().min(1),
        source: z.enum(["ERROR_BOOK", "VARIANT"]),
        kpIds: z.array(z.string().min(1)).max(8),
        selfResult: z.enum(["KNOW", "UNSURE"]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.auth.userId;
      if (!(await ownsTrainingQuestion(ctx.db, userId, input.questionId))) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "题目不存在",
          cause: { reason: "TRAINING_QUESTION_NOT_FOUND" },
        });
      }
      const gradeStatus = input.selfResult === "KNOW" ? "CORRECT" : "WRONG";
      await ctx.db.trainingAttempt.create({
        data: {
          sessionId: input.sessionId,
          studentUserId: userId,
          questionId: input.questionId,
          source: input.source,
          gradeStatus,
          kpIds: input.kpIds,
        },
      });
      // On KNOW for an ACTIVE error entry, advance its spaced-review ladder.
      if (gradeStatus === "CORRECT" && input.source === "ERROR_BOOK") {
        const entry = await ctx.db.errorBookEntry.findFirst({
          where: { userId, questionId: input.questionId, status: "ACTIVE" },
          select: { id: true, reviewCount: true },
        });
        if (entry) {
          await advanceReviewLadder(ctx.db, entry.id, entry.reviewCount, new Date());
        }
      }
      return { ok: true };
    }),
});
