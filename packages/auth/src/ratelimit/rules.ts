import type { RateLimitRule } from "./types.js";

export const RULE_OTP_SEND_PHONE: RateLimitRule = { prefix: "otp:send:phone:", capacity: 5,  refillPerSec: 1/60,  failMode: "close" };
export const RULE_OTP_SEND_IP:    RateLimitRule = { prefix: "otp:send:ip:",    capacity: 10, refillPerSec: 10/60, failMode: "close" };
export const RULE_OTP_VERIFY_PH:  RateLimitRule = { prefix: "otp:verify:phone:", capacity: 5, refillPerSec: 5/60, failMode: "close" };
export const RULE_REGISTER_IP:    RateLimitRule = { prefix: "register:ip:",     capacity: 5, refillPerSec: 5/60,  failMode: "open" };
export const RULE_REFRESH:        RateLimitRule = { prefix: "refresh:",         capacity: 6, refillPerSec: 6/60,  failMode: "open" };
export const RULE_TOPUP_CREATE_IP:   RateLimitRule = { prefix: "topup:create:ip:",   capacity: 5,  refillPerSec: 5/60,   failMode: "close" };
export const RULE_TOPUP_CREATE_USER: RateLimitRule = { prefix: "topup:create:user:", capacity: 10, refillPerSec: 10/600, failMode: "close" };

import type { RateLimitStore, RateLimitDecision } from "./types.js";
import { RateLimitBackendDownError } from "./types.js";

/**
 * 按规则做一次限频判定。
 *  - fail-open：backend 抛 → 视为 {allowed:true}
 *  - fail-close：backend 抛 → 重抛 RateLimitBackendDownError
 */
export async function takeRule(
  store: RateLimitStore,
  rule: RateLimitRule,
  keySuffix: string,
  nowMs = Date.now(),
): Promise<RateLimitDecision> {
  try {
    return await store.take(rule.prefix + keySuffix, rule.capacity, rule.refillPerSec, rule.cost ?? 1, nowMs);
  } catch (e) {
    if (e instanceof RateLimitBackendDownError) {
      if (rule.failMode === "open") return { allowed: true, retryAfterMs: 0, remaining: rule.capacity };
      throw e;
    }
    throw e;
  }
}
