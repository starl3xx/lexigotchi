import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  // The automatic JSX runtime, so component tests don't each need `import React`.
  esbuild: { jsx: "automatic" },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    // .tsx included too — component tests would otherwise be silently skipped, which is
    // indistinguishable from passing.
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx", "src/**/*.test.ts", "src/**/*.test.tsx"],
    // Node by default (the sim/economy suites are pure and fast); component tests opt into jsdom
    // per file with a `@vitest-environment jsdom` docblock.
    environment: "node",
  },
});
