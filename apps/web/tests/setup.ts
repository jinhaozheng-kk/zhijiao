// Vitest global setup — runs before any test module is evaluated.
// Route handlers import the @zhijiao/db production singleton which reads DATABASE_URL
// at PrismaClient construction time.  Point it at the test DB so the singleton
// connects to the right place (same DB that @zhijiao/db/test-utils uses).
process.env.DATABASE_URL =
  process.env.DATABASE_URL_TEST ?? "postgresql://postgres:postgres@localhost:5432/zhijiao_test";
