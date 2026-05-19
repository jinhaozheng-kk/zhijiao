import "server-only";
import { router } from "../trpc.js";
import { authRouter } from "./auth.js";
import { tutorRouter } from "./tutor.js";

export const appRouter = router({
  auth: authRouter,
  tutor: tutorRouter,
});
export type AppRouter = typeof appRouter;
