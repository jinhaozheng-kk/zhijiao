// Tests for apps/web/server/env.ts (Task 1: C1 + C2 fail-fast env validator).
//
// env.ts runs zod validation at module load time. Once loaded, the exported `env`
// is frozen for the lifetime of the module. To test multiple env configurations
// we use vi.resetModules() between cases and dynamic import() so the validator
// re-runs with mutated process.env. We snapshot all relevant keys in beforeEach
// and fully restore them in afterEach to keep each case fully hermetic — leaking
// mutations across files would break the rest of the suite, which also imports
// env.ts indirectly via call sites.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const RELEVANT_KEYS = [
  "DATABASE_URL",
  "REDIS_URL",
  "NEXT_PUBLIC_APP_URL",
  "ACCESS_JWT_SECRET",
  "OTP_PEPPER",
  "AI_USE_MOCK",
  "SMS_USE_MOCK",
  "WECHAT_OAUTH_USE_MOCK",
  "WECHAT_PAY_USE_MOCK",
  "DASHSCOPE_API_KEY",
  "DASHSCOPE_BASE_URL",
  "ALIYUN_SMS_ACCESS_KEY_ID",
  "ALIYUN_SMS_ACCESS_KEY_SECRET",
  "ALIYUN_SMS_SIGN_NAME",
  "ALIYUN_SMS_TEMPLATE_CODE",
  "WECHAT_H5_APPID",
  "WECHAT_H5_SECRET",
  "WECHAT_PAY_APPID",
  "WECHAT_PAY_MCHID",
  "WECHAT_PAY_API_V3_KEY",
  "WECHAT_PAY_PRIVATE_KEY",
  "WECHAT_PAY_CERT_SERIAL",
  "WECHAT_PAY_PUB_KEY_FILE",
  "WECHAT_PAY_NOTIFY_HOST",
  "MOCK_WECHAT_PAY_SECRET",
  "CREDIT_PER_YUAN",
  "MINOR_MONTHLY_LIMIT_YUAN",
  "LOG_LEVEL",
  "E2E_TEST_HOOKS",
  "DEMO_MODE",
  "KP_RECONCILE_AUTO_LINK_THRESHOLD",
  "KP_RECONCILE_REVIEW_THRESHOLD",
  "PII_RETENTION_SHORT_DAYS",
  "PII_RETENTION_MEDIUM_DAYS",
  "PII_RETENTION_ORPHAN_TOPUP_DAYS",
  "FINANCIAL_RECORD_RETENTION_DAYS",
] as const;

const VALID_BASE = {
  DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/zhijiao_test_web",
  REDIS_URL: "redis://localhost:6379",
  NEXT_PUBLIC_APP_URL: "http://localhost:3000",
  ACCESS_JWT_SECRET: "test-only-access-secret-at-least-32-bytes-long",
  OTP_PEPPER: "test-only-otp-pepper-min16-x",
  AI_USE_MOCK: "true",
  SMS_USE_MOCK: "true",
  WECHAT_OAUTH_USE_MOCK: "true",
  WECHAT_PAY_USE_MOCK: "true",
  MOCK_WECHAT_PAY_SECRET: "test-mock-pay-secret-32bytes-padding",
  WECHAT_PAY_APPID: "wxpay-test-app",
  WECHAT_PAY_MCHID: "1900000000",
};

let snapshot: Record<string, string | undefined> = {};

function applyBase() {
  for (const [k, v] of Object.entries(VALID_BASE)) process.env[k] = v;
  // Wipe any optional real-config keys that may have leaked in from setup.ts.
  for (const k of RELEVANT_KEYS) {
    if (k in VALID_BASE) continue;
    delete process.env[k];
  }
}

async function importEnv() {
  vi.resetModules();
  // env.ts is a side-effect module — importing it re-runs the validator.
  return import("@/server/env");
}

beforeEach(() => {
  snapshot = {};
  for (const k of RELEVANT_KEYS) snapshot[k] = process.env[k];
});

afterEach(() => {
  for (const k of RELEVANT_KEYS) {
    if (snapshot[k] === undefined) delete process.env[k];
    else process.env[k] = snapshot[k];
  }
});

describe("server/env.ts (fail-fast validator)", () => {
  it("happy path: all USE_MOCK=true + valid secrets → env exported", async () => {
    applyBase();
    const mod = await importEnv();
    expect(mod.env.ACCESS_JWT_SECRET).toBe(VALID_BASE.ACCESS_JWT_SECRET);
    expect(mod.env.OTP_PEPPER).toBe(VALID_BASE.OTP_PEPPER);
    expect(mod.env.AI_USE_MOCK).toBe("true");
    expect(mod.env.SMS_USE_MOCK).toBe("true");
    expect(mod.env.WECHAT_OAUTH_USE_MOCK).toBe("true");
    expect(mod.env.WECHAT_PAY_USE_MOCK).toBe("true");
  });

  it("missing ACCESS_JWT_SECRET → throws at import", async () => {
    applyBase();
    delete process.env.ACCESS_JWT_SECRET;
    await expect(importEnv()).rejects.toThrow(/Invalid environment configuration/i);
  });

  it("ACCESS_JWT_SECRET length < 32 → throws", async () => {
    applyBase();
    process.env.ACCESS_JWT_SECRET = "too-short-secret"; // 16 bytes, < 32
    await expect(importEnv()).rejects.toThrow(/ACCESS_JWT_SECRET.*32/);
  });

  it("OTP_PEPPER length < 16 → throws", async () => {
    applyBase();
    process.env.OTP_PEPPER = "too-short"; // 9 bytes, < 16
    await expect(importEnv()).rejects.toThrow(/OTP_PEPPER.*16/);
  });

  it("AI_USE_MOCK=false + missing DASHSCOPE_* → throws", async () => {
    applyBase();
    process.env.AI_USE_MOCK = "false";
    // DASHSCOPE_API_KEY + DASHSCOPE_BASE_URL stay unset
    await expect(importEnv()).rejects.toThrow(/Real AI requires DASHSCOPE_API_KEY/i);
  });

  it("AI_USE_MOCK=false + full DASHSCOPE_* → passes", async () => {
    applyBase();
    process.env.AI_USE_MOCK = "false";
    process.env.DASHSCOPE_API_KEY = "sk-test";
    process.env.DASHSCOPE_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1";
    const mod = await importEnv();
    expect(mod.env.AI_USE_MOCK).toBe("false");
    expect(mod.env.DASHSCOPE_API_KEY).toBe("sk-test");
  });

  it("SMS_USE_MOCK=false + missing ALIYUN_SMS_* → throws", async () => {
    applyBase();
    process.env.SMS_USE_MOCK = "false";
    // Partial real config should still fail (validator requires all four).
    process.env.ALIYUN_SMS_ACCESS_KEY_ID = "id-only";
    await expect(importEnv()).rejects.toThrow(/Real SMS requires ALIYUN_SMS/i);
  });

  it("SMS_USE_MOCK=false + complete ALIYUN_SMS_* → passes", async () => {
    applyBase();
    process.env.SMS_USE_MOCK = "false";
    process.env.ALIYUN_SMS_ACCESS_KEY_ID = "id";
    process.env.ALIYUN_SMS_ACCESS_KEY_SECRET = "secret";
    process.env.ALIYUN_SMS_SIGN_NAME = "sign";
    process.env.ALIYUN_SMS_TEMPLATE_CODE = "SMS_123";
    const mod = await importEnv();
    expect(mod.env.SMS_USE_MOCK).toBe("false");
    expect(mod.env.ALIYUN_SMS_TEMPLATE_CODE).toBe("SMS_123");
  });

  it("WECHAT_OAUTH_USE_MOCK=false + missing WECHAT_H5_* → throws", async () => {
    applyBase();
    process.env.WECHAT_OAUTH_USE_MOCK = "false";
    // WECHAT_H5_APPID + WECHAT_H5_SECRET stay unset
    await expect(importEnv()).rejects.toThrow(/Real WeChat OAuth requires WECHAT_H5/i);
  });

  it("WECHAT_OAUTH_USE_MOCK=false + APPID only (no SECRET) → throws", async () => {
    applyBase();
    process.env.WECHAT_OAUTH_USE_MOCK = "false";
    process.env.WECHAT_H5_APPID = "wxlive";
    // WECHAT_H5_SECRET missing → validator must still reject
    await expect(importEnv()).rejects.toThrow(/Real WeChat OAuth requires WECHAT_H5/i);
  });

  it("WECHAT_OAUTH_USE_MOCK=false + APPID + SECRET → passes", async () => {
    applyBase();
    process.env.WECHAT_OAUTH_USE_MOCK = "false";
    process.env.WECHAT_H5_APPID = "wxlive";
    process.env.WECHAT_H5_SECRET = "real-secret";
    const mod = await importEnv();
    expect(mod.env.WECHAT_OAUTH_USE_MOCK).toBe("false");
    expect(mod.env.WECHAT_H5_APPID).toBe("wxlive");
  });

  it("WECHAT_PAY_USE_MOCK=true + missing MOCK_WECHAT_PAY_SECRET throws", async () => {
    applyBase();
    delete process.env.MOCK_WECHAT_PAY_SECRET;
    await expect(importEnv()).rejects.toThrow(/MOCK_WECHAT_PAY_SECRET/i);
  });

  it("WECHAT_PAY_USE_MOCK=true + short MOCK_WECHAT_PAY_SECRET throws", async () => {
    applyBase();
    process.env.MOCK_WECHAT_PAY_SECRET = "too-short";
    await expect(importEnv()).rejects.toThrow(/MOCK_WECHAT_PAY_SECRET.*16/i);
  });

  it("WECHAT_PAY_USE_MOCK=true + missing WECHAT_PAY_APPID throws", async () => {
    applyBase();
    delete process.env.WECHAT_PAY_APPID;
    await expect(importEnv()).rejects.toThrow(/WECHAT_PAY_APPID/i);
  });

  it("WECHAT_PAY_USE_MOCK=true + missing WECHAT_PAY_MCHID throws", async () => {
    applyBase();
    delete process.env.WECHAT_PAY_MCHID;
    await expect(importEnv()).rejects.toThrow(/WECHAT_PAY_MCHID/i);
  });

  it("WECHAT_PAY_USE_MOCK=false + missing real WECHAT_PAY_* throws", async () => {
    applyBase();
    process.env.WECHAT_PAY_USE_MOCK = "false";
    process.env.WECHAT_PAY_APPID = "wxpay-live";
    process.env.WECHAT_PAY_MCHID = "1900000000";
    // Remaining real-mode credentials stay unset.
    await expect(importEnv()).rejects.toThrow(/Real WeChat Pay requires/i);
  });

  it("WECHAT_PAY_USE_MOCK=false + complete real WECHAT_PAY_* passes", async () => {
    applyBase();
    process.env.WECHAT_PAY_USE_MOCK = "false";
    process.env.WECHAT_PAY_APPID = "wxpay-live";
    process.env.WECHAT_PAY_MCHID = "1900000000";
    process.env.WECHAT_PAY_API_V3_KEY = "api-v3-key-32bytes-placeholder";
    process.env.WECHAT_PAY_PRIVATE_KEY = "-----BEGIN PRIVATE KEY-----test-----END PRIVATE KEY-----";
    process.env.WECHAT_PAY_CERT_SERIAL = "cert-serial";
    process.env.WECHAT_PAY_PUB_KEY_FILE = "./certs/wechat-pay/platform.pem";
    process.env.WECHAT_PAY_NOTIFY_HOST = "https://zhijiao.example.com";

    const mod = await importEnv();
    expect(mod.env.WECHAT_PAY_USE_MOCK).toBe("false");
    expect(mod.env.WECHAT_PAY_APPID).toBe("wxpay-live");
    expect(mod.env.WECHAT_PAY_NOTIFY_HOST).toBe("https://zhijiao.example.com");
  });

  it("credit pricing env defaults are numeric", async () => {
    applyBase();
    const mod = await importEnv();
    expect(mod.env.CREDIT_PER_YUAN).toBe(10);
    expect(mod.env.MINOR_MONTHLY_LIMIT_YUAN).toBe(200);
  });

  it("credit pricing env values are coerced to positive integers", async () => {
    applyBase();
    process.env.CREDIT_PER_YUAN = "25";
    process.env.MINOR_MONTHLY_LIMIT_YUAN = "300";
    const mod = await importEnv();
    expect(mod.env.CREDIT_PER_YUAN).toBe(25);
    expect(mod.env.MINOR_MONTHLY_LIMIT_YUAN).toBe(300);
  });

  it("accepts DEMO_MODE=1", async () => {
    applyBase();
    process.env.DEMO_MODE = "1";
    const mod = await importEnv();
    expect(mod.env.DEMO_MODE).toBe("1");
  });

  it("defaults DEMO_MODE to 0", async () => {
    applyBase();
    delete process.env.DEMO_MODE;
    const mod = await importEnv();
    expect(mod.env.DEMO_MODE).toBe("0");
  });

  it("LOG_LEVEL rejects unknown values", async () => {
    applyBase();
    process.env.LOG_LEVEL = "verbose";
    await expect(importEnv()).rejects.toThrow(/LOG_LEVEL/i);
  });

  // Plan 9: KP_RECONCILE thresholds
  it("KP_RECONCILE thresholds 默认 0.85 / 0.6", async () => {
    applyBase();
    delete process.env.KP_RECONCILE_AUTO_LINK_THRESHOLD;
    delete process.env.KP_RECONCILE_REVIEW_THRESHOLD;
    const mod = await importEnv();
    expect(mod.env.KP_RECONCILE_AUTO_LINK_THRESHOLD).toBe(0.85);
    expect(mod.env.KP_RECONCILE_REVIEW_THRESHOLD).toBe(0.6);
  });

  it("KP_RECONCILE_REVIEW_THRESHOLD >= AUTO_LINK throws", async () => {
    applyBase();
    process.env.KP_RECONCILE_AUTO_LINK_THRESHOLD = "0.7";
    process.env.KP_RECONCILE_REVIEW_THRESHOLD = "0.8";
    await expect(importEnv()).rejects.toThrow(/REVIEW_THRESHOLD must be strictly less/);
  });

  it("PII retention env defaults are 30 / 90 / 180 and financial retention is null", async () => {
    applyBase();
    const mod = await importEnv();
    expect(mod.env.PII_RETENTION_SHORT_DAYS).toBe(30);
    expect(mod.env.PII_RETENTION_MEDIUM_DAYS).toBe(90);
    expect(mod.env.PII_RETENTION_ORPHAN_TOPUP_DAYS).toBe(180);
    expect(mod.env.FINANCIAL_RECORD_RETENTION_DAYS).toBeNull();
  });

  it("PII retention env values are coerced to positive integers", async () => {
    applyBase();
    process.env.PII_RETENTION_SHORT_DAYS = "7";
    process.env.PII_RETENTION_MEDIUM_DAYS = "30";
    process.env.PII_RETENTION_ORPHAN_TOPUP_DAYS = "180";
    process.env.FINANCIAL_RECORD_RETENTION_DAYS = "3650";
    const mod = await importEnv();
    expect(mod.env.PII_RETENTION_SHORT_DAYS).toBe(7);
    expect(mod.env.PII_RETENTION_MEDIUM_DAYS).toBe(30);
    expect(mod.env.PII_RETENTION_ORPHAN_TOPUP_DAYS).toBe(180);
    expect(mod.env.FINANCIAL_RECORD_RETENTION_DAYS).toBe(3650);
  });

  it("PII retention medium must be strictly greater than short", async () => {
    applyBase();
    process.env.PII_RETENTION_SHORT_DAYS = "10";
    process.env.PII_RETENTION_MEDIUM_DAYS = "5";
    await expect(importEnv()).rejects.toThrow(/PII_RETENTION_MEDIUM_DAYS must be strictly greater/);
  });

  it("PII retention orphan topup must be strictly greater than medium", async () => {
    applyBase();
    process.env.PII_RETENTION_MEDIUM_DAYS = "90";
    process.env.PII_RETENTION_ORPHAN_TOPUP_DAYS = "80";
    await expect(importEnv()).rejects.toThrow(/PII_RETENTION_ORPHAN_TOPUP_DAYS must be strictly greater/);
  });
});
