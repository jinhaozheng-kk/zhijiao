import "server-only";
import { AiRouter, DashScopeAdapter, MockAdapter, type ModelAdapter } from "@zhijiao/ai";
import { prisma } from "@zhijiao/db";

function buildAdapter(): ModelAdapter {
  if (process.env.AI_USE_MOCK === "true" || !process.env.DASHSCOPE_API_KEY) {
    return new MockAdapter();
  }
  return new DashScopeAdapter();
}

export function getAiRouter(userId: string) {
  return new AiRouter({ prisma, adapter: buildAdapter(), userId });
}
