/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    serverComponentsExternalPackages: ["@prisma/client"],
  },
  transpilePackages: ["@zhijiao/ai", "@zhijiao/db", "@zhijiao/domain"],
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
