import { randomBytes } from "node:crypto";
import type Redis from "ioredis";
import { AuthError } from "./errors.js";

export type RegisterPayload = {
  provider: "PHONE" | "WECHAT_H5";
  providerScope: string;
  providerUserId: string;
  unionId?: string;
  profile?: { nickname?: string; avatarUrl?: string };
};

const TTL_SECONDS = 600;
const KEY = (nonce: string) => `register:${nonce}`;

export async function putRegisterPayload(redis: Redis, payload: RegisterPayload): Promise<string> {
  const nonce = randomBytes(16).toString("base64url");
  await redis.set(KEY(nonce), JSON.stringify({ payload, used: false }), "EX", TTL_SECONDS);
  return nonce;
}

export async function peekRegisterPayload(redis: Redis, nonce: string): Promise<RegisterPayload> {
  const raw = await redis.get(KEY(nonce));
  if (!raw) throw new AuthError("REGISTER_TOKEN_MISSING");
  const parsed = JSON.parse(raw) as { payload: RegisterPayload; used: boolean };
  if (parsed.used) throw new AuthError("REGISTER_TOKEN_MISSING");
  return parsed.payload;
}

/** 标记已用 + 短期保留（防 race 二次提交）。失败安全：写不进也不抛 */
export async function markRegisterUsed(redis: Redis, nonce: string, payload: RegisterPayload): Promise<void> {
  await redis.set(KEY(nonce), JSON.stringify({ payload, used: true }), "EX", 60);
}

/** 失败 + 立即弃用：把 nonce 标 used，禁止重试 */
export async function abortRegister(redis: Redis, nonce: string, payload: RegisterPayload): Promise<void> {
  await markRegisterUsed(redis, nonce, payload);
}
