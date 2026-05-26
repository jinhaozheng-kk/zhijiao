import { PrismaClient } from "@prisma/client";

// Per-package test DB: each vitest.config.ts injects its own DATABASE_URL via
// `test.env`. We fail-close instead of falling back, otherwise a missing config
// would silently point every package at the same legacy `zhijiao_test` DB and
// re-introduce the cross-package TRUNCATE race that Task -1 fixed.
const TEST_DATABASE_URL = process.env.DATABASE_URL;
if (!TEST_DATABASE_URL) {
  throw new Error(
    "@zhijiao/db/test-utils: DATABASE_URL is not set. " +
      "Vitest config must inject it via `test.env.DATABASE_URL` " +
      "(see plan §Task -1 / packages/<pkg>/vitest.config.ts).",
  );
}

export const testPrisma = new PrismaClient({
  datasources: { db: { url: TEST_DATABASE_URL } },
});

// Alias so consumers can `import { prisma, resetDb } from "@zhijiao/db/test-utils"`
export const prisma = testPrisma;

// 截断所有表（保留 schema），按依赖反向顺序
// Plan 3 Task 10 additions: wechat_pay_events, topup_orders, credit_ledger,
// wallets. All have FKs to users (Restrict on Wallet → User; no FK on
// TopupOrder.userId by design). With CASCADE on TRUNCATE the order is
// largely cosmetic, but listing them ahead of users keeps the intent
// readable.
// Plan 4 additions: variant_items, variant_groups, error_book_entries.
// VariantItem FK → VariantGroup (Cascade); VariantGroup FK → ErrorBookEntry
// (Restrict); ErrorBookEntry FK → User+Question (Restrict). CASCADE on
// TRUNCATE handles it but the ordering keeps the dependency chain visible.
export async function resetDb() {
  const tables = [
    "ops_action_logs",
    // Plan 9 — child tables first; FKs to questions (Cascade) / knowledge_points
    // (SetNull) / subjects (Restrict) / users / model_calls. Listing them before
    // their parents keeps the ordering readable; CASCADE on TRUNCATE handles
    // the actual dependency walk.
    "kp_reconcile_matches",
    "kp_aliases",
    "variant_items",
    "variant_groups",
    "error_book_entries",
    "wechat_pay_events",
    "topup_orders",
    "credit_ledger",
    "wallets",
    "model_calls",
    "prompt_templates",
    "question_kp_links",
    "question_answers",
    "questions",
    "knowledge_points",
    "subjects",
    "otp_requests",
    "sessions",
    "auth_identities",
    "user_roles",
    "users",
  ];
  for (const t of tables) {
    await testPrisma.$executeRawUnsafe(`TRUNCATE TABLE "${t}" RESTART IDENTITY CASCADE;`);
  }
}
