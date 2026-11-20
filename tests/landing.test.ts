import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { HOW_IT_WORKS, pct } from "@/lib/howItWorks";
import { DEFAULT_PARAMS } from "@/lib/params";
import { WORD_COUNT } from "@/lib/dictionary";
import { metadata } from "@/app/page";

/**
 * The landing page at `/` and the copy it shares with the in-game onboarding.
 *
 * Two silent failures are guarded here. Copy that types a number goes stale the day a param moves,
 * and nothing looks broken. And a wallet import on the landing page would put the whole wagmi /
 * RainbowKit stack on the first load of every visitor who only came to read.
 */

const ROOT = resolve(__dirname, "..");

describe("how-it-works copy", () => {
  it("states the roll odds and dictionary size the economy actually uses", () => {
    const text = HOW_IT_WORKS.map((s) => s.body).join(" ");
    expect(text).toContain(`odds start at ${pct(DEFAULT_PARAMS.roll.baseSuccess)}`);
    expect(text).toContain(`${WORD_COUNT.toLocaleString("en-US")}-word dictionary`);
  });

  it("is four numbered steps, in order", () => {
    expect(HOW_IT_WORKS.map((s) => s.n)).toEqual([1, 2, 3, 4]);
  });
});

describe("landing page", () => {
  const files = [
    resolve(ROOT, "src/app/page.tsx"),
    ...readdirSync(resolve(ROOT, "src/components/landing")).map((f) => resolve(ROOT, "src/components/landing", f)),
  ];

  it("imports no wallet code", () => {
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      expect(src, f).not.toMatch(/from ["'](wagmi|@rainbow-me\/|@neynar\/react|@farcaster\/miniapp)/);
      expect(src, f).not.toMatch(/components\/game\/Providers/);
    }
  });

  it("keeps the mini-app launch card on shared root links, launching the game at /play", () => {
    const other = metadata.other as Record<string, string>;
    const embed = JSON.parse(other["fc:miniapp"]);
    expect(embed.button.action.url).toMatch(/\/play$/);
    expect(other["base:app_id"]).toBeTruthy();
  });
});
