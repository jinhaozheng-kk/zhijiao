import "server-only";
import { z } from "zod";
import { chargedProcedure, router } from "../trpc.js";
import { TutoringInputSchema, ComplianceRejectedError } from "@zhijiao/ai";
import { TRPCError } from "@trpc/server";
import { getAiRouter } from "@/lib/ai-client";

// Plan 3 Task 12 wires chargedProcedure('TUTOR_ASK') back in (it was
// stepped down to authedProcedure in Task 9 for diff size). The middleware
// reads clientRequestId from raw input via getRawInput(), so the schema
// just has to include it; the downstream procedure body then only uses
// the AI fields (questionStem / studentGrade) — clientRequestId is purely
// a billing-side idempotency key.
const TutorAskInputSchema = TutoringInputSchema.extend({
  clientRequestId: z.string().uuid(),
});

export const tutorRouter = router({
  ask: chargedProcedure("TUTOR_ASK")
    .input(TutorAskInputSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        const r = getAiRouter(ctx.auth.userId);
        // Strip clientRequestId before handing to the AI layer — it's
        // metadata for the billing middleware only.
        const { clientRequestId: _clientRequestId, ...aiInput } = input;
        return await r.tutor(aiInput);
      } catch (e) {
        if (e instanceof ComplianceRejectedError) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "讲解内容未通过合规检查，请换一道题或稍后再试。",
            // `original` preserves the upstream Error so chargedProcedure
            // can pull its class name for audit; `reason` is the
            // client-facing semantic that errorFormatter surfaces and that
            // shouldCompensate(...) recognizes as the no-refund whitelist.
            cause: { reason: "COMPLIANCE_REJECTED", original: e },
          });
        }
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "讲解失败，请稍后再试。",
          cause: { reason: "TUTOR_INTERNAL" },
        });
      }
    }),
});
