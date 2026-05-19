import type { RateLimitDecision, RateLimitStore } from "./types.js";

type Bucket = { tokens: number; updatedAt: number };

export class InMemoryRateLimitStore implements RateLimitStore {
  private buckets = new Map<string, Bucket>();

  async take(bucket: string, capacity: number, refillPerSec: number, cost: number, nowMs: number): Promise<RateLimitDecision> {
    const b = this.buckets.get(bucket) ?? { tokens: capacity, updatedAt: nowMs };
    const elapsed = (nowMs - b.updatedAt) / 1000;
    const tokens = Math.min(capacity, b.tokens + elapsed * refillPerSec);
    if (tokens >= cost) {
      const next = { tokens: tokens - cost, updatedAt: nowMs };
      this.buckets.set(bucket, next);
      return { allowed: true, retryAfterMs: 0, remaining: next.tokens };
    }
    const need = cost - tokens;
    const retryAfterMs = Math.ceil((need / refillPerSec) * 1000);
    this.buckets.set(bucket, { tokens, updatedAt: nowMs });
    return { allowed: false, retryAfterMs, remaining: tokens };
  }

  reset() { this.buckets.clear(); }
}
