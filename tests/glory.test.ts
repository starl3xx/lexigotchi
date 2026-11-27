/**
 * The rays behind a word when its ascension lands (lib/cardArt/glory; decisions.md #48, part 8):
 * an engraved picture in one ink, turned as a whole by the sheet's styles. It was a flat gold fan.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { GLORY, GLORY_CSS, GLORY_GOLD, gloryDoc } from "@/lib/cardArt/glory";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const css = read("src/app/globals.css").replace(/\/\*[\s\S]*?\*\//g, "");
const rule = (selector: string) => {
  const at = css.indexOf(`${selector} {`);
  expect(at, selector).toBeGreaterThanOrEqual(0);
  return css.slice(at, css.indexOf("}", at));
};

describe("the glory behind an ascended word", () => {
  const doc = gloryDoc("#123456");

  it("is line work in one ink: no text, no filter, no gradient, nothing fetched", () => {
    expect(doc).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 1000 1000">/);
    expect(doc).not.toMatch(/<text|<filter|<image|Gradient|href=|url\(/);
    const paints = new Set([...doc.matchAll(/(?:fill|stroke)="([^"]+)"/g)].map((m) => m[1]));
    expect([...paints].sort()).toEqual(["#123456", "none"]);
    // every number in a path is a plain one, to one decimal at most
    const paths = [...doc.matchAll(/ d="([^"]+)"/g)].map((m) => m[1]).join(" ");
    const numbers = [...paths.matchAll(/-?\d+(?:\.\d+)?(?:e-?\d+)?/g)].map((m) => m[0]);
    expect(numbers.length).toBeGreaterThan(500);
    for (const n of numbers) expect(n, n).toMatch(/^-?\d+(\.\d)?$/);
    expect(doc).not.toMatch(/NaN|Infinity/);
  });

  it("is fine rays of three lengths between twelve wedges, from behind the word to the picture's edge", () => {
    const [fine, wedges] = [...doc.matchAll(/<path d="([^"]+)"/g)].map((m) => m[1]);
    const c = GLORY.size / 2;
    const rays = [...fine.matchAll(/M(-?[\d.]+) (-?[\d.]+)L(-?[\d.]+) (-?[\d.]+)/g)].map((m) => m.slice(1).map(Number));
    expect(rays).toHaveLength(GLORY.rays - GLORY.wedges);
    const lengths = new Set(rays.map(([, , x, y]) => Math.round(Math.hypot(x - c, y - c) / 10) * 10));
    expect([...lengths].sort()).toEqual([370, 420, 470]);
    for (const [x, y] of rays) expect(Math.hypot(x - c, y - c)).toBeCloseTo(GLORY.inner, 0);
    // the wedges reach the edge; the rays stop short of it, so no ray is cut by the box
    expect([...wedges.matchAll(/M/g)]).toHaveLength(GLORY.wedges);
    expect(Math.max(...lengths)).toBeLessThan(c);
    // its middle is small enough to hide behind one letter of a five-letter word (the picture is
    // 130% of the row's width, and a letter is about a sixth of the row)
    expect((GLORY.inner / GLORY.size) * 1.3).toBeLessThan(1 / 6 / 2 + 0.01);
  });

  it("the sheet gives it to the styles as one value, in the game's gold", () => {
    expect(GLORY_GOLD).toBe("#f0a617");
    expect(GLORY_CSS.startsWith('url("data:image/svg+xml,')).toBe(true);
    expect(decodeURIComponent(GLORY_CSS)).toContain(`stroke="${GLORY_GOLD}"`);
    expect(read("src/components/game/sheets/AscendSheet.tsx")).toContain('style={{ "--asc-glory": GLORY_CSS } as CSSProperties}');
  });

  it("is the light behind the landing page's big letter too, in place of a soft glow", () => {
    const landing = read("src/components/landing/LandingPage.tsx");
    expect(landing).toContain("background: `${GLORY_CSS} center / contain no-repeat`");
    expect(landing).not.toContain("radial-gradient(circle, rgba(240,166,23");
  });

  it("the styles draw the picture and turn the whole element: no flat fan, and the Holographic's colours show through the same lines", () => {
    const gold = rule(".asc-rays::before");
    expect(gold).toContain("background: var(--asc-glory) center / 100% 100% no-repeat");
    expect(gold).not.toContain("conic-gradient");
    const holo = rule(".asc-rays-holo::before");
    expect(holo).toContain("mask: var(--asc-glory) center / 100% 100% no-repeat");
    expect(holo).toContain("-webkit-mask: var(--asc-glory) center / 100% 100% no-repeat");
    expect(css).not.toContain("repeating-conic-gradient(rgb(240 166 23");
    // the turn is on the one element that holds the picture, and the fade on its still box
    expect(css).toMatch(/\.asc-rays::before \{ animation: asc-rays-turn 16s linear infinite; \}/);
    expect(css).toMatch(/@keyframes asc-rays-turn \{ to \{ transform: rotate\(360deg\); \} \}/);
  });
});
