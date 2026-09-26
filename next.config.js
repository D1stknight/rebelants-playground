/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  webpack(config) {
    // The shared RAAP server modules use emitted .js import names. Resolve those
    // to their TypeScript sources during this existing Next.js build.
    config.resolve.extensionAlias = { ...(config.resolve.extensionAlias || {}), ".js": [".ts", ".js"] };
    return config;
  },
};
module.exports = nextConfig;
