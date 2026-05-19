import "server-only";
import Redis from "ioredis";

declare global { var __zjRedis: Redis | undefined; }

export const redis: Redis =
  global.__zjRedis ??
  new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
    lazyConnect: false,
    maxRetriesPerRequest: 2,
  });

if (process.env.NODE_ENV !== "production") global.__zjRedis = redis;
