/**
 * What is around a card and a letter in the pictures is drawn like the cards (decisions.md #48,
 * part 9): the rack on a card's back, the table a card lies on, and the shadow under the video's
 * card. Each was a flat tone or a soft blur. (The halo on the server's own letter came with the
 * game's, in part 8: tests/rarity-finish.test.tsx.)
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { rackPaths } from "@/lib/cardArt/rack";
import { TABLE, tableDoc, tableImage } from "@/lib/cardArt/table";
import { SHADOW_INK, SHADOW_ROWS, SHADOW_WEIGHT } from "@/components/cards/loop/loopRenderer";
import { CARD_LOOK } from "@/lib/showcase";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const css = read("src/app/globals.css").replace(/\/\*[\s\S]*?\*\//g, "");
const rule = (selector: string) => {
  const at = css.indexOf(`${selector} {`);
  expect(at, selector).toBeGreaterThanOrEqual(0);
  return css.slice(at, css.indexOf("}", at));
};
const numbersOf = (d: string) => [...d.matchAll(/-?\d+(?:\.\d+)?/g)].map((m) => Number(m[0]));

describe("the rack on a card's back", () => {
  it("is one set of shapes, in whatever box is asked for", () => {
    const own = rackPaths();
    const big = rackPaths(430, 48);
    for (const key of ["top", "topRules", "front", "frontRules", "edge"] as const) {
      const a = numbersOf(own[key]);
      const b = numbersOf(big[key]);
      expect(b.length, key).toBe(a.length);
      // every point is the same point, scaled (x by 4.3, y by 2.4), to the path's one decimal
      a.forEach((v, i) => expect(Math.abs(b[i] - v * (i % 2 === 0 ? 4.3 : 2.4)), `${key}[${i}]`).toBeLessThanOrEqual(0.25));
    }
    // the top face is ruled closer toward the back, the way a surface that runs away is ruled
    const ys = [...own.topRules.matchAll(/M[\d.]+ ([\d.]+)L/g)].map((m) => Number(m[1]));
    expect(ys.length).toBeGreaterThanOrEqual(4);
    const gaps = ys.slice(1).map((y, i) => y - ys[i]);
    for (let i = 1; i < gaps.length; i++) expect(gaps[i]).toBeGreaterThan(gaps[i - 1]);
    // the front is ruled evenly, and closer than the top's nearest gap: it reads darker
    const fy = [...own.frontRules.matchAll(/M[\d.]+ ([\d.]+)L/g)].map((m) => Number(m[1]));
    expect(Math.max(...fy.slice(1).map((y, i) => y - fy[i]))).toBeLessThan(gaps[gaps.length - 1]);
  });

  it("is line work in the material's line colour in the game, every line one weight however it is stretched, with no soft shadow", () => {
    expect(rule(".cb-rack path")).toContain("vector-effect: non-scaling-stroke");
    for (const sel of [".rk-top", ".rk-rule", ".rk-front", ".rk-edge"]) expect(rule(sel), sel).toContain("stroke: var(--cb-line)");
    expect(rule(".cb-rack-front")).not.toContain("drop-shadow");
    // nor under a tile that stands on it: the rack's ruling is its ground
    expect(rule(".cb-tile")).not.toContain("drop-shadow");
    expect(css).not.toContain("--rk-top");
    expect(css).not.toMatch(/\.rk-(far|groove|lip)\b/);
    const back = read("src/components/cards/CardBack.tsx");
    expect(back).toContain("const RACK = rackPaths();");
    for (const part of ["RACK.top", "RACK.topRules", "RACK.front", "RACK.frontRules", "RACK.edge"]) expect(back, part).toContain(`d={${part}}`);
  });

  it("is the same shapes on the server's picture of the back, in that picture's own pixels", () => {
    const route = read("src/app/s/[text]/back/route.tsx");
    expect(route).toContain("const RACK = rackPaths(RACK_W, RACK_H);");
    for (const part of ["RACK.top", "RACK.topRules", "RACK.front", "RACK.frontRules", "RACK.edge"]) expect(route, part).toContain(`d={${part}}`);
    expect(route).not.toContain("rackTop");
    expect(route).not.toContain('preserveAspectRatio="none"');
  });
});

describe("the table a card lies on", () => {
  it("is engraved: a ruled ground, rays, and woven bands in one ink on the dark, with no gradient, filter, or text", () => {
    const doc = tableDoc(1200, 630);
    expect(doc).toContain(`fill="${TABLE.ground}"`);
    expect(doc).not.toMatch(/Gradient|<filter|<text|<image/);
    const inks = new Set([...doc.matchAll(/(?:fill|stroke)="(#[0-9a-f]{6})"/g)].map((m) => m[1]));
    expect([...inks].sort()).toEqual([TABLE.ground, TABLE.line].sort());
    expect(doc).not.toMatch(/NaN|Infinity/);
    // made once for a size, and an address a server picture's <img> takes
    expect(tableImage(1200, 630)).toBe(tableImage(1200, 630));
    expect(tableImage(1200, 630).startsWith("data:image/svg+xml;base64,")).toBe(true);
    expect(tableImage(1200, 800)).not.toBe(tableImage(1200, 630));
  });

  it("is under the card in every picture that has a table, in place of the soft pool of light", () => {
    for (const p of ["src/app/s/[text]/card/route.tsx", "src/app/e/[token]/card/route.tsx"]) {
      const route = read(p);
      expect(route, p).toMatch(/<img src=\{tableImage\(\w+, H\)\}/);
      expect(route, p).not.toContain("radial-gradient");
    }
  });
});

describe("the shadow under the video's card", () => {
  it("is ruled lines as heavy as the shadow is dark, not a soft blot, and asks no derivative of the device", () => {
    const src = read("src/components/cards/loop/loopRenderer.ts");
    const frag = src.slice(src.indexOf("const SHADOW_FRAG"), src.indexOf("`;", src.indexOf("const SHADOW_FRAG")));
    expect(frag).toContain("fract(vUv.y * ${SHADOW_ROWS}.0)");
    expect(frag).toContain("float w = tone * ");
    expect(frag).not.toMatch(/fwidth|dFdx|dFdy/);
    expect(SHADOW_ROWS).toBeGreaterThanOrEqual(8);
    expect(SHADOW_ROWS).toBeLessThanOrEqual(20);
  });

  // The owner, 2026-11-27, of 0.5 and 0.7: "the shadow on the card video is way too dark".
  it("is faint: a few light lines, never a dark band", () => {
    const src = read("src/components/cards/loop/loopRenderer.ts");
    const frag = src.slice(src.indexOf("const SHADOW_FRAG"), src.indexOf("`;", src.indexOf("const SHADOW_FRAG")));
    // the shader draws with the two numbers, and with nothing beside them that would darken it again
    expect(frag).toContain("float w = tone * ${SHADOW_WEIGHT};");
    expect(frag).toContain("line * ${SHADOW_INK} * smoothstep(");
    expect(SHADOW_INK).toBeGreaterThan(0);
    expect(SHADOW_INK).toBeLessThanOrEqual(0.2);
    expect(SHADOW_WEIGHT).toBeGreaterThan(0);
    expect(SHADOW_WEIGHT).toBeLessThanOrEqual(0.5);
  });
});

describe("the look number", () => {
  it("was raised with these pictures, so no kept copy of an old one is shown", () => {
    expect(CARD_LOOK).toBe(14);
  });
});
