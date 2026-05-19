import { randomBytes } from "node:crypto";
import type Redis from "ioredis";

export type WechatStateMode = "login" | "bind";
export type WechatStatePayload = { mode: WechatStateMode; userId?: string };

const TTL_SECONDS = 300;
const KEY = (state: string) => `wx:state:${state}`;

export async function putWechatState(redis: Redis, payload: WechatStatePayload): Promise<string> {
  const state = randomBytes(16).toString("base64url");
  await redis.set(KEY(state), JSON.stringify(payload), "EX", TTL_SECONDS);
  return state;
}

/** 单次消费（GETDEL）；返回 null 表示状态不存在或已被消费 */
export async function consumeWechatState(redis: Redis, state: string): Promise<WechatStatePayload | null> {
  // ioredis 5 自带 getdel
  const raw = await redis.getdel(KEY(state));
  if (!raw) return null;
  return JSON.parse(raw) as WechatStatePayload;
}
