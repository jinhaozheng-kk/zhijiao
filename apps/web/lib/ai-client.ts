import "server-only";
import { AiRouter, DashScopeAdapter, MockAdapter, type ModelAdapter } from "@zhijiao/ai";
import { prisma } from "@zhijiao/db";
import { env } from "@/server/env";

// Plan 2 Hardening — Task 2 (C2): `AI_USE_MOCK === "true"` is the sole entry
// into MockAdapter. When AI_USE_MOCK="false" we always return DashScopeAdapter;
// missing DASHSCOPE_API_KEY in that mode is the env validator's job to catch
// at boot, and DashScopeAdapter's constructor throws a second time defensively.
// No `|| !DASHSCOPE_API_KEY → Mock` silent downgrade.
export function buildAdapter(): ModelAdapter {
  if (env.AI_USE_MOCK === "true") return new MockAdapter();
  return new DashScopeAdapter();
}

export function getAiRouter(userId: string) {
  return new AiRouter({ prisma, adapter: buildAdapter(), userId });
}
