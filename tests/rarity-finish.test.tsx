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
import { HALO, T, haloPath, tileOuter } from "@/components/game/tileShapes";
import { LINK_OVERLAP } from "@/components/scenes/layout";
import { CARD_LOOK, showcaseCardPath, showcaseCardUrl } from "@/lib/showcase";

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

describe("the glow behind a Legendary or Mythic tile is an engraved halo", () => {
  const halo = (html: string) => /<path data-halo=""[^>]*>/.exec(html)?.[0];
  const rays = (d: string) => [...d.matchAll(/M (-?[\d.]+) (-?[\d.]+) L (-?[\d.]+) (-?[\d.]+)/g)].map((m) => m.slice(1).map(Number));
  /** How far a point is outside the tile's rounded edge. */
  const outside = (x: number, y: number) => {
    const dx = Math.max(T.x + T.r - x, 0, x - (T.x + T.w - T.r));
    const dy = Math.max(T.y + T.r - y, 0, y - (T.y + T.h - T.r));
    return Math.hypot(dx, dy) - T.r;
  };

  it("is line work in one ink: no paint that points at a gradient, no blur", () => {
    for (const tier of ["Legendary", "Mythic"] as const) {
      const html = renderToStaticMarkup(<TileCharacter char="a" tier={tier} still detail="full" size={160} />);
      const el = halo(html)!;
      expect(el).toContain('fill="none"');
      expect(el).toMatch(/stroke="#[0-9a-f]{6}"/);
      expect(el).toContain('stroke-linecap="round"');
      expect(html).not.toContain("rf-aura");
      expect(html).not.toMatch(/<filter|feGaussianBlur/);
    }
    // only the two richest rarities glow, and never a tile too small to show it
    for (const tier of [undefined, "Common", "Uncommon", "Rare"] as const) expect(halo(renderToStaticMarkup(<TileCharacter char="a" tier={tier} still detail="full" size={160} />))).toBeUndefined();
    expect(halo(renderToStaticMarkup(<TileCharacter char="a" tier="Mythic" still size={52} />))).toBeUndefined();
  });

  it("stands the same distance off whatever the tile wears, and never reaches the next letter's", () => {
    const cases: [boolean, number][] = [[false, 0], [false, 4], [true, 0], [true, 1], [true, 3], [true, 4], [true, 5]];
    for (const [upper, gild] of cases) {
      const outer = tileOuter(upper, gild);
      const all = rays(haloPath(outer));
      // 16 a side, and round each corner as many as keep that spacing: never fewer than the sides alone
      expect(all.length).toBeGreaterThanOrEqual(4 * HALO.side + 16);
      expect(all.length % 4).toBe(0);
      for (const [x0, y0, x1, y1] of all) {
        for (const v of [x0, y0, x1, y1]) expect(Number.isFinite(v)).toBe(true);
        expect(outside(x0, y0), `${upper ? "UPPER" : "lower"} stage ${gild}: starts just off what the tile wears`).toBeCloseTo(outer + HALO.gap, 1);
        const end = outside(x1, y1);
        expect(end).toBeGreaterThan(outer + HALO.gap + 1);
        expect(end).toBeLessThanOrEqual(HALO.reach + 0.02);
      }
    }
    // In a word the letters stand 240 units apart less the overlap that joins their hands, so two
    // tiles' edges are that less a tile's width apart: each halo keeps to its own half.
    const between = 240 * (1 - LINK_OVERLAP) - T.w;
    expect(2 * HALO.reach).toBeLessThanOrEqual(between);
    // and the widest gilding still leaves the halo room to be seen
    expect(HALO.reach - (tileOuter(true, 5) + HALO.gap)).toBeGreaterThan(4);
  });
});

describe("a word's mood on its finish", () => {
  const draw = (state: "idle" | "peckish" | "hungry") =>
    renderToStaticMarkup(<TileCharacter char="a" tier="Legendary" state={state} still detail="full" size={120} />);
  // the engraved halo behind a Legendary or Mythic tile (TileFinish, FinishAura)
  const auraOpacity = (html: string) => /<path data-halo=""[^>]*opacity="([\d.]+)"/.exec(html)?.[1];

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
    expect(showcaseCardUrl("CRAne", "fc", "spring")).not.toMatch(/saved/);
  });

  it("is asked for by a saved picture, which travels alone", () => {
    expect(showcaseCardPath("CRAne", "x", undefined, true)).toBe(`/s/CRAne/card?saved=1&v=${CARD_LOOK}`);
    expect(showcaseCardPath("CRAne", "fc", "spring", true)).toBe(`/s/CRAne/card?ratio=3x2&saved=1&v=${CARD_LOOK}&scene=spring`);
  });
});

describe("the moving light stays cheap", () => {
  const css = readFileSync(join(__dirname, "../src/app/globals.css"), "utf8");

  it("measures a travelling LAYER's move in the drawing's units, and a travelling shape's in px (a px on a layer is the screen's)", () => {
    // each rf- keyframes block, read to its closing brace
    const frames = new Map(
      css
        .split("@keyframes ")
        .slice(1)
        .filter((part) => part.startsWith("rf-"))
        .map((part) => {
          let depth = 0;
          let end = part.indexOf("{");
          do depth += part[end] === "{" ? 1 : part[end] === "}" ? -1 : 0;
          while (depth > 0 && ++end < part.length);
          return [part.slice(0, part.indexOf(" ")), part.slice(part.indexOf("{"), end + 1).replace(/\s+/g, " ")] as const;
        }),
    );
    expect([...frames.keys()].sort()).toEqual(["rf-catch", "rf-edge", "rf-facet", "rf-fire", "rf-glint", "rf-mote", "rf-pass", "rf-passing", "rf-rising"]);
    // the layers' two are the shapes' two, with each distance in units: nothing else may differ
    const inUnits = (body: string, axis: "x" | "y") => body.replace(/(-?\d+)px/g, (_, n) => `calc(var(--u${axis}) * ${n})`);
    expect(frames.get("rf-passing")).toBe(inUnits(frames.get("rf-pass")!, "x"));
    expect(frames.get("rf-rising")).toBe(inUnits(frames.get("rf-mote")!, "y"));
    expect(frames.get("rf-passing")).not.toMatch(/\dpx/);
    expect(frames.get("rf-rising")).not.toMatch(/\dpx/);
    // and they run for as long, with the same easing
    const rule = (cls: string) => new RegExp(`\\.rf-moment \\.${cls} \\{ animation: rf-[a-z]+ ([^;]+); \\}`).exec(css)![1];
    expect(rule("rf-passing")).toBe(rule("rf-pass"));
    expect(rule("rf-rising")).toBe(rule("rf-mote"));
  });

  it("lifts the layered light with the tile on a hover, by the same six units and at the same pace", () => {
    const rise = (cls: string) => new RegExp(`\\.tc-perks:hover:not\\(:active\\) \\.${cls} \\{ transform: translateY\\(([^;]+)\\); \\}`).exec(css)![1];
    expect(rise("tc-perk")).toBe("-6px");
    expect(rise("tc-perk-layer")).toBe("calc(var(--uy) * -6)");
    const pace = (cls: string) => new RegExp(`\\.${cls}[^{]*\\{\\s*transition: transform ([^;]+);\\s*transition-delay: ([^;]+);`).exec(css)!.slice(1);
    expect(pace("tc-perk-layer")).toEqual(pace("tc-perk"));
  });

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
