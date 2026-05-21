import "server-only";
import { z } from "zod";

// Plan 2 Hardening — Task 1 (C1 + C2): fail-fast server env validation.
// Module-load side effect: any server bundle that touches env.ts first triggers
// this. Missing or malformed env → throw → Next.js logs the issue at boot.
// No silent fallback anywhere. No `?? ""` rescue at call sites.

const Env = z
  .object({
    // Infra
    DATABASE_URL: z.string().url(),
    REDIS_URL: z.string().url(),
    NEXT_PUBLIC_APP_URL: z.string().url(),

    // Auth secrets (Critical: no defaults; length floor)
    ACCESS_JWT_SECRET: z.string().min(32, "ACCESS_JWT_SECRET must be >= 32 bytes"),
    OTP_PEPPER: z.string().min(16, "OTP_PEPPER must be >= 16 bytes"),

    // Mock switches: "true" is the ONLY path into mock adapters. Default to
    // "false" so a missing flag in prod fails refines instead of silently mocking.
    AI_USE_MOCK: z.enum(["true", "false"]).default("false"),
    SMS_USE_MOCK: z.enum(["true", "false"]).default("false"),
    WECHAT_OAUTH_USE_MOCK: z.enum(["true", "false"]).default("false"),

    // Real-mode credentials (checked by .refine below — optional at schema level
    // because they're only required when the corresponding USE_MOCK="false").
    DASHSCOPE_API_KEY: z.string().optional(),
    DASHSCOPE_BASE_URL: z.string().url().optional(),
    ALIYUN_SMS_ACCESS_KEY_ID: z.string().optional(),
    ALIYUN_SMS_ACCESS_KEY_SECRET: z.string().optional(),
    ALIYUN_SMS_SIGN_NAME: z.string().optional(),
    ALIYUN_SMS_TEMPLATE_CODE: z.string().optional(),
    WECHAT_H5_APPID: z.string().optional(),
    WECHAT_H5_SECRET: z.string().optional(),

    // E2E hooks: only "1" unlocks /api/__test__/* style endpoints.
    E2E_TEST_HOOKS: z.enum(["0", "1"]).default("0"),
  })
  .refine(
    (e) => e.AI_USE_MOCK === "true" || (!!e.DASHSCOPE_API_KEY && !!e.DASHSCOPE_BASE_URL),
    { message: "Real AI requires DASHSCOPE_API_KEY + DASHSCOPE_BASE_URL" },
  )
  .refine(
    (e) =>
      e.SMS_USE_MOCK === "true" ||
      (!!e.ALIYUN_SMS_ACCESS_KEY_ID &&
        !!e.ALIYUN_SMS_ACCESS_KEY_SECRET &&
        !!e.ALIYUN_SMS_SIGN_NAME &&
        !!e.ALIYUN_SMS_TEMPLATE_CODE),
    { message: "Real SMS requires ALIYUN_SMS_* (id / secret / sign / template)" },
  )
  .refine(
    (e) =>
      e.WECHAT_OAUTH_USE_MOCK === "true" ||
      (!!e.WECHAT_H5_APPID && !!e.WECHAT_H5_SECRET),
    { message: "Real WeChat OAuth requires WECHAT_H5_APPID + WECHAT_H5_SECRET" },
  );

// `next build` performs page-data collection which side-effect-imports every
// server module — including this one — without the runtime env present. Failing
// fast there would block CI / E2E (`test:e2e` is `next build && playwright test`)
// even though the production `next start` invocation later boots with a full
// env. Skipping the check during the build phase preserves spec §3.1's intent
// (fail at dev / start / test, not at first request) while letting introspection
// pass. The actual `next start` (E2E and prod) still runs the validator.
const isBuildPhase = process.env.NEXT_PHASE === "phase-production-build";

const parsed = isBuildPhase
  ? Env.safeParse({
      // Inject placeholders just enough to satisfy the schema during build.
      // Any of these reaching runtime would be a bug — `next start` re-imports
      // env.ts with the actual env and re-validates.
      DATABASE_URL: "postgresql://build:build@127.0.0.1:5432/build_phase_placeholder",
      REDIS_URL: "redis://build-phase-placeholder:6379",
      NEXT_PUBLIC_APP_URL: "http://build-phase-placeholder",
      ACCESS_JWT_SECRET: "build-phase-placeholder-min-32-bytes-padding",
      OTP_PEPPER: "build-phase-placeholder-16+",
      AI_USE_MOCK: "true",
      SMS_USE_MOCK: "true",
      WECHAT_OAUTH_USE_MOCK: "true",
      E2E_TEST_HOOKS: "0",
    })
  : Env.safeParse(process.env);

if (!parsed.success) {
  const lines = parsed.error.issues.map(
    (issue) => `  ${issue.path.join(".") || "<root>"}: ${issue.message}`,
  );
  // eslint-disable-next-line no-console
  console.error("[env] invalid environment:\n" + lines.join("\n"));
  // Include all issue lines in the thrown message so callers / tests / operators
  // see the full reason without grepping stderr.
  throw new Error("Invalid environment configuration:\n" + lines.join("\n"));
}

export const env = parsed.data;
export type Env = z.infer<typeof Env>;
