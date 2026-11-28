/**
 * Colour washes are flat tints (decisions.md #66; the design audit's 2D, starl3xx: "2C and 2D are
 * g2g"). A box in the interface is paper: it is one colour, never a soft fade from one colour to
 * another. A box that belongs to one of the game's meanings wears that hue, thinned into the
 * card's own colour (tailwind.config.ts, `wash`).
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import config from "../tailwind.config";
import { contrast, mixHex, SHOWS, READS } from "@/lib/contrast";

type Palette = Record<string, string | Record<string, string>>;
const colors = config.theme!.extend!.colors as Palette;
const hex = (name: string, shade = "DEFAULT") => {
  const c = colors[name];
  return typeof c === "string" ? c : c[shade];
};
const wash = colors.wash as Record<string, string>;

/** Every file a player's screen is drawn from: the components (never the operator console) and the pages. */
function playerFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (path === join("src", "components", "admin") || path === join("src", "app", "admin")) continue;
      playerFiles(path, out);
    } else if (/\.tsx?$/.test(name)) out.push(path);
  }
  return out;
}
const FILES = [...playerFiles(join("src", "components")), ...playerFiles(join("src", "app"))];

describe("colour washes are flat tints", () => {
  it("no box in the interface is a fade from one colour to another", () => {
    const fades: string[] = [];
    for (const file of FILES) {
      const src = readFileSync(file, "utf8");
      // Tailwind's fade classes: the direction, and the colour stops that only a fade reads
      for (const m of src.matchAll(/\bbg-gradient-to-[a-z]+\b|\b(?:from|via|to)-(?:card|paper|ink|gold|teal|candy|wash|tile|night|curtain|brass|lhaw|white|black|transparent)\b[\w/-]*/g)) fades.push(`${file}: ${m[0]}`);
    }
    expect(fades).toEqual([]);
  });

  it("each tint is its hue thinned into the card's own colour, at the share the notes give", () => {
    const share = { gold: 0.15, teal: 0.15, candy: 0.12 } as const;
    expect(Object.keys(wash).sort()).toEqual(Object.keys(share).sort());
    for (const [hue, t] of Object.entries(share)) expect(wash[hue], hue).toBe(mixHex(hex("card"), hex(hue), t));
  });

  it("a tint is a solid colour: nothing shows through it", () => {
    for (const c of Object.values(wash)) expect(c).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("what stands on a tint still reads: the display numbers, the coloured text, and the grey", () => {
    // the pots' big amounts: `gold.deep` is for large text only, and gold at 20% left it under 3:1
    expect(contrast(hex("gold", "deep"), wash.gold)).toBeGreaterThanOrEqual(SHOWS);
    expect(contrast(hex("gold", "deep"), mixHex(hex("card"), hex("gold"), 0.2))).toBeLessThan(SHOWS);
    // small coloured text takes the hue's ink shade, on its own tint
    for (const hue of ["gold", "teal", "candy"]) expect(contrast(hex(hue, "ink"), wash[hue]), hue).toBeGreaterThanOrEqual(READS);
    // ink, and ink at 70% (secondary text), on every tint
    for (const [hue, c] of Object.entries(wash)) {
      expect(contrast(hex("ink"), c), hue).toBeGreaterThanOrEqual(READS);
      expect(contrast(mixHex(c, hex("ink"), 0.7), c), hue).toBeGreaterThanOrEqual(READS);
    }
  });

  it("a tinted card takes the tint in place of the card's colour, never beside it", () => {
    const src = readFileSync(join("src", "components", "game", "primitives.tsx"), "utf8");
    expect(src).toContain('export const TINT: Record<Tint, string> = { gold: "bg-wash-gold", teal: "bg-wash-teal", candy: "bg-wash-candy" };');
    expect(src).toContain('<div className={`cel rounded-2xl ${tint ? TINT[tint] : "bg-card"} p-4 ${className}`}>{children}</div>');
    // and nowhere is a tint written beside another background colour
    for (const file of FILES) {
      for (const cls of readFileSync(file, "utf8").matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/g)) {
        const list = cls[1] ?? cls[2];
        if (/\bbg-wash-/.test(list)) expect(list, file).not.toMatch(/\bbg-(?:card|paper)\b/);
      }
    }
  });
});
