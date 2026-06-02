import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  // Match Next.js / tsconfig automatic JSX runtime so .tsx tests can render
  // components with react-dom/server without importing React explicitly.
  esbuild: { jsx: "automatic" },
  test: {
    environment: "node",
    include: ["tests/**/*.test.{ts,tsx}"],
    setupFiles: ["./tests/setup.ts"],
    pool: "threads", poolOptions: { threads: { singleThread: true } },
    testTimeout: 20_000,
    hookTimeout: 20_000,
    env: {
      // Per-package test DB (plan §Task -1). Same DB also used by E2E global-setup.
      DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/zhijiao_test_web",
    },
    server: {
      deps: {
        // Allow vitest to resolve workspace packages from source
        inline: [/@zhijiao\/.*/],
      },
    },
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)).replace(/\/$/, ""),
      "server-only": fileURLToPath(new URL("./tests/__mocks__/server-only.ts", import.meta.url)),
    },
  },
});
