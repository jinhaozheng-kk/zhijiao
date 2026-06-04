import "server-only";
import { router } from "../trpc.js";
import { authRouter } from "./auth.js";
import { tutorRouter } from "./tutor.js";
import { walletRouter } from "./wallet.js";
import { errorRouter } from "./error.js";
import { variantRouter } from "./variant.js";
import { assignmentRouter } from "./assignment.js";
import { analyticsRouter } from "./analytics.js";
import { familyRouter } from "./family.js";
import { dsarRouter } from "./dsar.js";
import { trainingRouter } from "./training.js";
import { paperRouter } from "./paper.js";

export const appRouter = router({
  auth: authRouter,
  tutor: tutorRouter,
  wallet: walletRouter,
  error: errorRouter,
  variant: variantRouter,
  assignment: assignmentRouter,
  analytics: analyticsRouter,
  family: familyRouter,
  dsar: dsarRouter,
  training: trainingRouter,
  paper: paperRouter,
});
export type AppRouter = typeof appRouter;
