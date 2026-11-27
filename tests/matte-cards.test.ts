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
import { LIGHT, LIGHT_INK, lightBand, lightLines, type LightInk } from "@/lib/cardArt/light";
import { DARK_SCENES, PALE_SCENES } from "@/lib/cardArt/scenes";
import { SCENES } from "@/lib/scenes";

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

describe("the front's light is a ruled band (part 3: \"I love the ruled band, but it's too strong rn... needs to be more subtle\")", () => {
  const INKS: LightInk[] = ["white", "warm", "spectrum"];
  const css = read("src/app/globals.css").replace(/\/\*[\s\S]*?\*\//g, "");
  const rule = (sel: string) => new RegExp(`(?:^|\\n)${sel.replace(/[.*+?^$(){}|[\]\\>]/g, "\\$&")} \\{([^}]*)\\}`).exec(css)?.[1] ?? "";
  const frame = read("src/components/scenes/SceneFrame.tsx");

  it.each(INKS)("its lines are a picture in %s ink, drawn by the kit's rules, and nothing in it moves", (ink) => {
    const art = lightLines(ink);
    expect(art).not.toMatch(/<text|<filter|<style|<script|<image|<animate|href="(?!#)/);
    expect(art).not.toMatch(/NaN|Infinity|undefined/);
    const ids = [...art.matchAll(/ id="([\w-]+)"/g)].map((x) => x[1]);
    expect(new Set(ids).size).toBe(ids.length);
    for (const ref of art.matchAll(/url\(#([\w-]+)\)/g)) expect(ids, ref[1]).toContain(ref[1]);
    // fine lines, leaning: the measures the owner saw
    expect(art).toContain(`<pattern id="r" width="${LIGHT.pitch}" height="${LIGHT.pitch}" patternUnits="userSpaceOnUse" patternTransform="rotate(${LIGHT.lean})">`);
    expect(art).toContain(`stroke-width="${LIGHT.weight}"`);
    // at half strength in the picture itself, whichever way it is inked
    expect(art).toContain(ink === "spectrum" ? `opacity="${LIGHT.ink}"` : `stroke-opacity="${LIGHT.ink}"`);
    expect(svgDoc(art)).toContain("</svg>");
  });

  it("the ink is the rarity's: white, warm for Legendary, a spectrum printed across the card for Mythic", () => {
    expect(LIGHT_INK).toEqual({ Common: "white", Uncommon: "white", Rare: "white", Legendary: "warm", Mythic: "spectrum" });
    expect(lightLines("white")).toContain('stroke="#ffffff"');
    expect(lightLines("warm")).toContain('stroke="#ffecb4"');
    // the spectrum runs the width of the CARD, so the ink itself stands still: the band shows the part it passes over
    expect(lightLines("spectrum")).toContain(`<linearGradient id="ink" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="${CARD_W}" y2="0">`);
    // a collab word's card is its set's colors and no metal: the plain white, decided by the look first
    expect(frame).toContain('const lightInk: LightInk = mine ? "white" : LIGHT_INK[tier ?? PLAIN];');
  });

  it("never a line over a letter: the front draws the band under its word, and only when its card says it is lit", () => {
    const at = (s: string) => { const i = frame.indexOf(s); expect(i, s).toBeGreaterThan(-1); return i; };
    const band = at('<i aria-hidden className="cf-light">');
    expect(band).toBeGreaterThan(at('<div className="cf-tex" />'));
    expect(band).toBeLessThan(at("className={`cf-word "));
    expect(frame).toContain("const lit = useContext(CardLit);");
    expect(frame).toMatch(/\{lit && \(\s*<i aria-hidden className="cf-light">\s*<i style=\{\{ backgroundImage: cardLightImage\(lightInk\) \}\} \/>\s*<\/i>\s*\)\}/);
    // the card draws no band of its own over the whole front any more
    const card = read("src/components/cards/SceneCard.tsx");
    expect(card).toContain("<CardLit.Provider value={light.lit}>{front}</CardLit.Provider>");
    expect(card).not.toMatch(/sc-sheen/);
    expect(css).not.toMatch(/sc-sheen/);
    expect(read("src/components/cards/useCardLight.ts")).not.toMatch(/CARD_SHEEN|linear-gradient/);
  });

  it("the band's measures in the styles are the drawing's", () => {
    const { half, box } = lightBand();
    expect([half, box]).toEqual([21.67, 54]);
    const lean = 90 + LIGHT.lean; // the window's edges lean as the lines lean
    const mask = `linear-gradient(${lean}deg, transparent calc(50% - ${half}cqw), #000 50%, transparent calc(50% + ${half}cqw))`;
    const win = rule(".cf-light");
    expect(win).toContain(`width: ${box}cqw`);
    expect(win).toContain(`transform: translateX(-${box}cqw)`); // at rest it stands off the card
    expect(win).toContain(`-webkit-mask-image: ${mask}`);
    expect(win).toContain(`; mask-image: ${mask}`);
    // the lines are the size of the card, and start where the window's travel puts them back on it
    const lines = rule(".cf-light > i");
    expect(lines).toContain("width: 100cqw");
    expect(lines).toContain(`transform: translateX(${box}cqw)`);
    // a picture, never slanted stripes made of a gradient (they broke into dashes at most pixel ratios)
    expect(win + lines).not.toMatch(/repeating-linear-gradient/);
  });

  it("the lines stand still on the card: the window and the lines move by the same amount, opposite ways, in step", () => {
    const { box } = lightBand();
    expect(css).toContain(`@keyframes cf-light { from { transform: translateX(-${box}cqw); } to { transform: translateX(100cqw); } }`);
    expect(css).toContain(`@keyframes cf-light-back { from { transform: translateX(${box}cqw); } to { transform: translateX(-100cqw); } }`);
    // one clock for both, only in a moment, and only where motion is welcome
    const a = /\.sc-moment \.cf-light \{ animation: cf-light ([^;]+); \}/.exec(css)?.[1];
    const b = /\.sc-moment \.cf-light > i \{ animation: cf-light-back ([^;]+); \}/.exec(css)?.[1];
    expect(a).toBe("1.3s cubic-bezier(0.3, 0, 0.2, 1) both");
    expect(b).toBe(a);
    const motion = css.slice(css.indexOf(".sc-ease { transition:") - 60, css.indexOf(".sc-moment .cf-light > i"));
    expect(motion).toContain("@media (prefers-reduced-motion: no-preference) {");
    // transforms only: a mask moved by its position, or anything else, is painted again on every frame
    for (const k of css.matchAll(/@keyframes cf-light[\w-]* \{([\s\S]*?\})\s*\}/g)) expect(k[1].replace(/transform: translateX\([^)]*\);/g, "")).not.toMatch(/[a-z-]+:/);
    expect(css).not.toMatch(/cf-light[^{]*\{[^}]*infinite/);
  });

  it("its strength follows the face: quiet on colour, quieter on a dark plate, and more on the pale stock card", () => {
    const strength = (sel: string) => Number(/opacity: ([\d.]+)/.exec(rule(sel))?.[1]);
    const [mid, dark, pale] = [strength(".cf-light"), strength(".cf-dark .cf-light"), strength(".cf-pale .cf-light")];
    expect([mid, dark, pale]).toEqual([0.36, 0.16, 0.79]);
    // what reaches the card: the picture's own half strength times these. As first drawn it was a full 0.5.
    expect(mid * LIGHT.ink).toBeLessThan(0.2);
    expect(dark).toBeLessThan(mid / 2);
    // every face is sorted, or takes the middle; none is both dark and pale
    const ids = new Set(SCENES.map((s) => s.id));
    for (const id of [...DARK_SCENES, ...PALE_SCENES]) expect(ids.has(id), id).toBe(true);
    for (const id of PALE_SCENES) expect(DARK_SCENES.has(id), id).toBe(false);
    expect([...PALE_SCENES]).toEqual(["stock"]);
    expect(frame).toContain('DARK_SCENES.has(scene) ? "cf-dark" : PALE_SCENES.has(scene) ? "cf-pale" : ""');
  });
});

describe("the card's stock is a playing card's weave: a diagonal crosshatch you can see, with no random grain (part 4: \"15A is good\")", () => {
  const css = read("src/app/globals.css").replace(/\/\*[\s\S]*?\*\//g, "");
  const rule = (sel: string) => new RegExp(`(?:^|\\n)${sel.replace(/[.]/g, "\\.")} \\{([^}]*)\\}`).exec(css)?.[1] ?? "";
  const picture = (r: string) => decodeURIComponent(/url\("data:image\/svg\+xml,([^"]+)"\)/.exec(r)?.[1] ?? "");
  type Line = { d: string; ink: string; strength: number; weight: number };
  const lines = (svg: string): Line[] => [...svg.matchAll(/<path d='([^']+)' stroke='(#[0-9a-f]+)' stroke-opacity='([.\d]+)' stroke-width='([.\d]+)'\/>/g)].map((m) => ({ d: m[1], ink: m[2], strength: Number(m[3]), weight: Number(m[4]) }));
  /** Which way a set of lines runs: +1 when x and y rise together (down to the right), -1 when one falls as the other rises. */
  const way = (d: string) => { const [, x0, y0, x1, y1] = /M(-?[\d.]+) (-?[\d.]+)L(-?[\d.]+) (-?[\d.]+)/.exec(d)!.map(Number); return Math.sign((x1 - x0) * (y1 - y0)); };

  it.each([".cf-tex", ".cb-tex"])("%s: one small picture, six pixels a repeat, and nothing else", (sel) => {
    const r = rule(sel);
    const svg = picture(r);
    expect(svg).toContain("<pattern id='w' width='6' height='6' patternUnits='userSpaceOnUse'>");
    expect(svg).toContain("<rect width='48' height='48' fill='url(#w)'/>");
    expect(r).toContain("background-size: 48px 48px");
    // no random grain (it was a noise filter), and no weave made of gradients (a slanted one breaks into dashes)
    expect(r).not.toMatch(/feTurbulence|filter|gradient/);
    expect((r.match(/url\("data:/g) ?? []).length).toBe(1); // one picture: no second layer under or over it
    expect(svg).not.toMatch(/<text|<image|<animate|href=/);
  });

  it.each([".cf-tex", ".cb-tex"])("%s: a CROSSHATCH that shows on any tone: each direction is a dark line with a light line beside it", (sel) => {
    const set = lines(picture(rule(sel)));
    expect(set).toHaveLength(4);
    const dark = sel === ".cf-tex" ? "#5a4a3a" : "#000";
    // both directions, and in each a dark line and a light one: a dark line alone is lost on a dark face, a light one on paper
    for (const dir of [-1, 1]) expect(set.filter((l) => way(l.d) === dir).map((l) => l.ink).sort()).toEqual([dark, "#fff"].sort());
    // one direction a little weaker than the other, as in the drawing he chose
    const strongest = (dir: number) => Math.max(...set.filter((l) => way(l.d) === dir).map((l) => l.strength));
    expect(strongest(1)).toBeLessThan(strongest(-1));
    expect(strongest(1)).toBeGreaterThan(strongest(-1) * 0.6);
  });

  it("it can be SEEN at real size: no hairline under two thirds of a pixel, none fainter than the first build's", () => {
    // starl3xx, of the first build: "i can't see the weave on any cards". It drew the swatch he chose
    // (which was enlarged three times) at its true size: lines 0.35 px wide, at 0.07 and 0.042.
    for (const sel of [".cf-tex", ".cb-tex"]) {
      const share = sel === ".cb-tex" ? Number(/opacity: ([\d.]+)/.exec(rule(sel))![1]) : 1;
      for (const l of lines(picture(rule(sel)))) {
        expect(l.weight, sel).toBeGreaterThanOrEqual(0.66);
        expect(l.strength * share * l.weight, sel).toBeGreaterThan(0.07 * 0.35 * 1.2); // more ink on the screen than the strongest line that could not be seen
      }
    }
    // and kept quiet: nothing over a fifth
    for (const sel of [".cf-tex", ".cb-tex"]) for (const l of lines(picture(rule(sel)))) expect(l.strength).toBeLessThanOrEqual(0.2);
  });

  it("every card side carries it, under the letters: the front, a thumbnail's front, a back, and the face-down card", () => {
    const frame = read("src/components/scenes/SceneFrame.tsx");
    expect(frame.match(/<div className="cf-tex" \/>/g)).toHaveLength(2);
    expect(frame.indexOf('<div className="cf-tex" />')).toBeLessThan(frame.indexOf("className={`cf-word "));
    expect(read("src/components/cards/CardBack.tsx")).toContain('<div className="cb-tex" />');
    expect(read("src/components/cards/FaceDownCard.tsx")).toContain('<div className="cb-tex" />');
  });
});
