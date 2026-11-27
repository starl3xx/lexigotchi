/**
 * The cards are matte (decisions.md #58). starl3xx, 2026-11-27: "the cards have *reflections* but
 * they shouldn't be super *shiny* -- the cards are matte finish in videos and all outputs and UI
 * locations... and the effect(s) we use to achieve these should be, yes, “Neo-Victorian engraving
 * illustration: ruled linework in ink, on paper.”"
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { existsSync } from "node:fs";
import { VEIL, loopPose, LOOP_SECONDS } from "@/components/cards/loop/loopRenderer";
import { PLATE_BORDER, PLATE_SEAL, backPlate, type PlateRank } from "@/lib/cardArt/plate";
import { CARD_H, CARD_W, svgDoc } from "@/lib/cardArt/engrave";
import { MATERIAL_GROUND, MATERIAL_LINE, collabPlate, materialPlate, type CardMaterial } from "@/components/cards/material";

const read = (p: string) => readFileSync(p, "utf8");

describe("the share video (part 1: \"14A is good\")", () => {
  const src = read("src/components/cards/loop/loopRenderer.ts");

  it("crosses the card with a veil, never with white added to it", () => {
    // a veil: what is left of the dark is scaled down, so no ink can pass the paper (white stays white, black lifts a tenth)
    expect(src).toContain("col = 1.0 - (1.0 - col) * (1.0 - g * ${VEIL.toFixed(2)});");
    expect(src).not.toMatch(/col \+= g/);
    expect(src).not.toMatch(/\* 0\.55/);
  });

  it("is faint: under a fifth of the glare it replaced", () => {
    expect(VEIL).toBeLessThanOrEqual(0.1);
    expect(VEIL / 0.55).toBeLessThan(0.2);
    // the veil at its strongest lifts black to a tenth grey, and leaves white as it is
    const lift = (c: number, g: number) => 1 - (1 - c) * (1 - g * VEIL);
    expect(lift(0, 1)).toBeCloseTo(VEIL, 5);
    expect(lift(1, 1)).toBe(1);
  });

  it("still crosses when it did: the light's path is unchanged", () => {
    expect(loopPose(0.9).glare).toBeCloseTo(1, 5);
    expect(loopPose(0).glare).toBeCloseTo(loopPose(LOOP_SECONDS).glare, 5);
  });
});

describe("a card's back is an engraved plate (part 2: \"13A dark plate is definitely the way to go\")", () => {
  const MATERIALS: CardMaterial[] = ["common", "uncommon", "rare", "legendary", "mythic"];
  const css = read("src/app/globals.css").replace(/\/\*[\s\S]*?\*\//g, "");
  const rule = (sel: string) => new RegExp(`(?:^|\\n)${sel.replace(/[.*+?^$(){}|[\]\\]/g, "\\$&")} \\{([^}]*)\\}`).exec(css)?.[1] ?? "";

  it.each(MATERIALS)("%s: paper and ink, drawn by the kit's rules", (m) => {
    const art = materialPlate(m);
    // no text, no filter, no styles or scripts, nothing fetched; every number finite
    expect(art).not.toMatch(/<text|<filter|<style|<script|<image|href="(?!#)/);
    expect(art).not.toMatch(/NaN|Infinity|undefined/);
    // an id is named once, and everything a drawing points at is its own
    const ids = [...art.matchAll(/ id="([\w-]+)"/g)].map((x) => x[1]);
    expect(new Set(ids).size).toBe(ids.length);
    for (const ref of art.matchAll(/(?:url\(#|href="#)([\w-]+)/g)) expect(ids, ref[1]).toContain(ref[1]);
    // its ground is the rarity's dark ink, flat: no material, no gloss
    expect(art.startsWith(`<defs>`)).toBe(true);
    expect(art).toContain(`<rect width="${CARD_W}" height="${CARD_H}" fill="${MATERIAL_GROUND[m]}"/>`);
    expect(art).not.toMatch(/radialGradient|feTurbulence|opacity="0\.0/);
    expect(svgDoc(art)).toContain("</svg>");
  });

  it("a rarity is told by its inks and its border, each plate keeping the last one's engraving", () => {
    const [common, uncommon, rare, legendary, mythic] = MATERIALS.map(materialPlate);
    const has = (art: string) => ({ lace: /stroke-width="1\.15"/.test(art), medallions: /id="c0"/.test(art), filigree: /stroke-linecap="round"/.test(art), blend: /id="iris"/.test(art) });
    expect(has(common)).toEqual({ lace: false, medallions: false, filigree: false, blend: false });
    expect(has(uncommon)).toEqual({ lace: true, medallions: true, filigree: false, blend: false });
    // Rare's own step was the ring round the seal, which went: its plate is Uncommon's engraving in its own inks
    expect(has(rare)).toEqual(has(uncommon));
    expect(rare).not.toBe(uncommon);
    // from Legendary the corners carry filigree where the medallions were
    expect(has(legendary)).toEqual({ lace: true, medallions: false, filigree: true, blend: false });
    expect(has(mythic)).toEqual({ lace: true, medallions: false, filigree: true, blend: true });
    // (the drawings' sizes say nothing: a corner of filigree is a shorter drawing than the lace it takes the place of)
  });

  it("the game's emblem is the same on every rarity: no plate draws anything round the seal", () => {
    // starl3xx, 2026-11-27: "I don't like the Lexigotchi emblem on the back getting more rings for
    // more rarity... I think that should look the same on all rarities, standard". The first plates
    // turned one, two, and three rings of lathe work round the seal for Rare, Legendary, and Mythic.
    const near = (x: number, y: number) => Math.hypot(x - PLATE_SEAL.cx, y - PLATE_SEAL.cy) < PLATE_SEAL.d / 2 + 60;
    for (const m of MATERIALS) {
      const art = materialPlate(m);
      // nothing is centred on the seal, or turned about it
      expect(art, m).not.toContain(`cx="${PLATE_SEAL.cx}"`);
      expect(art, m).not.toMatch(new RegExp(`rotate\\([\\d.]+ ${PLATE_SEAL.cx} `));
      expect(art, m).not.toMatch(/ id="w\d?"/);
      // and no path of the border's engraving wanders into the seal's place
      for (const d of art.matchAll(/ d="([^"]+)"/g)) for (const p of d[1].matchAll(/[ML](-?[\d.]+) (-?[\d.]+)/g)) expect(near(Number(p[1]), Number(p[2])), m).toBe(false);
    }
    // the seal's picture is one ink and one strength for every rarity, in the game and on the server
    const back = read("src/components/cards/CardBack.tsx");
    expect(back).toMatch(/className="cb-seal" style=\{\{ backgroundImage: [^}]*\}\}/);
    expect(css).not.toMatch(/\.m-(common|uncommon|rare|legendary|mythic|collab) \.cb-seal/);
    expect(read("src/app/s/[text]/back/route.tsx")).toContain("<img src={seal(look.line)} width={PLATE_SEAL.d} height={PLATE_SEAL.d}");
  });

  it("Mythic's spectrum is printed into its ink, so nothing in it can move", () => {
    const mythic = materialPlate("mythic");
    expect(mythic).toContain(`<stop offset="0" stop-color="${MATERIAL_LINE.mythic}"/><stop offset="0.5" stop-color="#ff9ad5"/><stop offset="1" stop-color="${MATERIAL_LINE.mythic}"/>`);
    expect(mythic).not.toMatch(/<animate|@keyframes/);
  });

  it("a line is never finer than about a pixel where it is shown: the ruled ground that smeared in the video stays out", () => {
    for (const m of MATERIALS) {
      const art = materialPlate(m);
      const weights = [...art.matchAll(/stroke-width="([\d.]+)"/g)].map((x) => Number(x[1]));
      // a phone's opened card is 346 px wide: 0.8 units is a quarter of a pixel there, and it is the finest line allowed (a hairline that reads as tone)
      expect(Math.min(...weights), m).toBeGreaterThanOrEqual(0.8);
      expect(art).toContain('<pattern id="rule" width="11" height="11" patternUnits="userSpaceOnUse"><line x1="0" y1="5.5" x2="11" y2="5.5"');
    }
  });

  it("the lettering and the seal are laid out by the plate's own measures, in the styles and on the server", () => {
    const pct = (n: number) => +((n / CARD_W) * 100).toFixed(3);
    // the seal stands in the plate's field: its width and its place are the plate's
    const seal = rule(".cb-seal");
    expect(seal).toContain(`width: ${pct(PLATE_SEAL.d)}cqw`);
    expect(seal).toContain(`right: ${pct(CARD_W - PLATE_SEAL.cx - PLATE_SEAL.d / 2)}cqw`);
    expect(PLATE_SEAL.cy).toBe(CARD_H / 2);
    expect(css).not.toMatch(/\.sc-small \.cb-seal/); // a thumbnail's seal stands where every other back's does
    // the lettering starts inside the field, at every size the styles name
    const field = pct(PLATE_BORDER.field);
    for (const m of css.matchAll(/\.cb-body \{[^}]*inset: ([\d.]+)cqw ([\d.]+)cqw ([\d.]+)cqw/g)) for (const v of m.slice(1, 4)) expect(Number(v)).toBeGreaterThan(field);
    expect([...css.matchAll(/\.cb-body \{[^}]*inset:/g)].length).toBeGreaterThanOrEqual(4);
    const route = read("src/app/s/[text]/back/route.tsx");
    expect(route).toContain("width={PLATE_SEAL.d} height={PLATE_SEAL.d} style={{ position: \"absolute\", left: PLATE_SEAL.cx - PLATE_SEAL.d / 2, top: PLATE_SEAL.cy - PLATE_SEAL.d / 2, opacity: 0.2 }}");
    expect(route).toContain("padding: `${7.5 * U}px ${7.3 * U}px ${8.3 * U}px`");
    expect(rule(".cb-body")).toContain("inset: 7.5cqw 7.3cqw 8.3cqw");
    expect(rule(".cb-seal")).toContain("opacity: 0.2");
  });

  it("the styles' grounds are the plates' grounds", () => {
    for (const m of MATERIALS) {
      expect(rule(`.m-${m}`), m).toContain(`--cb-base: ${MATERIAL_GROUND[m]}`);
      expect(rule(`.m-${m}`), m).toContain(`--cb-line: ${MATERIAL_LINE[m]}`);
      expect(rule(`.m-${m}`), m).not.toContain("gradient");
    }
  });

  it("nothing of the materials is left: no layers, no shader, no live drawing, no tilt prompt", () => {
    for (const gone of ["src/components/cards/live/LiveMaterial.tsx", "src/components/cards/live/liveSurface.ts", "src/components/cards/live/materialGlsl.ts", "src/components/cards/live/tilt.ts"]) expect(existsSync(gone), gone).toBe(false);
    expect(css).not.toMatch(/\.cb-brush|\.cb-glitter|\.cb-facets|\.cb-fire|\.cb-corner|\.cb-gl|\.cb-frame|--cb-mat/);
    const back = read("src/components/cards/CardBack.tsx");
    expect(back).not.toMatch(/LiveMaterial|drawLive|Facets|cb-brush|cb-glitter|cb-fire|cb-frame|Scroll\b/);
    expect(back).toContain('<div className="cb-mat" style={{ backgroundImage: plate }}>');
    expect(read("src/components/cards/SceneCard.tsx")).not.toMatch(/askForTilt|canDrawLive/);
    const shader = read("src/components/cards/loop/loopRenderer.ts");
    expect(shader).not.toMatch(/MATERIAL_GLSL|material\(|uMat|uLight/);
  });

  it("a collab set's plate is printed in its two colors, flat: the field in one, the border in the other", () => {
    const art = collabPlate({ base: "#102030", base2: "#302010", line: "#f0e0c0" });
    expect(art).toContain('<rect width="1200" height="675" fill="#102030"/>');
    expect(art).toMatch(/<path fill-rule="evenodd" fill="#302010" d="M0 0H1200V675H0Z/);
    expect(art).not.toMatch(/Gradient/);
    // Legendary's engraving (its filigree), in the set's one line ink
    expect(art).toMatch(/stroke-linecap="round"/);
    expect([...new Set([...art.matchAll(/(?:stroke|fill)="(#[0-9a-f]{6})"/g)].map((x) => x[1]))].sort()).toEqual(["#102030", "#302010", "#f0e0c0"]);
    // a rarity's own plate has one ground
    expect(backPlate(0 as PlateRank, { ground: "#111111", line: "#eeeeee", second: "#eeeeee" })).not.toContain("evenodd");
  });
});
