import "server-only";
import { creditPlaceholder, router } from "../trpc.js";
import { TutoringInputSchema, ComplianceRejectedError } from "@zhijiao/ai";
import { TRPCError } from "@trpc/server";
import { getAiRouter } from "@/lib/ai-client";

export const tutorRouter = router({
  ask: creditPlaceholder("TUTOR_ASK")
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
