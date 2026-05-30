"use client";

import { useState, type ReactNode } from "react";
import {
  QueryClient,
  QueryClientProvider,
  QueryCache,
  MutationCache,
} from "@tanstack/react-query";
import { trpc, buildTrpcClient } from "@/lib/trpc-client";

function isConsentRequired(err: unknown): boolean {
  return (
    (err as { data?: { reason?: string } } | null)?.data?.reason ===
    "GUARDIAN_CONSENT_REQUIRED"
  );
}

function redirectToConsent() {
  if (
    typeof window !== "undefined" &&
    window.location.pathname !== "/guardian-consent"
  ) {
    window.location.href = "/guardian-consent";
  }
}

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        queryCache: new QueryCache({
          onError: (e) => {
            if (isConsentRequired(e)) redirectToConsent();
          },
        }),
        mutationCache: new MutationCache({
          onError: (e) => {
            if (isConsentRequired(e)) redirectToConsent();
          },
        }),
      }),
  );
  const [trpcClient] = useState(() => buildTrpcClient());
  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </trpc.Provider>
  );
}
