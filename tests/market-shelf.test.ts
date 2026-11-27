/**
 * The Market's letter shelf (globals.css, .mk-rule; decisions.md #50, part 3): the letters stand on
 * a fine double rule, drawn ONCE a row. The owner chose it over a plank ("yes to 2C").
 *
 * A line made of one piece a slot has joins. Pieces a pixel wider than their slots showed a darker
 * tick at every join at pixel ratios 1.25 and 1.5 (thin lines drawn twice), and pieces exactly a
 * slot wide left gaps there in WebKit. So the first slot of each row draws the whole row's line,
 * and the count of slots in a row is written in two places that must agree: the grid's columns
 * (LettersBoard) and the rule's width here.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const css = read("src/app/globals.css").replace(/\/\*[\s\S]*?\*\//g, "");
const board = read("src/components/game/market/LettersBoard.tsx");
const rule = (selector: string, from = 0) => {
  const at = css.indexOf(`${selector} {`, from);
  expect(at, selector).toBeGreaterThanOrEqual(0);
  return css.slice(at, css.indexOf("}", at));
};

describe("the Market's letter shelf", () => {
  it("stands the letters on a rule, and the plank is gone", () => {
    expect(css).not.toContain(".mk-plank");
    expect(board).not.toContain("mk-plank");
    // one under each letter, and one under each of the two places that fill a phone's last row
    expect(board.match(/className="mk-rule"/g)).toHaveLength(2);
  });

  it("draws one line a row: as many slots wide as the grid has columns, on a phone and from md", () => {
    const phone = Number(/grid-cols-(\d+)/.exec(board)?.[1]);
    const wide = Number(/md:grid-cols-\[repeat\((\d+),/.exec(board)?.[1]);
    expect([phone, wide]).toEqual([7, 13]);
    // a phone: the first slot of every row of 7 draws 7 slots' worth
    const first = rule(`.mk-slot:nth-child(${phone}n + 1) .mk-rule`);
    expect(first).toContain(`width: ${phone}00%`);
    expect(first).toContain("background: var(--mk-lines)");
    // from md: that slot goes back to its own width and draws nothing, and every 13th draws 13
    const md = css.indexOf("@media (min-width: 768px)", css.indexOf(".mk-rule {"));
    expect(md).toBeGreaterThan(0);
    const undone = rule(`.mk-slot:nth-child(${phone}n + 1) .mk-rule`, md);
    expect(undone).toContain("width: 100%");
    expect(undone).toContain("background: none");
    const firstWide = rule(`.mk-slot:nth-child(${wide}n + 1) .mk-rule`, md);
    expect(firstWide).toContain(`width: ${wide}00%`);
    expect(firstWide).toContain("background: var(--mk-lines)");
    // 26 letters and the two filling places make whole rows of 7; 26 make whole rows of 13
    expect((26 + 2) % phone).toBe(0);
    expect(26 % wide).toBe(0);
  });

  it("lets a tap on the line through to the letter above it, and starts at its own slot's left edge", () => {
    const base = rule(".mk-rule");
    // the row's line is the FIRST letter's child and lies over every slot in the row
    expect(base).toContain("pointer-events: none");
    // the slot centres its children: a line 7 slots wide must not be centred on the first slot
    expect(base).toContain("align-self: flex-start");
    expect(rule(".mk-slot")).toContain("align-items: center");
  });

  it("is two solid lines: ink, and a fainter one under it", () => {
    const base = rule(".mk-rule");
    const lines = /--mk-lines:([\s\S]*?);/.exec(base)?.[1] ?? "";
    expect(lines.match(/linear-gradient\(/g)).toHaveLength(2);
    // solid colours only: nothing see-through, which would show the page's dots through the line
    expect(lines).not.toMatch(/rgba?\(|\/\s*0?\.\d|transparent|opacity/);
    expect(lines).toMatch(/0 0 \/ 100% 1\.5px no-repeat/);
    expect(lines).toMatch(/0 100% \/ 100% 1px no-repeat/);
  });
});
