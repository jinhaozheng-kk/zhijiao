import "server-only";
import { TRPCError } from "@trpc/server";
import type { TRPC_ERROR_CODE_KEY } from "@trpc/server/unstable-core-do-not-import";

// Plan 3 Task 10: shared toTRPCError helper for routers beyond auth.
// auth.ts has its own narrow-typed copy (introduced in Plan 2); we keep
// that one alone to avoid churn in stable auth code. This version uses
// tRPC's exported error code union so any router can throw any code
// without expanding a hand-rolled list.
//
// Signature is `: never` and the body throws — call sites MUST write
// `throw toTRPCError(...)` (NOT `return toTRPCError(...)` or bare
// `toTRPCError(...)`) so a future refactor that loses the `: never`
// return-type narrowing keeps the throw path unambiguous.
export function toTRPCError(
  reason: string,
  code: TRPC_ERROR_CODE_KEY,
  extras?: Record<string, unknown>,
): never {
  throw new TRPCError({
    code,
    message: reason,
    cause: { reason, ...(extras ?? {}) },
  });
}
