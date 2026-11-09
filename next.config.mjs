/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@rome-protocol/sdk", "@rome-protocol/registry"],
  eslint: {
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
