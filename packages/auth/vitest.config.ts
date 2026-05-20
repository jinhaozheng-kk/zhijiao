import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
    testTimeout: 15000,
    env: {
      DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/zhijiao_test_auth",
    },
  },
});
