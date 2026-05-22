import "server-only";
// Plan 3 Task 9 transition: creditPlaceholder is removed; chargedProcedure is
// wired into tutor.ask in Task 12 (which also extends the input schema with
// clientRequestId). Using authedProcedure here keeps the procedure typed
// without charging credit so Task 9 stays a small, reviewable diff.
import { authedProcedure, router } from "../trpc.js";
import { TutoringInputSchema, ComplianceRejectedError } from "@zhijiao/ai";
import { TRPCError } from "@trpc/server";
import { getAiRouter } from "@/lib/ai-client";

export const tutorRouter = router({
  ask: authedProcedure
    .input(TutoringInputSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        const r = getAiRouter(ctx.auth.userId);
        return await r.tutor(input);
      } catch (e) {
        if (e instanceof ComplianceRejectedError) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "讲解内容未通过合规检查，请换一道题或稍后再试。",
            cause: { reason: "COMPLIANCE_REJECTED" },
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
