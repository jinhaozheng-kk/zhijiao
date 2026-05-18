/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    serverComponentsExternalPackages: ["@prisma/client"],
  },
  transpilePackages: ["@zhijiao/ai", "@zhijiao/db", "@zhijiao/domain"],
};

export default nextConfig;
