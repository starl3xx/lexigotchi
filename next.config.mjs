import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { existsSync } from "node:fs";

const here = dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Sound is dark without its files (src/lib/sound.ts, decisions.md #49 part 4): the switch shows
  // only where the mail's cues are in this build, or NEXT_PUBLIC_SOUND_BASE says where they are served.
  env: { NEXT_PUBLIC_SOUND_READY: process.env.NEXT_PUBLIC_SOUND_BASE || existsSync(join(here, "public/sfx/mail/drop.mp3")) ? "1" : "" },
  // tree-shake the Phosphor icon barrel so we don't bundle the whole set
  experimental: { optimizePackageImports: ["@phosphor-icons/react"] },
  // Pin the workspace root — a stray parent lockfile otherwise misleads Next's inference.
  outputFileTracingRoot: here,
  // The Showcase card (src/app/s/[text]/card) is the one route that reads the Söhne TTFs at REQUEST
  // time (/embed-image and /icon-image are static, so they read them at build). A serverless
  // function only ships the files the build traced, so name them rather than trust the tracer.
  // The earnings share's picture (src/app/e/[token]/card) reads them the same way, and both read
  // the card ribbon's Pagella (Bugbot on #231: a function ships only the files named or traced).
  outputFileTracingIncludes: {
    "/s/[text]/card": ["./public/fonts/soehne-*.ttf", "./public/fonts/texgyrepagella-bold.otf"],
    "/e/[token]/card": ["./public/fonts/soehne-*.ttf", "./public/fonts/texgyrepagella-bold.otf"],
  },
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
