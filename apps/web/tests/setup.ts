// Vitest global setup — runs before any test module is evaluated.
// Route handlers import the @zhijiao/db production singleton which reads
// DATABASE_URL at PrismaClient construction time.  vitest.config.ts injects
// the per-package test DB URL via `test.env.DATABASE_URL` (plan §Task -1),
// so by the time this setup runs `process.env.DATABASE_URL` is already set.
// We fail-close if not: a missing injection silently regressing to the old
// shared `zhijiao_test` DB would reintroduce the cross-package race.
if (!process.env.DATABASE_URL) {
  throw new Error(
    "apps/web tests/setup.ts: DATABASE_URL is not set. " +
      "Did you forget vitest.config.ts `test.env.DATABASE_URL`?",
  );
}
