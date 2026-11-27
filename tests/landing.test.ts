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

  it("shows the rarest word as its own card: the engraved Stage, one render at every width, the label under it", () => {
    const src = readFileSync(resolve(ROOT, "src/components/landing/LandingPage.tsx"), "utf8");
    const hero = src.slice(src.indexOf("function Stage()"), src.indexOf("const STEP_VISUALS"));
    expect(hero).toContain('<SceneFrame scene="stage" word={RAREST_WORD} upper={upper} tier="Mythic" />');
    // a card sizes its letters to itself: the word is not drawn once for each screen width
    expect(hero).not.toContain("TileWord");
    expect(hero).not.toMatch(/sm:hidden|lg:hidden|xl:flex/);
    // it stands on the page as a card does, with its corner, and nothing is drawn over its art
    expect(hero).toMatch(/className="card-stand w-full"[\s\S]*className="card-corner overflow-hidden border-\[3px\] border-ink"/);
    expect(hero).not.toContain("absolute");
    expect(hero.indexOf("The rarest word")).toBeGreaterThan(hero.indexOf("<SceneFrame"));
    // the flat stage is gone
    expect(src).not.toMatch(/bg-curtain|radial-gradient\(circle at 50% 0, #7b1e26/);
  });

  it("keeps the mini-app launch card on shared root links, launching the game at /play", () => {
    const other = metadata.other as Record<string, string>;
    const embed = JSON.parse(other["fc:miniapp"]);
    expect(embed.button.action.url).toMatch(/\/play$/);
    expect(other["base:app_id"]).toBeTruthy();
  });
});
