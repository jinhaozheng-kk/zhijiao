import "server-only";
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import { hasPermission, type Permission } from "@zhijiao/domain";
import type { Ctx } from "./context.js";

const t = initTRPC.context<Ctx>().create({
  transformer: superjson,
  errorFormatter({ shape, error }) {
    const cause = error.cause as { reason?: string } | undefined;
    return {
      ...shape,
      data: { ...shape.data, reason: cause?.reason ?? null },
    };
  },
});

export const router = t.router;
export const publicProcedure = t.procedure;

export const authedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.auth) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "请先登录",
      cause: { reason: ctx.authError ?? "NO_SESSION" },
    });
  }
  return next({ ctx: { ...ctx, auth: ctx.auth } });
});

export const permissionProcedure = (perm: Permission) =>
  authedProcedure.use(({ ctx, next }) => {
    if (!hasPermission(ctx.auth.roles, perm)) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "权限不足",
        cause: { reason: "PERMISSION_DENIED" },
      });
    }
    return next();
  });

/** Plan 3 才接 Credit；本 plan no-op 占位，保持 procedure 中间件链稳定 */
export const creditPlaceholder = (_actionKind: string) =>
  authedProcedure.use(({ next }) => next());
