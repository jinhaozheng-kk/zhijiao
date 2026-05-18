import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    setupFiles: [],
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
    testTimeout: 15000,
    env: {
      DATABASE_URL:
        process.env.DATABASE_URL_TEST ??
        "postgresql://postgres:postgres@localhost:5432/zhijiao_test",
    },
  },
});
