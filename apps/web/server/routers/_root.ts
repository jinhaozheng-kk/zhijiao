import "server-only";
import { router } from "../trpc.js";
import { authRouter } from "./auth.js";
import { tutorRouter } from "./tutor.js";
import { walletRouter } from "./wallet.js";

export const appRouter = router({
  auth: authRouter,
  tutor: tutorRouter,
  wallet: walletRouter,
});
export type AppRouter = typeof appRouter;
