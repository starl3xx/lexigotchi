/**
 * The game's seal (lib/cardArt/seal, decisions.md #35): pressed into a card's back in one ink.
 * What the owner asked of it is held here, because none of it shows in a type check.
 */
import { describe, it, expect } from "vitest";
import { SEAL, sealInk } from "@/lib/cardArt/seal";
import { svgDoc } from "@/lib/cardArt/engrave";
import { pupilOf } from "@/components/game/tileShapes";

const INK = "#e9b949";
const seal = sealInk(INK);

describe("the game's seal, in one ink", () => {
  it("is one ink, and plain shapes the server's renderer draws as they stand", () => {
    const colours = new Set([...seal.matchAll(/(?:fill|stroke)="(#[0-9a-fA-F]{3,6})"/g)].map((m) => m[1].toLowerCase()));
    // the ink, and the black and white of its masks
    expect([...colours].sort()).toEqual(["#000", INK, "#fff"].sort());
    expect(seal).not.toMatch(/<(text|filter|script|style|foreignObject|image|animate)\b/i);
    expect(seal).not.toMatch(/NaN|Infinity|undefined|null/);
    const ids = [...seal.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
    expect(new Set(ids).size).toBe(ids.length);
    for (const used of [...seal.matchAll(/url\(#([^)]+)\)/g), ...seal.matchAll(/\bhref="#([^"]+)"/g)]) expect(ids).toContain(used[1]);
    expect(svgDoc(seal, SEAL, SEAL)).toContain(`viewBox="0 0 ${SEAL} ${SEAL}"`);
  });

  it("runs no line through the eyes: everything behind them is cut away where they are", () => {
    // the rings, the tile's outlines, and the woven band are all inside the one masked group
    const masked = seal.slice(seal.indexOf('<g mask="url(#behind)">'), seal.indexOf("</g></g>") + 8);
    expect(masked.match(/<circle /g)).toHaveLength(3);
    expect(masked.match(/<rect /g)).toHaveLength(3);
    expect(masked).toContain("<use ");
    // and the mask blacks out both eyes, a little beyond their outlines
    const behind = seal.slice(seal.indexOf('<mask id="behind"'), seal.indexOf("</mask>"));
    const holes = [...behind.matchAll(/<ellipse cx="([\d.]+)" cy="([\d.]+)" rx="([\d.]+)" ry="([\d.]+)" fill="#000"\/>/g)];
    expect(holes).toHaveLength(2);
    for (const h of holes) {
      expect(Number(h[3])).toBeGreaterThan(38);
      expect(Number(h[4])).toBeGreaterThan(44);
    }
  });

  it("inverts the eyes for one ink: the eyeball is ink, the pupil is clear, and its pie cut is ink again", () => {
    for (const [id, side] of [["eyel", -1], ["eyer", 1]] as const) {
      const mask = seal.slice(seal.indexOf(`<mask id="${id}"`), seal.indexOf("</mask>", seal.indexOf(`<mask id="${id}"`)));
      const p = pupilOf(256 + side * 44, 116, 38, 44, side);
      // the pupil is taken out (black in the mask) ...
      expect(mask).toContain(`<ellipse cx="${p.cx}" cy="${p.cy}" rx="${p.rx}" ry="${p.ry}" fill="#000"/>`);
      // ... and its pie cut, the letters' own, is put back (white)
      expect(mask).toContain(`<path d="${p.cut}" fill="#fff"/>`);
      // the eye itself is one inked oval under that mask
      expect(seal).toMatch(new RegExp(`<ellipse cx="${256 + side * 44}" cy="116" rx="38" ry="44" fill="${INK}" stroke="${INK}" stroke-width="6" mask="url\\(#${id}\\)"/>`));
    }
  });

  it("is the same picture every time, in any ink", () => {
    expect(sealInk(INK)).toBe(seal);
    expect(sealInk("#7fb0ef")).toBe(seal.replaceAll(INK, "#7fb0ef"));
  });
});
