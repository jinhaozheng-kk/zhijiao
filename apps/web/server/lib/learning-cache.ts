import "server-only";
import { redis } from "@/lib/redis";

export const ANALYTICS_TTL_SEC = 300; // 5 分钟纯 TTL，无主动失效

// LearningProfile / ClassDiagnosis 都是 JSON-safe（数字/字符串/数组 + ISO string），
// 直接 JSON.stringify；不放 Date 对象，不需要 superjson。
export async function getCachedJson<T>(
  key: string,
  ttlSec: number,
  loader: () => Promise<T>,
): Promise<T> {
  const cached = await redis.get(key);
  if (cached) {
    try {
      return JSON.parse(cached) as T;
    } catch {
      // 损坏缓存：丢弃，重算
    }
  }
  const fresh = await loader();
  await redis.set(key, JSON.stringify(fresh), "EX", ttlSec);
  return fresh;
}

export const profileCacheKey = (userId: string, window: string) =>
  `analytics:profile:${userId}:${window}`;
export const classCacheKey = (classroomId: string, window: string) =>
  `analytics:class:${classroomId}:${window}`;
