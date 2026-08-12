import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { resolve, relative } from "node:path";

/**
 * Builder-code attribution is mandatory (CLAUDE.md): every on-chain write the app originates must
 * carry our ERC-8021 suffix, which means routing through `sendCallsAttributed`.
 *
 * The failure mode this guards is SILENT. wagmi's `useWriteContract` / `useSendTransaction` are the
 * ergonomic, obvious way to send a transaction — and they omit the suffix. The tx still succeeds;
 * it's just uncredited, so we forfeit Base builder rewards with nothing visibly broken to notice.
 * A comment can't catch that. This test can.
 *
 * If you're adding a legitimate exception, add the file to ALLOWED and say why.
 */

const ROOT = resolve(__dirname, "..");
const SRC = resolve(ROOT, "src");

/** Only the chokepoint itself may talk to the wallet's write methods. */
const ALLOWED = new Set(["src/lib/onchain/sendCalls.ts"]);

/** APIs that send a transaction without our attribution suffix. */
const FORBIDDEN = [
  "useWriteContract",
  "useSendTransaction",
  "useSendCalls",
  "wallet_sendCalls",
  "eth_sendTransaction",
  "writeContract",
  "sendTransaction",
];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = resolve(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

/** Strip comments and string literals so prose about the rule doesn't trip the rule. */
function stripNonCode(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "")
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
    .replace(/`(?:[^`\\]|\\.)*`/g, "``");
}

describe("no on-chain write bypasses the attributed chokepoint", () => {
  const files = walk(SRC);

  it("scans a non-trivial number of source files (guards against a broken walk)", () => {
    expect(files.length).toBeGreaterThan(30);
  });

  it("finds no write API outside src/lib/onchain/sendCalls.ts", () => {
    const violations: string[] = [];
    for (const file of files) {
      const rel = relative(ROOT, file);
      if (ALLOWED.has(rel)) continue;
      const code = stripNonCode(readFileSync(file, "utf8"));
      for (const api of FORBIDDEN) {
        // Word-boundary match so `sendTransaction` doesn't fire on `sendTransactionPlan`.
        if (new RegExp(`\\b${api}\\b`).test(code)) violations.push(`${rel} → ${api}`);
      }
    }
    expect(violations, `Route these through sendCallsAttributed():\n  ${violations.join("\n  ")}`).toEqual([]);
  });

  it("the chokepoint itself still carries the builder suffix", () => {
    const chokepoint = readFileSync(resolve(ROOT, "src/lib/onchain/sendCalls.ts"), "utf8");
    expect(chokepoint).toMatch(/builderCapabilities/);
    expect(chokepoint).toMatch(/appendBuilderSuffix/);
  });
});
