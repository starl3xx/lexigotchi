import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // tree-shake the Phosphor icon barrel so we don't bundle the whole set
  experimental: { optimizePackageImports: ["@phosphor-icons/react"] },
  // Pin the workspace root — a stray parent lockfile otherwise misleads Next's inference.
  outputFileTracingRoot: here,
  // The vendored dictionary lives in /data and is imported by the economy lib.
  webpack: (config) => {
    // `wagmi/connectors` is a barrel: importing ANY connector pulls in `baseAccount`, which reaches
    // @base-org/account → @coinbase/cdp-sdk → the @x402/* packages. Those are declared OPTIONAL peers
    // of cdp-sdk and are absent by design — the SDK guards for them at runtime — but webpack still
    // tries to resolve the static import and fails the build. Lexigotchi never uses Base Account
    // payments (we route every write through sendCallsAttributed), so resolve them to empty modules
    // rather than installing four packages we will never call.
    config.resolve.alias = {
      ...config.resolve.alias,
      "@x402/core": false,
      "@x402/evm": false,
      "@x402/extensions": false,
      "@x402/svm": false,
    };
    return config;
  },
};

export default nextConfig;
