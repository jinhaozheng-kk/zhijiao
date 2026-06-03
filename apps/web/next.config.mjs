import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const standaloneOutput = process.env.NEXT_OUTPUT_STANDALONE === "1";

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  ...(standaloneOutput ? { output: "standalone" } : {}),
  experimental: {
    serverComponentsExternalPackages: ["@prisma/client"],
    ...(standaloneOutput ? { outputFileTracingRoot: path.join(__dirname, "../..") } : {}),
  },
  transpilePackages: [
    "@zhijiao/ai",
    "@zhijiao/analytics",
    "@zhijiao/auth",
    "@zhijiao/billing",
    "@zhijiao/db",
    "@zhijiao/domain",
    "@zhijiao/integrations",
  ],
  webpack(config) {
    // Allow TypeScript workspace packages that use .js extensions in ESM source
    // (e.g. `import from "./router.js"` where the file is actually router.ts)
    config.resolve.extensionAlias = {
      ".js": [".ts", ".tsx", ".js"],
      ".jsx": [".tsx", ".jsx"],
    };
    return config;
  },
};

export default nextConfig;
