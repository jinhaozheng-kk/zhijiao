import "server-only";
import { prisma } from "@zhijiao/db";
import { redis } from "@/lib/redis";

export type ReadinessCheck = {
  ok: boolean;
  reason?: "dependency check failed";
};

export type ReadinessResult = {
  ok: boolean;
  service: "zhijiao-web";
  checkedAt: string;
  checks: {
    database: ReadinessCheck;
    redis: ReadinessCheck;
  };
};

export type ReadinessDeps = {
  now?: () => Date;
  checkDatabase?: () => Promise<void>;
  checkRedis?: () => Promise<void>;
};

export async function checkReadiness(deps: ReadinessDeps = {}): Promise<ReadinessResult> {
  const [database, redisCheck] = await Promise.all([
    runCheck(deps.checkDatabase ?? defaultCheckDatabase),
    runCheck(deps.checkRedis ?? defaultCheckRedis),
  ]);

  return {
    ok: database.ok && redisCheck.ok,
    service: "zhijiao-web",
    checkedAt: (deps.now ?? (() => new Date()))().toISOString(),
    checks: {
      database,
      redis: redisCheck,
    },
  };
}

async function runCheck(check: () => Promise<void>): Promise<ReadinessCheck> {
  try {
    await check();
    return { ok: true };
  } catch {
    return { ok: false, reason: "dependency check failed" };
  }
}

async function defaultCheckDatabase(): Promise<void> {
  await prisma.$queryRaw`SELECT 1`;
}

async function defaultCheckRedis(): Promise<void> {
  const pong = await redis.ping();
  if (pong !== "PONG") throw new Error("unexpected redis ping response");
}
