export interface RateLimitDecision {
  allowed: boolean;
  retryAfterMs: number;
  remaining: number;
}

export interface RateLimitStore {
  /** 原子 refill + consume；不可用时抛 RateLimitBackendDownError */
  take(bucket: string, capacity: number, refillPerSec: number, cost: number, nowMs: number): Promise<RateLimitDecision>;
}

export class RateLimitBackendDownError extends Error {
  constructor(cause?: unknown) {
    super("ratelimit backend down");
    this.name = "RateLimitBackendDownError";
    (this as { cause?: unknown }).cause = cause;
  }
}

export interface RateLimitRule {
  /** prefix + 应用层 suffix 拼成完整 bucket key */
  prefix: string;
  capacity: number;
  refillPerSec: number;
  cost?: number;
  failMode: "open" | "close";
}
