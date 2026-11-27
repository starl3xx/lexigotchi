// @vitest-environment jsdom
/**
 * The share video's living letters (decisions.md #48, part 7): the score they follow, and what the
 * video reads from the rig's drawing to cut a letter into its pieces.
 */
import { beforeEach, describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { TileCharacter } from "@/components/game/TileCharacter";
import { LOOP_SECONDS, loopPose } from "@/components/cards/loop/loopRenderer";
import { BLINK_S, BREATH_S, BREATH_UNITS, FRONT_AWAY, GLANCE_UNITS, LEG_STRETCH, breathAt, eyesAt } from "@/components/cards/loop/score";
import { pieceOf, withEyes } from "@/components/cards/loop/liveFront";
import { CARD_LOOK, showcaseStagePath } from "@/lib/showcase";

beforeEach(() => {
  window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
});

const FRAMES = Array.from({ length: LOOP_SECONDS * 30 }, (_, f) => f / 30);
const LENGTHS = [1, 2, 3, 4, 5, 6, 7];

describe("the letters' score", () => {
  it("ends where it began: every motion takes a time that divides the loop", () => {
    expect(LOOP_SECONDS % BREATH_S).toBe(0);
    for (const n of LENGTHS) {
      for (let i = 0; i < n; i++) {
        for (const t of [0, 0.5, 1.3, 2.9, 5.4]) {
          expect(breathAt(i, t + LOOP_SECONDS)).toBeCloseTo(breathAt(i, t), 9);
          expect(eyesAt(i, n, t + LOOP_SECONDS)).toBe(eyesAt(i, n, t));
        }
        // and the step from the last frame back to the first is no bigger than the biggest step between two frames
        const seam = Math.abs(breathAt(i, 0) - breathAt(i, FRAMES[FRAMES.length - 1]));
        const biggest = Math.max(...FRAMES.slice(1).map((f, k) => Math.abs(breathAt(i, f) - breathAt(i, FRAMES[k]))));
        expect(seam).toBeLessThanOrEqual(biggest + 1e-9);
      }
    }
  });

  it("breathes a little deeper than the game (the owner's pick for the video), with the legs stretching by the rise", () => {
    expect(BREATH_UNITS).toBeGreaterThan(3);
    expect(BREATH_UNITS).toBeLessThanOrEqual(6);
    expect(LEG_STRETCH).toBeCloseTo(BREATH_UNITS / 52, 9);
    for (const t of FRAMES) for (let i = 0; i < 5; i++) expect(breathAt(i, t)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...FRAMES.map((t) => breathAt(0, t)))).toBeCloseTo(1, 2);
    // each letter a little behind the last, never five in step
    expect(new Set([0, 1, 2, 3, 4].map((i) => breathAt(i, 1).toFixed(3))).size).toBe(5);
  });

  it("blinks and glances while the front faces the viewer, and does nothing behind the card's back", () => {
    for (const n of LENGTHS) {
      const seen = new Set<string>();
      for (const t of FRAMES) {
        const away = t >= FRONT_AWAY[0] && t < FRONT_AWAY[1];
        for (let i = 0; i < n; i++) {
          const e = eyesAt(i, n, t);
          if (away) expect(e, `letter ${i} of ${n} at ${t.toFixed(2)} s`).toBe("open");
          else seen.add(e);
        }
      }
      expect(seen.has("shut"), `${n} letters blink`).toBe(true);
      if (n > 1) expect(seen.has("left") && seen.has("right"), `${n} letters glance`).toBe(true);
    }
    // the front really is away for that stretch: the card is turned more than a quarter and less than three
    for (const t of [FRONT_AWAY[0] + 0.05, 3.5, FRONT_AWAY[1] - 0.05]) {
      const turn = loopPose(t).turn % 360;
      expect(turn).toBeGreaterThan(90);
      expect(turn).toBeLessThan(270);
    }
  });

  it("a blink lasts a few frames, and as the front comes home the word blinks along its length, a letter at a time", () => {
    const shutFrames = (i: number, n: number, from: number, to: number) => FRAMES.filter((t) => t >= from && t < to && eyesAt(i, n, t) === "shut");
    expect(Math.round(BLINK_S * 30)).toBeGreaterThanOrEqual(3);
    const starts = [0, 1, 2, 3, 4].map((i) => shutFrames(i, 5, 5.2, 5.75)[0]);
    expect(starts.every((t) => t !== undefined)).toBe(true);
    for (let i = 1; i < 5; i++) expect(starts[i]).toBeGreaterThan(starts[i - 1]);
  });
});

describe("what the video reads from the rig", () => {
  it("the rig names its layers, in one drawing and as stacked ones", () => {
    const flat = render(<TileCharacter char="q" upper gild={4} tier="Legendary" index={1} linkLeft linkRight size={180} detail="full" flat still />).container;
    expect(flat.querySelectorAll("svg")).toHaveLength(1);
    const names = [...flat.querySelectorAll("svg > [data-layer]")].map((g) => g.getAttribute("data-layer"));
    // floor, then the rings UNDER the legs, then the body, then the joined hands
    expect(names).toEqual(["floor", "rings", "legs", "body", "top"]);
    const stacked = render(<TileCharacter char="q" upper gild={4} index={1} linkLeft size={180} detail="full" />).container;
    expect([...stacked.querySelectorAll("svg[data-layer]")].map((g) => g.getAttribute("data-layer"))).toEqual(["floor", "rings", "legs", "body", "top"]);
    // a lowercase letter has no rings, and an end letter that holds no hand to its left has no top
    const lower = render(<TileCharacter char="q" size={180} detail="full" flat still />).container;
    expect([...lower.querySelectorAll("svg > [data-layer]")].map((g) => g.getAttribute("data-layer"))).toEqual(["floor", "legs", "body"]);
  });

  it("the body holds both drawings of each eye, the open one's pupil by name, and the printed letter as text", () => {
    const body = render(<TileCharacter char="q" upper size={180} detail="full" flat still />).container.querySelector('[data-layer="body"]')!;
    expect(body.querySelectorAll(".tc-eye-open")).toHaveLength(2);
    expect(body.querySelectorAll(".tc-eye-shut")).toHaveLength(2);
    expect(body.querySelectorAll(".tc-pupil")).toHaveLength(2);
    for (const shut of body.querySelectorAll(".tc-eye-shut")) expect(shut.getAttribute("visibility")).toBe("hidden");
    expect(body.querySelector("text")?.textContent).toBe("Q");
    // a letter held still carries no loop: the video moves the pieces itself
    expect(body.getAttribute("class") ?? "").not.toContain("animate-");
  });

  it("the card's front without its letters has an address of its own, with the look and the stage in it", () => {
    expect(showcaseStagePath("VIVID", "spring", 2)).toBe(`/s/VIVID/card?face=1&letters=0&v=${CARD_LOOK}&g=2&scene=spring`);
    expect(showcaseStagePath("CRAne")).toBe(`/s/CRAne/card?face=1&letters=0&v=${CARD_LOOK}`);
  });
});

/**
 * A piece of a letter becomes a picture of its own: no page around it, none of the drawing's other
 * layers. Whatever it needs must be inside it, or the video's letter silently loses it (a paint
 * that points at nothing draws nothing). Checked for every rarity, the stages that change the
 * drawing, and both cases.
 */
describe("each piece of a letter stands alone", () => {
  // Every rarity, and a collab word's two colors where a rarity goes (lib/rarityFinish.ts `TileTier`):
  // the video's letters wear the collab stock as the game's do, and each of its pieces must stand alone too.
  const COLLAB = { a: "#1f6f8b", b: "#f2a65a" };
  const TIERS_ALL = [undefined, "Common", "Uncommon", "Rare", "Legendary", "Mythic", COLLAB] as const;
  const GILDS = [0, 1, 4, 5] as const;
  const LAYERS = ["floor", "rings", "legs", "body", "top"];
  /** Classes a piece may carry: each only MOVES its element in the game (a moment, a press), so without a page it is the letter at rest. */
  const HARMLESS = new Set(["tc-pupil", "tc-eye-open", "tc-eye-shut", "tc-star", "tc-perk", "tc-legs-perk", "tc-brow"]);
  const parse = (piece: string) => new DOMParser().parseFromString(`<svg xmlns="http://www.w3.org/2000/svg">${piece}</svg>`, "image/svg+xml");
  const drawing = (tier: (typeof TIERS_ALL)[number], gild: (typeof GILDS)[number], upper: boolean) =>
    render(<TileCharacter char="q" upper={upper} gild={gild} tier={tier} index={1} linkLeft linkRight lean={1.4} size={180} detail="full" flat still />).container.querySelector("svg") as SVGSVGElement;

  it("everything a piece points at is inside it, nothing in it waits for a page's styles, and nothing runs on a clock", () => {
    let pieces = 0;
    for (const tier of TIERS_ALL) {
      for (const gild of GILDS) {
        for (const upper of [false, true]) {
          const svg = drawing(tier, gild, upper);
          const where = `${tier ?? "no tier"}, stage ${gild}, ${upper ? "UPPERCASE" : "lowercase"}`;
          for (const layer of LAYERS) {
            for (const eyes of layer === "body" ? (["open", "shut", "left", "right"] as const) : ([null] as const)) {
              const piece = pieceOf(svg, layer, eyes ? withEyes(eyes) : undefined);
              if (piece === null) continue;
              pieces++;
              const doc = parse(piece);
              expect(doc.querySelector("parsererror"), `${where}, ${layer}: reads as a drawing`).toBeNull();
              // every paint, clip, and filter it names is defined inside it
              const ids = new Set([...doc.querySelectorAll("[id]")].map((el) => el.getAttribute("id")));
              for (const ref of piece.matchAll(/url\(#([^)]+)\)/g)) expect(ids.has(ref[1]), `${where}, ${layer}: #${ref[1]} is defined in the piece`).toBe(true);
              for (const ref of piece.matchAll(/href="#([^"]+)"/g)) expect(ids.has(ref[1]), `${where}, ${layer}: #${ref[1]} is defined in the piece`).toBe(true);
              // nothing takes a value from the page: a variable must carry its own fallback, and no colour is the page's
              expect(piece, `${where}, ${layer}`).not.toMatch(/var\(--[\w-]+\)/);
              expect(piece, `${where}, ${layer}`).not.toContain("currentColor");
              for (const el of doc.querySelectorAll("[class]")) for (const c of (el.getAttribute("class") ?? "").split(/\s+/).filter(Boolean)) expect(HARMLESS.has(c), `${where}, ${layer}: class "${c}" must not need the page's styles`).toBe(true);
              // nothing moves by itself, and nothing that the page would show is left hidden (or the reverse)
              expect(doc.querySelectorAll("animate, animateTransform, animateMotion, set"), `${where}, ${layer}`).toHaveLength(0);
              expect(doc.querySelectorAll('[visibility="hidden"]'), `${where}, ${layer}`).toHaveLength(0);
              expect(doc.querySelectorAll('[opacity="0"]'), `${where}, ${layer}: nothing waits, unseen, for a moment`).toHaveLength(0);
              for (const t of doc.querySelectorAll("text")) expect(t.getAttribute("font-family")).toBe("Soehne, sans-serif");
            }
          }
        }
      }
    }
    // 6 rarities × 4 stages × 2 cases, each at least a floor, legs, and four bodies
    expect(pieces).toBeGreaterThan(6 * 4 * 2 * 6);
  });

  it("the rings of a Holographic UPPERCASE letter bring the foil with them (it is defined in the body's layer)", () => {
    const svg = drawing("Mythic", 5, true);
    const rings = pieceOf(svg, "rings")!;
    expect(rings).toMatch(/url\(#tc-holo-/);
    expect(rings).toMatch(/<linearGradient[^>]*id="tc-holo-/);
    // and a rarity's glow, drawn under the rings, brings its own paint
    const glow = [...rings.matchAll(/url\(#([^)]+)\)/g)].map((m) => m[1]).filter((id) => !id.startsWith("tc-holo-"));
    for (const id of glow) expect(rings).toContain(`id="${id}"`);
  });

  it("the eyes: open has no shut drawing, shut has no open one, and a glance moves both pupils", () => {
    const svg = drawing("Rare", 0, false);
    const count = (piece: string, cls: string) => parse(piece).querySelectorAll(`.${cls}`).length;
    const open = pieceOf(svg, "body", withEyes("open"))!;
    expect([count(open, "tc-eye-open"), count(open, "tc-eye-shut")]).toEqual([2, 0]);
    const shut = pieceOf(svg, "body", withEyes("shut"))!;
    expect([count(shut, "tc-eye-open"), count(shut, "tc-eye-shut")]).toEqual([0, 2]);
    for (const [eyes, sign] of [["left", -1], ["right", 1]] as const) {
      const pupils = [...parse(pieceOf(svg, "body", withEyes(eyes))!).querySelectorAll(".tc-pupil")];
      expect(pupils).toHaveLength(2);
      for (const p of pupils) expect(p.getAttribute("transform")).toBe(`translate(${sign * GLANCE_UNITS} 0)`);
    }
    // cutting pieces never changes the drawing they are cut from
    expect(svg.querySelectorAll(".tc-eye-shut")).toHaveLength(2);
  });
});
