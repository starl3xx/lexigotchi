import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Pin the workspace root — a stray parent lockfile otherwise misleads Next's inference.
  outputFileTracingRoot: here,
  // The vendored dictionary lives in /data and is imported by the economy lib.
  // No special config needed for Phase 0 (off-chain only — no contracts/indexer yet).
};

export default nextConfig;
