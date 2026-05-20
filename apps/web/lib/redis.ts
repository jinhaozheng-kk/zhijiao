import "server-only";
import Redis from "ioredis";
import { env } from "@/server/env";

declare global { var __zjRedis: Redis | undefined; }

export const redis: Redis =
  global.__zjRedis ??
  new Redis(env.REDIS_URL, {
    lazyConnect: false,
    maxRetriesPerRequest: 2,
  });

if (process.env.NODE_ENV !== "production") global.__zjRedis = redis;
