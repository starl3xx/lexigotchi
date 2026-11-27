/**
 * A card standing on the page (globals.css, .card-stand; decisions.md #50): its block shadow, with
 * no line of the page between it and the card's ink edge.
 *
 * The shadow was the card's own box-shadow, which is hollow under the card. When the card leaned
 * toward the pointer its edge pulled in, and the page showed between the edge and the shadow: "two
 * borders, one for the card and one underneath it" (starl3xx, twice). The shadow is now a solid
 * shape of its own under the card, and hollow only while the card turns over.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

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
  const turning = rule(".card-stand.is-flipping::before");

  it("has a solid shadow under it: the card's own shape, moved by the shadow's distance, filled with ink", () => {
    // the card's size and corner, moved right and down
    expect(under).toContain("inset: var(--card-sy) calc(-1 * var(--card-sx)) calc(-1 * var(--card-sy)) var(--card-sx)");
    expect(under).toContain("border-radius: var(--card-r)");
    // solid: a leaning card's edge uncovers the shadow, never the page through a hollow
    expect(under).toContain("background: #1b1714");
    expect(under).not.toContain("box-shadow");
    expect(under).not.toMatch(/clip-path|mask/);
    // under the card's faces, and never in the way of a tap
    expect(under).toContain("z-index: -1");
    expect(under).toContain("pointer-events: none");
    expect(rule(".card-stand")).toContain("isolation: isolate");
    expect(rule(".card-stand")).toMatch(/--card-sx: 4px; --card-sy: 5px/);
  });

  it("is hollow only while the card turns over, cut away a whole number of pixels inside the ink edge", () => {
    expect(turning).toContain("background: none");
    const inside = Number(/inset:\s*([\d.]+)px/.exec(turning)?.[1]);
    // whole pixels (a hollow 1.5 px in put the shadow half a pixel off the card in Chromium)
    expect(Number.isInteger(inside)).toBe(true);
    expect(inside).toBeGreaterThan(0);
    // the same distance in, and back out: the hollow shadow has the solid one's outline
    expect(turning).toContain(`box-shadow: var(--card-sx) var(--card-sy) 0 ${inside}px #1b1714`);
    expect(turning).toContain(`border-radius: calc(2.6% - ${inside}px) / calc(4.6222% - ${inside}px)`);
    // and its cut stays under every ink edge that stands on it
    const edges = [/border:\s*(\d+)px solid #1b1714/.exec(rule(".sc-framed .sc-face"))?.[1], /border:\s*(\d+)px solid #1b1714/.exec(rule(".tt-blank"))?.[1]].map(Number);
    for (const w of edges) expect(inside).toBeLessThan(w);
  });

  it("is turning, lit, and standing on one element, and a card that is turning does not lean", () => {
    const card = read("src/components/cards/SceneCard.tsx");
    // the root carries the turn's class and the caller's classes (.card-stand) together
    expect(card).toMatch(/className=\{`sc \$\{back \? "is-back" : ""\} \$\{turning \? "is-flipping" : ""\}[^`]*\$\{className\}`\}/);
    // the lean is live only while the card is not turning: the hollow shadow never meets a leaning edge
    expect(card).toMatch(/useCardLight\(\{[^}]*active: [^}]*!turning[^}]*\}\)/);
    // the faces are opaque to their edge: the solid shadow is under all of the card
    expect(rule(".sc-face")).toContain("background: #1b1714");
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
        // and no card takes a block shadow of its own beside its edge: that is the hollow one
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
