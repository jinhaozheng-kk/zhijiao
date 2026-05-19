"use client";

import { createTRPCReact, httpBatchLink } from "@trpc/react-query";
import { TRPCClientError, type TRPCLink } from "@trpc/client";
import { observable } from "@trpc/server/observable";
import superjson from "superjson";
import type { AppRouter } from "@/server/routers/_root";

export const trpc = createTRPCReact<AppRouter>();

/** 客户端拦截器：仅 ACCESS_EXPIRED 重试一次；其它 401 → 主动调 /api/auth/logout 清 cookie + 跳 /login */
const refreshOn401Link: TRPCLink<AppRouter> = () => {
  return ({ next, op }) =>
    observable((observer) => {
      const sub = next(op).subscribe({
        next: (val) => observer.next(val),
        error: async (err) => {
          if (!(err instanceof TRPCClientError)) { observer.error(err); return; }
          const code = err.data?.code as string | undefined;
          const reason = (err.data as { reason?: string } | undefined)?.reason;
          if (code === "UNAUTHORIZED" && reason === "ACCESS_EXPIRED" && !(op.context as { _refreshed?: boolean })._refreshed) {
            try {
              const r = await fetch("/api/auth/refresh", { method: "POST", credentials: "include" });
              if (r.ok) {
                const retried = next({ ...op, context: { ...(op.context as object), _refreshed: true } });
                retried.subscribe({ next: (v) => observer.next(v), error: (e) => observer.error(e), complete: () => observer.complete() });
                return;
              }
            } catch { /* fallthrough */ }
          }
          if (code === "UNAUTHORIZED" && (reason === "SESSION_REVOKED" || reason === "REUSE_DETECTED" || reason === "ACCESS_INVALID")) {
            try { await fetch("/api/auth/logout", { method: "POST", credentials: "include" }); } catch { /* noop */ }
            if (typeof window !== "undefined") window.location.href = "/login";
          }
          if (code === "UNAUTHORIZED" && reason === "NO_SESSION") {
            if (typeof window !== "undefined") window.location.href = "/login";
          }
          observer.error(err);
        },
        complete: () => observer.complete(),
      });
      return () => sub.unsubscribe();
    });
};

export function buildTrpcClient() {
  return trpc.createClient({
    links: [
      refreshOn401Link,
      httpBatchLink({ url: "/api/trpc", transformer: superjson, fetch: (url, init) => fetch(url, { ...init, credentials: "include" }) }),
    ],
  });
}
