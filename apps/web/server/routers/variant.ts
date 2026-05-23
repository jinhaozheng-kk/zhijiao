import "server-only";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import {
  authedProcedure,
  chargeMiddleware,
  validateEntryOwnership,
  router,
} from "../trpc.js";
import { ComplianceRejectedError } from "@zhijiao/ai";
import { getAiRouter } from "@/lib/ai-client";
import { toVariantGroupView } from "../lib/error-book.js";

export const variantRouter = router({
  // spec §4.2 / §5.2 — Blocker 1.
  //
  // Middleware chain order is the load-bearing assertion of this whole task:
  //   authedProcedure → validateEntryOwnership → chargeMiddleware("VARIANT_GROUP_GEN")
  //
  // validateEntryOwnership MUST run before chargeMiddleware. The three
  // ENTRY_NOT_FOUND failures (entry absent / cross-user / DELETED) abort
  // the request before a DEBIT ledger row gets written. Reversing this
  // chain re-introduces Blocker 1.
  generateForEntry: authedProcedure
    .use(validateEntryOwnership)
    .use(chargeMiddleware("VARIANT_GROUP_GEN"))
    .input(
      z.object({
        entryId: z.string().cuid(),
        clientRequestId: z.string().uuid(),
      }),
    )
    .mutation(async ({ ctx }) => {
      // ctx.entry: injected by validateEntryOwnership; includes question +
      // answer + knowledgePoints.kp so we can build the anchorKps payload
      // without an extra DB round trip.
      // ctx.debit: injected by chargeMiddleware; the DEBIT ledger row id
      // we'll persist alongside VariantGroup so the financial audit and the
      // domain record stay linked.

      // gradeLevel lives on User, not JWT. Single read; acceptable for a
      // 3-credit action (see error.diagnose for the same pattern).
      const user = await ctx.db.user.findUnique({
        where: { id: ctx.auth.userId },
        select: { gradeLevel: true },
      });

      const aiRouter = getAiRouter(ctx.auth.userId);
      let ai;
      try {
        ai = await aiRouter.generateVariants({
          anchorStemMd: ctx.entry.question.stemMd,
          anchorRootCause: ctx.entry.rootCause,
          anchorKps: ctx.entry.question.knowledgePoints.map((l) => ({
            id: l.kpId,
            name: l.kp.name,
            difficulty: l.kp.difficulty,
          })),
          studentGrade: user?.gradeLevel ?? null,
        });
      } catch (e) {
        if (e instanceof ComplianceRejectedError) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "变式生成未通过合规检查",
            // cause.original preserves the upstream class so chargeMiddleware
            // can find ComplianceRejectedError through the TRPCError wrap and
            // route to the no-compensation branch (debit kept; balance not
            // restored; user already received a deterministic rejection).
            cause: { reason: "COMPLIANCE_REJECTED", original: e },
          });
        }
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "变式生成失败",
          cause: { reason: "VARIANT_GEN_INTERNAL", original: e },
        });
      }

      // Atomic persistence: VariantGroup + 3 VariantItem rows together.
      // VariantGroup.debitLedgerId has @unique so a second mutation that
      // somehow reuses the same DEBIT row (shouldn't happen — idemKey
      // uniqueness in chargeMiddleware prevents it) would P2002 here as a
      // belt-and-suspenders guard.
      const result = await ctx.db.$transaction(async (tx) => {
        const group = await tx.variantGroup.create({
          data: {
            entryId: ctx.entry.id,
            userId: ctx.auth.userId,
            creditsCost: 3,
            debitLedgerId: ctx.debit.ledgerId,
            modelCallId: ai.modelCallId,
          },
        });
        await tx.variantItem.createMany({
          data: ai.items.map((it, idx) => ({
            groupId: group.id,
            level: it.level,
            position: idx + 1,
            stemMd: it.stemMd,
            solutionMd: it.solutionMd,
            knowledgePointHints: it.knowledgePointHints ?? [],
          })),
        });
        return tx.variantGroup.findUniqueOrThrow({
          where: { id: group.id },
          include: { items: { orderBy: { position: "asc" } } },
        });
      });

      return { group: toVariantGroupView(result) };
    }),
});
