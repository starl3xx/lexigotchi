/**
 * A card standing on the page (globals.css, .card-stand; decisions.md #50): its block shadow, with
 * no line of the page between it and the card's ink edge.
 *
 * As the card's own box-shadow the shadow was cut away under the card, and at the cut a hairline
 * showed: two borders, one under the other. The shadow is now cast by a shape just inside the
 * card's edge, so its cut lies under the ink border.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { CARD_CORNER } from "@/lib/cardArt/looks";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const css = read("src/app/globals.css").replace(/\/\*[\s\S]*?\*\//g, "");
const rule = (selector: string) => {
  const at = css.indexOf(`${selector} {`);
  expect(at, selector).toBeGreaterThanOrEqual(0);
  return css.slice(at, css.indexOf("}", at));
};
const walk = (dir: string): string[] => readdirSync(join(process.cwd(), dir)).flatMap((f) => (statSync(join(process.cwd(), dir, f)).isDirectory() ? walk(`${dir}/${f}`) : f.endsWith(".tsx") ? [`${dir}/${f}`] : []));

describe("a card standing on the page", () => {
  const under = rule(".card-stand::before");
  const inside = Number(/inset:\s*([\d.]+)px/.exec(under)?.[1]);

  it("casts its block shadow from a shape inside the card's edge, spread back out to the edge", () => {
    expect(inside).toBeGreaterThan(0);
    // the same distance in, and back out: the shadow is the size it was
    expect(under).toContain(`box-shadow: var(--card-sx) var(--card-sy) 0 ${inside}px #1b1714`);
    // the card's corner, less that distance (the spread gives it back): the shadow's corner is the card's
    const [x, y] = [CARD_CORNER * 100, +(CARD_CORNER * 100 * (16 / 9)).toFixed(4)];
    expect(under).toContain(`border-radius: calc(${x}% - ${inside}px) / calc(${y}% - ${inside}px)`);
    // under the card's faces, and never in the way of a tap
    expect(under).toContain("z-index: -1");
    expect(under).toContain("pointer-events: none");
    expect(rule(".card-stand")).toContain("isolation: isolate");
    expect(rule(".card-stand")).toMatch(/--card-sx: 4px; --card-sy: 5px/);
  });

  it("keeps the shadow's cut under the ink edge: the distance inside is less than every edge that stands on it", () => {
    const edges = [/border:\s*(\d+)px solid #1b1714/.exec(rule(".sc-framed .sc-face"))?.[1], /border:\s*(\d+)px solid #1b1714/.exec(rule(".tt-blank"))?.[1]].map(Number);
    for (const w of edges) expect(inside).toBeLessThan(w);
    expect(Math.min(...edges)).toBe(3);
  });

  it("is on a box of its own: one that neither clips nor has the edge, or the shadow is cut off or under nothing", () => {
    const stand = rule(".card-stand");
    expect(stand).not.toMatch(/overflow|border(?!-radius)/);
    // Today's card no longer casts its own shadow
    expect(rule(".tt-card")).not.toContain("box-shadow");
    expect(rule(".tt-blank")).toContain("overflow: hidden");
    for (const file of [...walk("src/components"), ...walk("src/app")]) {
      const src = read(file);
      for (const m of src.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/g)) {
        const cls = m[1] ?? m[2];
        if (/\bcard-stand\b/.test(cls)) expect(cls, `${file}: a .card-stand must not clip or carry the edge`).not.toMatch(/overflow-hidden|\bborder-|\btt-blank\b/);
        // and no card takes a block shadow of its own beside its edge: that is the hairline
        if (/\bcard-corner\b/.test(cls)) expect(cls, `${file}: a card's block shadow goes on .card-stand`).not.toMatch(/shadow-\[/);
      }
    }
  });

  it("is what every card on the page stands on: Today's card and its blank, the celebrate sheet's, the share page's", () => {
    const today = read("src/components/game/TodayStage.tsx");
    expect(today).toContain('className="tt-card card-stand"');
    expect(today).toMatch(/<div className="tt-card card-stand">\s*<div className="tt-blank card-corner">/);
    expect(read("src/components/game/sheets/CelebrateSheet.tsx")).toMatch(/className="card-stand animate-drop w-full" style=\{\{ "--card-sx": "0px" \}/);
    expect(read("src/app/s/[text]/page.tsx")).toMatch(/className="card-stand w-full max-w-3xl" style=\{\{ "--card-sy": "4px" \}/);
  });
});
