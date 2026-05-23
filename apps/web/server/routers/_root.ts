import "server-only";
import { router } from "../trpc.js";
import { authRouter } from "./auth.js";
import { tutorRouter } from "./tutor.js";
import { walletRouter } from "./wallet.js";
import { errorRouter } from "./error.js";

export const appRouter = router({
  auth: authRouter,
  tutor: tutorRouter,
  wallet: walletRouter,
  error: errorRouter,
});
export type AppRouter = typeof appRouter;
