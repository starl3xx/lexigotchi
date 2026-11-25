/**
 * The rarity marks (lib/tierMark, components/game/TierMark; decisions.md #28): a round bead for
 * Common, then a stone with one more corner per tier. These hold the rule a player reads the marks
 * by (count the corners), the drawing rules that let the server draw them (plain paths, every
 * attribute given), and that the game and the back picture draw from the one source.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { TIERS } from "@/lib/economy";
import { TIER_MARK, TIER_MARK_COLOR, TIER_MARK_CORNERS, tierMarkPaths } from "@/lib/tierMark";
import { TierMark } from "@/components/game/TierMark";

const names = TIERS.map((t) => t.name);
/** The corners of a mark's outline: the points of its base path (a bead has none, only arcs). */
const corners = (d: string) => (/[Aa]/.test(d) ? 0 : (d.match(/[ML]/g) ?? []).length);

describe("the rarity marks", () => {
  it("draws one for every tier", () => {
    expect(Object.keys(TIER_MARK).sort()).toEqual([...names].sort());
    expect(Object.keys(TIER_MARK_COLOR).sort()).toEqual([...names].sort());
  });

  it("orders them by one rule: a bead, then one more corner per tier", () => {
    expect(names.map((t) => TIER_MARK_CORNERS[t])).toEqual([0, 3, 4, 5, 6]);
    // and the drawings agree with the numbers
    for (const t of names) expect(corners(TIER_MARK[t][0].d), t).toBe(TIER_MARK_CORNERS[t]);
  });

  it("gives every tier its own outline and its own colour", () => {
    expect(new Set(names.map((t) => TIER_MARK[t][0].d)).size).toBe(names.length);
    expect(new Set(names.map((t) => TIER_MARK_COLOR[t])).size).toBe(names.length);
  });

  it("builds each from the same layers: a base in the ink line, then a light and a shade", () => {
    for (const t of names) expect(TIER_MARK[t].map((l) => l.part), t).toEqual(["base", "light", "shade"]);
  });

  it("keeps to flat paths inside the 20×20 box (no curves the server can't draw, nothing clipped)", () => {
    for (const t of names) {
      for (const l of TIER_MARK[t]) {
        expect(l.d, t).toMatch(/^[MLACZ0-9. ]+$/);
        // arc flags and radii aside, every coordinate sits inside the box
        const nums = l.d.replace(/A[^A-Z]*/g, " ").match(/[0-9.]+/g)!.map(Number);
        expect(Math.min(...nums), t).toBeGreaterThanOrEqual(0);
        expect(Math.max(...nums), t).toBeLessThanOrEqual(20);
      }
    }
  });

  it("spells out every attribute (Satori writes a missing one as the text “undefined”)", () => {
    for (const t of names) {
      const paths = tierMarkPaths(t);
      expect(paths).toHaveLength(3);
      for (const p of paths) {
        for (const v of Object.values(p)) expect(v === undefined || v === null || Number.isNaN(v), t).toBe(false);
        expect(p.opacity).toBeGreaterThan(0);
        expect(p.opacity).toBeLessThanOrEqual(1);
      }
      expect(paths[0]).toMatchObject({ fill: TIER_MARK_COLOR[t], opacity: 1, strokeWidth: 1.2 });
    }
  });
});

describe("TierMark", () => {
  it("draws the tier's paths, hidden from screen readers (the tier's name sits beside it)", () => {
    for (const t of names) {
      const html = renderToStaticMarkup(<TierMark tier={t} size={12} />);
      expect(html).toContain('aria-hidden="true"');
      expect(html).toContain('viewBox="0 0 20 20"');
      expect((html.match(/<path /g) ?? []).length).toBe(3);
      expect(html).toContain(TIER_MARK_COLOR[t]);
      expect(html).not.toContain("undefined");
    }
  });

  it("has no motion and no filter: it costs nothing to draw", () => {
    const html = renderToStaticMarkup(<TierMark tier="Mythic" size={24} />);
    expect(html).not.toMatch(/animate|filter|gradient|<text/i);
  });
});

describe("one source for the mark", () => {
  const files = (p: string): string[] => (statSync(p).isDirectory() ? readdirSync(p).flatMap((f) => files(join(p, f))) : /\.(tsx?|css)$/.test(p) ? [p] : []);
  const src = files("src");

  it("is drawn by the back picture from lib/tierMark, like the game", () => {
    expect(readFileSync("src/app/s/[text]/back/route.tsx", "utf8")).toContain("tierMarkPaths(tier)");
    expect(readFileSync("src/components/game/TierMark.tsx", "utf8")).toContain("tierMarkPaths(tier)");
  });

  it("leaves no copy of the old cube behind", () => {
    const cube = "M10 1 L18 6 L18 14 L10 19 L2 14 L2 6 Z";
    expect(src.filter((f) => readFileSync(f, "utf8").includes(cube))).toEqual([]);
    expect(src.filter((f) => readFileSync(f, "utf8").includes("--gem"))).toEqual([]);
  });
});
