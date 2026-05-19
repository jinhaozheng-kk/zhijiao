import type Redis from "ioredis";
import { RateLimitBackendDownError, type RateLimitDecision, type RateLimitStore } from "./types.js";

// KEYS[1] = bucket key
// ARGV[1] = capacity, ARGV[2] = refillPerSec, ARGV[3] = cost, ARGV[4] = nowMs
const LUA = `
local capacity = tonumber(ARGV[1])
local refill   = tonumber(ARGV[2])
local cost     = tonumber(ARGV[3])
local nowMs    = tonumber(ARGV[4])
local data = redis.call('HMGET', KEYS[1], 'tokens', 'updatedAt')
local tokens = tonumber(data[1])
local updatedAt = tonumber(data[2])
if tokens == nil then tokens = capacity; updatedAt = nowMs end
local elapsed = (nowMs - updatedAt) / 1000
tokens = math.min(capacity, tokens + elapsed * refill)
local allowed = 0
local retryAfterMs = 0
if tokens >= cost then
  tokens = tokens - cost
  allowed = 1
else
  retryAfterMs = math.ceil(((cost - tokens) / refill) * 1000)
end
redis.call('HMSET', KEYS[1], 'tokens', tokens, 'updatedAt', nowMs)
redis.call('PEXPIRE', KEYS[1], math.ceil((capacity / refill) * 1000) + 60000)
return {allowed, retryAfterMs, tostring(tokens)}
`;

export class RedisRateLimitStore implements RateLimitStore {
  constructor(private redis: Redis) {}

  async take(bucket: string, capacity: number, refillPerSec: number, cost: number, nowMs: number): Promise<RateLimitDecision> {
    try {
      const res = await this.redis.eval(
        LUA, 1, bucket,
        String(capacity), String(refillPerSec), String(cost), String(nowMs),
      ) as [number, number, string];
      return { allowed: res[0] === 1, retryAfterMs: res[1], remaining: Number(res[2]) };
    } catch (e) {
      throw new RateLimitBackendDownError(e);
    }
  }
}
