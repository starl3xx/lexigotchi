/**
 * The game's two marks (lib/cardArt/logo, docs/brand): one source for the app icon, the exports,
 * and the seal. What must stay true of the drawings is held here.
 */
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { LOGO, LOGO_A, logoA, logoB } from "@/lib/cardArt/logo";
import { svgDoc } from "@/lib/cardArt/engrave";
import { sealInk } from "@/lib/cardArt/seal";
import { pupilOf } from "@/components/game/tileShapes";

const marks = [
  { name: "A", markup: logoA() },
  { name: "B", markup: logoB() },
  { name: "B round", markup: logoB({ round: true }) },
];

describe("the logos", () => {
  it("need no font and fetch nothing: the letter is its own outline", () => {
    for (const m of marks) {
      expect(m.markup, m.name).not.toMatch(/<(text|filter|script|style|foreignObject|image|animate)\b/i);
      expect(m.markup, m.name).not.toMatch(/font-family|https?:\/\//);
      expect(m.markup, m.name).not.toMatch(/NaN|Infinity|undefined|null/);
    }
  });

  it("name each gradient, pattern, and clip once, and use only names they made", () => {
    for (const m of marks) {
      const ids = [...m.markup.matchAll(/\bid="([^"]+)"/g)].map((x) => x[1]);
      expect(new Set(ids).size, m.name).toBe(ids.length);
      for (const u of [...m.markup.matchAll(/url\(#([^)]+)\)/g), ...m.markup.matchAll(/\bhref="#([^"]+)"/g)]) expect(ids, `${m.name} uses #${u[1]}`).toContain(u[1]);
    }
  });

  it("wear the letters' own eyes: tall ovals, one big pupil each with its pie cut, and no brows", () => {
    const e = LOGO_A.eyes;
    expect(e.ry).toBeGreaterThan(e.rx);
    const a = logoA();
    for (const side of [-1, 1] as const) {
      const p = pupilOf(e.cx + side * e.dx, e.y, e.rx, e.ry, side);
      expect(a).toContain(`<ellipse cx="${e.cx + side * e.dx}" cy="${e.y}" rx="${e.rx}" ry="${e.ry}" fill="#ffffff" stroke="${LOGO_A.ink}"`);
      expect(a).toContain(`<path d="${p.cut}" fill="#ffffff"/>`);
    }
    // the old icon's brows were two round-capped strokes: A has no stroked path at all now
    expect(a).not.toMatch(/<path[^>]*stroke-linecap/);
  });

  it("draw the letter as Söhne Fett's L: a stem and a foot, six corners", () => {
    for (const m of marks) {
      const letter = m.markup.match(/<path d="(M[\d. ]+(?:L[\d. ]+){5}Z)" fill="#111827"\/>/);
      expect(letter, m.name).not.toBeNull();
    }
  });

  it("B's round form is the circle alone, on a clear ground", () => {
    const round = logoB({ round: true });
    expect(round).toContain(`<clipPath id="disc"><circle cx="${LOGO / 2}" cy="${LOGO / 2}" r="${LOGO / 2}"/></clipPath>`);
    expect(round).toContain('<g clip-path="url(#disc)">');
    expect(logoB()).not.toContain("clip-path");
  });

  it("B's beads are circles, like the cards' (never zero-length dashes)", () => {
    expect(logoB()).not.toMatch(/stroke-dasharray="0[ ,"]/);
  });
});

describe("the icon's grain mask (docs/icon/make_grain.py) keeps to the logo's measures", () => {
  const py = readFileSync("docs/icon/make_grain.py", "utf8");
  const num = (re: RegExp) => [...(py.match(re) ?? []).slice(1)].map(Number);

  it("masks the same tile", () => {
    expect(num(/RING = \(([\d.]+) \* S, ([\d.]+) \* S, ([\d.]+) \* S, [\d.]+ \* S, ([\d.]+) \* S\)/)).toEqual([LOGO_A.ring.x, LOGO_A.ring.y, LOGO_A.ring.s, LOGO_A.ring.r]);
    expect(num(/FACE = \(([\d.]+) \* S, ([\d.]+) \* S, ([\d.]+) \* S, [\d.]+ \* S, ([\d.]+) \* S\)/)).toEqual([LOGO_A.face.x, LOGO_A.face.y, LOGO_A.face.s, LOGO_A.face.r]);
    expect(num(/DX, DY = (\d+) \* S, (\d+) \* S/)).toEqual([LOGO_A.edge.dx, LOGO_A.edge.dy]);
  });

  it("clears the same eyes, a little past their line, and no brows", () => {
    const e = LOGO_A.eyes;
    expect(num(/EYES = \(\(([\d.]+) \* S, ([\d.]+) \* S\), \(([\d.]+) \* S, ([\d.]+) \* S\)\)/)).toEqual([e.cx - e.dx, e.y, e.cx + e.dx, e.y]);
    const [rx, ry] = num(/EYE_RX, EYE_RY = ([\d.]+) \* S, ([\d.]+) \* S/);
    expect(rx).toBeGreaterThanOrEqual(e.rx + e.line / 2);
    expect(rx).toBeLessThanOrEqual(e.rx + e.line / 2 + 1);
    expect(ry).toBeGreaterThanOrEqual(e.ry + e.line / 2);
    expect(ry).toBeLessThanOrEqual(e.ry + e.line / 2 + 1);
    expect(py).not.toMatch(/brows\s*=/);
  });
});

describe("the files in docs/brand are the source's drawings", () => {
  // `npm run brand:art` writes them. If the source changes and the script isn't run, these fail.
  const file = (name: string) => readFileSync(`docs/brand/${name}`, "utf8").trimEnd();
  it("the four SVGs match what the source draws now", () => {
    expect(file("logo-a.svg")).toBe(svgDoc(logoA(), LOGO, LOGO));
    expect(file("logo-b.svg")).toBe(svgDoc(logoB(), LOGO, LOGO));
    expect(file("logo-b-round.svg")).toBe(svgDoc(logoB({ round: true }), LOGO, LOGO));
    expect(file("logo-b-one-ink.svg")).toBe(svgDoc(sealInk("#1b1714"), LOGO, LOGO));
  });
  it("every picture the README names is there", () => {
    for (const size of [1024, 512, 192, 180, 64, 32, 16]) for (const mark of ["a", "b"]) expect(existsSync(`docs/brand/logo-${mark}-${size}.png`), `logo-${mark}-${size}.png`).toBe(true);
    for (const size of [1024, 512, 256]) expect(existsSync(`docs/brand/logo-b-round-${size}.png`)).toBe(true);
  });
});
