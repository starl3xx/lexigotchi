/**
 * Rarity finishes (decisions.md #23): each tier's material on the letter tiles, the share card's
 * still of it, and the rule that keeps the moving light cheap.
 */
import { readFileSync } from "fs";
import { join } from "path";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it, expect, vi } from "vitest";
import { TIERS, type Tier } from "@/lib/economy";
import { FINISH, finishFor, mixHex } from "@/lib/rarityFinish";
import { OgTile } from "@/app/_og/tile";
import { MOMENT_END_S } from "@/components/game/TileFinish";
import { TileCharacter } from "@/components/game/TileCharacter";
import { showcaseCardPath, showcaseCardUrl } from "@/lib/showcase";

describe("the finishes", () => {
  it("dress every tier above Common, each in its own material", () => {
    expect(finishFor("Common")).toBeUndefined();
    expect(finishFor(undefined)).toBeUndefined();
    expect(finishFor("Uncommon")?.material).toBe("satin");
    expect(finishFor("Rare")?.material).toBe("foil");
    expect(finishFor("Legendary")?.material).toBe("gold");
    expect(finishFor("Mythic")?.material).toBe("amethyst");
    // the tier list and the finish list agree
    expect(Object.keys(FINISH).sort()).toEqual(TIERS.map((t) => t.name).filter((n) => n !== "Common").sort());
  });

  it("stay translucent, so the tile's own face shows through", () => {
    for (const f of Object.values(FINISH)) {
      expect(f!.alpha).toBeGreaterThan(0.3);
      expect(f!.alpha).toBeLessThan(0.8);
    }
  });

  it("move faster the rarer they are", () => {
    const periods = (["Uncommon", "Rare", "Legendary", "Mythic"] as Tier[]).map((t) => finishFor(t)!.period);
    expect([...periods].sort((a, b) => b - a)).toEqual(periods);
  });

  it("mix colors by a fraction", () => {
    expect(mixHex("#000000", "#ffffff", 0)).toBe("#000000");
    expect(mixHex("#000000", "#ffffff", 1)).toBe("#ffffff");
    expect(mixHex("#000000", "#ffffff", 0.5)).toBe("#808080");
  });
});

/** Every element under the tile's <svg>s: what Satori serializes as text. */
function svgsOf(node: ReactNode, out: ReactElement[] = []): ReactElement[] {
  if (Array.isArray(node)) node.forEach((n) => svgsOf(n, out));
  else if (isValidElement(node)) {
    if (node.type === "svg") out.push(node);
    else svgsOf((node.props as { children?: ReactNode }).children, out);
  }
  return out;
}
function walk(node: ReactNode, visit: (el: ReactElement) => void) {
  if (Array.isArray(node)) return node.forEach((n) => walk(n, visit));
  if (!isValidElement(node)) return;
  visit(node);
  walk((node.props as { children?: ReactNode }).children, visit);
}

describe("the share card's still keeps Satori's rules", () => {
  const cases = TIERS.flatMap((t) => [false, true].flatMap((upper) => [0, 1].map((index) => ({ tier: t.name, upper, index }))));

  it.each(cases.map((c) => [`${c.tier} ${c.upper ? "UPPER" : "lower"} #${c.index}`, c] as const))(
    "%s: plain SVG elements, no attribute undefined, no class, no text",
    (_, c) => {
      const tile = OgTile({ char: "Q", upper: c.upper, w: 160, tier: c.tier, index: c.index, uid: `t${c.index}` });
      const bad: string[] = [];
      for (const svg of svgsOf(tile)) {
        walk((svg.props as { children?: ReactNode }).children, (e) => {
          if (typeof e.type !== "string") bad.push(`component ${String((e.type as { name?: string }).name ?? e.type)}`);
          for (const [k, v] of Object.entries(e.props as Record<string, unknown>)) {
            if (k !== "children" && v === undefined) bad.push(`${String(e.type)}.${k} undefined`);
            if (k === "className" || k === "style") bad.push(`${String(e.type)}.${k}`);
          }
          if (e.type === "text") bad.push("text");
        });
      }
      expect(bad).toEqual([]);
    },
  );

  it("draws every tier without a React warning, its ids named after the tile", () => {
    const warn = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      for (const t of TIERS) {
        const html = renderToStaticMarkup(OgTile({ char: "Q", upper: true, tier: t.name, uid: "z9" }));
        const ids = [...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]);
        expect(ids.every((x) => x.endsWith("-z9"))).toBe(true);
        if (t.name !== "Common") expect(ids.length).toBeGreaterThan(0);
      }
      expect(warn.mock.calls.map((c) => String(c[0]).slice(0, 120))).toEqual([]);
    } finally {
      warn.mockRestore();
    }
  });

  it("draws a Common tile with no finish at all", () => {
    const html = renderToStaticMarkup(OgTile({ char: "Q", tier: "Common" }));
    expect(html).not.toMatch(/rf-/);
  });
});

describe("a tile's finish definitions", () => {
  // Every url(#rf-…) a tile uses must be one it defined: FinishDefs draws only what the tile needs.
  const cases = TIERS.flatMap((t) =>
    (["full", "bust", "tile"] as const).flatMap((detail) =>
      (["idle", "peckish", "hungry"] as const).flatMap((state) => [false, true].map((still) => ({ tier: t.name, detail, state, still }))),
    ),
  );
  it.each(cases.map((c) => [`${c.tier} ${c.detail} ${c.state}${c.still ? " still" : ""}`, c] as const))("%s: no reference to a missing definition", (_, c) => {
    const html = renderToStaticMarkup(<TileCharacter char="q" upper tier={c.tier} state={c.state} still={c.still} detail={c.detail} size={c.detail === "tile" ? 30 : 120} />);
    const defined = new Set([...html.matchAll(/id="(rf-[^"]+)"/g)].map((m) => m[1]));
    const used = [...html.matchAll(/url\(#(rf-[^)]+)\)/g)].map((m) => m[1]);
    expect(used.filter((u) => !defined.has(u))).toEqual([]);
  });

  it("draws far fewer definitions for a small still tile than for a moving one", () => {
    const count = (html: string) => [...html.matchAll(/id="rf-/g)].length;
    const small = count(renderToStaticMarkup(<TileCharacter char="q" tier="Legendary" detail="tile" size={30} still />));
    const big = count(renderToStaticMarkup(<TileCharacter char="q" tier="Legendary" detail="full" size={120} />));
    expect(small).toBeLessThanOrEqual(4); // the face, its clip, the soft highlight, the hot spot
    expect(big).toBeGreaterThan(small);
  });
});

describe("a word's mood on its finish", () => {
  const draw = (state: "idle" | "peckish" | "hungry") =>
    renderToStaticMarkup(<TileCharacter char="a" tier="Legendary" state={state} still detail="full" size={120} />);
  const auraOpacity = (html: string) => /<rect[^>]*fill="url\(#rf-aura-[^"]*\)"[^>]*opacity="([\d.]+)"/.exec(html)?.[1];

  it("dims a peckish word's shine even when it's drawn still (a list, reduced motion)", () => {
    expect(auraOpacity(draw("idle"))).toBe("0.75");
    expect(auraOpacity(draw("peckish"))).toBe("0.4");
  });

  it("takes a hungry word's shine away", () => {
    expect(auraOpacity(draw("hungry"))).toBeUndefined();
  });
});

describe("the game's name on a share picture", () => {
  it("is left off a link card (X and Farcaster name the game around it)", () => {
    expect(showcaseCardUrl("CRAne")).not.toMatch(/saved/);
    expect(showcaseCardUrl("CRAne", "fc", "fall")).not.toMatch(/saved/);
  });

  it("is asked for by a saved picture, which travels alone", () => {
    expect(showcaseCardPath("CRAne", "x", undefined, true)).toBe("/s/CRAne/card?saved=1");
    expect(showcaseCardPath("CRAne", "fc", "fall", true)).toBe("/s/CRAne/card?ratio=3x2&saved=1&scene=fall");
  });
});

describe("the moving light stays cheap", () => {
  const css = readFileSync(join(__dirname, "../src/app/globals.css"), "utf8");
  const finishRules = css.split("\n").filter((l) => /\.rf-[a-z]+\s*\{[^}]*animation\s*:/.test(l));

  it("moves only in a moment, never in a loop (looping it on every tile filled a slow phone's main thread)", () => {
    expect(finishRules.length).toBeGreaterThan(0);
    for (const rule of finishRules) {
      expect(rule).toMatch(/^\s*\.rf-moment \.rf-/);
      expect(rule).not.toMatch(/infinite/);
    }
  });

  it("keeps a moment on long enough for its last effect, and rests before the next", () => {
    // no effect runs longer than a mote's 3 s rise, which MOMENT_END_S counts from its last start
    const durations = finishRules.map((r) => Number(/animation:\s*rf-[a-z]+\s+([\d.]+)s/.exec(r)![1]));
    expect(Math.max(...durations)).toBeLessThanOrEqual(3);
    expect(MOMENT_END_S).toBeGreaterThan(3);
    // the fastest tier's period leaves a rest after each moment
    const fastest = Math.min(...Object.values(FINISH).map((f) => f!.period));
    expect(MOMENT_END_S).toBeLessThan(fastest - 1);
  });

  it("never loops anything on a card: the back holds still, and only the turn moves", () => {
    const at = css.indexOf("Scene cards (components/cards/SceneCard.tsx)");
    expect(at).toBeGreaterThan(0);
    expect(css.slice(at)).not.toMatch(/infinite/);
  });

  it("never animates a stroke's dash (it re-strokes the outline every frame)", () => {
    const keyframes = css.slice(css.indexOf("Rarity finishes on the letter tiles"));
    expect(keyframes).not.toMatch(/stroke-dashoffset/);
  });
});
