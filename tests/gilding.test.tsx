// @vitest-environment jsdom
/**
 * The gilding (decisions.md #48, part 2; starl3xx, 2026-11-26): slim rings, the legs in front of
 * them, black diamond pips at every stage, and laurels from Gilded 4.
 */
import { beforeEach, describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { OgTile } from "@/app/_og/tile";
import { TileCharacter, type Gild } from "@/components/game/TileCharacter";
import { GILD, LAUREL_LEAF, LEG_L, RING_PLAIN, laurel, pipPath, ringOuter, ringParts, ringRects, T } from "@/components/game/tileShapes";

beforeEach(() => {
  // jsdom has no matchMedia; this viewer does not ask for reduced motion
  window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
});

const STAGES: Gild[] = [1, 2, 3, 4, 5];
const BRASS = "#c8962b";
const INK = "#2a1e1a";
const layersOf = (root: Element) => [...root.querySelectorAll("svg")];
/** What a layer holds: its rings, its legs, or the tile's face. */
const kind = (svg: Element) => (svg.querySelector("text") ? "body" : svg.querySelector(".tc-legs-perk") ? "legs" : svg.querySelector("rect[fill='none'][stroke]") ? "rings" : "floor");

describe("slim gilding", () => {
  it("is 8, 9, 10, 13.5, 13.5 units of gold outside the blue border (it was 13, 15, 17, 22, 22)", () => {
    expect(STAGES.map((g) => ringOuter(g) - 6)).toEqual([8, 9, 10, 13.5, 13.5]);
    // a letter that is not gilded keeps its pale ring as it was
    expect(ringOuter(0)).toBe(RING_PLAIN);
  });

  it("says three things, not five: gilded, doubled from Gilded 4, and (by its paint) foil at Holographic", () => {
    expect(STAGES.map((g) => ringParts(g).map((r) => r.part).join(" "))).toEqual(["gold pale", "gold pale", "gold pale", "gold pale gold", "gold pale gold"]);
    expect(GILD.gold.slice(1)).toEqual([5, 6, 7, 7, 7]);
  });

  it("stacks the rings with no gap, from the border outward", () => {
    for (const g of STAGES) {
      let edge = 6;
      for (const r of ringRects(g)) {
        expect(T.x - r.x - r.sw / 2, `stage ${g}`).toBeCloseTo(edge, 6);
        edge += r.sw;
      }
      expect(edge).toBeCloseTo(ringOuter(g), 6);
    }
  });
});

describe("legs in front of the ring", () => {
  it.each([0, 2, 4, 5] as Gild[])("an UPPERCASE letter with legs (stage %s) draws its rings on a layer under its legs, and the body over them", (gild) => {
    const { container } = render(<TileCharacter char="r" upper gild={gild} size={150} detail="full" />);
    expect(layersOf(container).map(kind)).toEqual(["floor", "rings", "legs", "body"]);
    // the body no longer draws a ring of its own
    const body = layersOf(container)[3];
    expect(body.querySelector(`rect[stroke='${BRASS}']`)).toBeNull();
    expect(body.querySelector("rect[stroke='#bbd1fd']")).toBeNull();
  });

  it("the rings move with the body: the same loop, the same turn, the same beat", () => {
    const { container } = render(<TileCharacter char="r" upper gild={4} size={150} detail="full" state="celebrate" index={2} />);
    const [, rings, , body] = layersOf(container);
    expect(rings.getAttribute("class")).toContain("animate-tc-jump");
    expect(body.getAttribute("class")).toContain("animate-tc-jump");
    expect((rings as unknown as HTMLElement).style.transformOrigin).toBe((body as unknown as HTMLElement).style.transformOrigin);
    expect((rings as unknown as HTMLElement).style.animationDelay).toBe((body as unknown as HTMLElement).style.animationDelay);
  });

  it("a lowercase letter has no ring, and a letter with no legs keeps its ring in its one drawing", () => {
    expect(layersOf(render(<TileCharacter char="r" size={150} detail="full" />).container).map(kind)).toEqual(["floor", "legs", "body"]);
    const small = render(<TileCharacter char="r" upper gild={3} size={48} />).container;
    expect(layersOf(small)).toHaveLength(1);
    expect(small.querySelector(`rect[stroke='${BRASS}']`)).not.toBeNull();
  });
});

describe("black diamond pips", () => {
  const pips = (root: Element) => [0, 1, 2, 3, 4].map((i) => root.querySelector(`path[d='${pipPath(i)}']`));

  it.each(STAGES)("stage %s: that many pips are solid ink, the rest a faint outline, and none is gold or foil", (gild) => {
    const { container } = render(<TileCharacter char="k" upper gild={gild} size={150} detail="full" />);
    const all = pips(container);
    expect(all.every(Boolean)).toBe(true);
    all.forEach((p, i) => {
      if (i < gild) expect(p!.getAttribute("fill"), `pip ${i}`).toBe(INK);
      else {
        expect(p!.getAttribute("fill")).toBe("none");
        expect(Number(p!.getAttribute("stroke-opacity"))).toBeLessThan(0.4);
      }
    });
  });

  it("needs no white plate under them, on any rarity's face", () => {
    for (const tier of ["Legendary", "Mythic"] as const) {
      const { container } = render(<TileCharacter char="v" upper gild={3} tier={tier} size={150} detail="full" />);
      expect(container.querySelector("rect[fill='#ffffff'][rx='12']"), tier).toBeNull();
    }
  });

  it("a letter that is not gilded, or not UPPERCASE, has none", () => {
    expect(pips(render(<TileCharacter char="k" upper size={150} />).container).some(Boolean)).toBe(false);
    expect(pips(render(<TileCharacter char="k" gild={3} size={150} />).container).some(Boolean)).toBe(false);
  });
});

describe("laurels", () => {
  const leaves = (root: Element) => root.querySelectorAll(`path[d='${LAUREL_LEAF}']`);

  it("are worn from Gilded 4, by a whole character: two sprigs of eight leaves", () => {
    for (const gild of [4, 5] as Gild[]) expect(leaves(render(<TileCharacter char="w" upper gild={gild} size={150} detail="full" />).container), `stage ${gild}`).toHaveLength(16);
    expect(leaves(render(<TileCharacter char="w" upper gild={3} size={150} detail="full" />).container)).toHaveLength(0);
    expect(leaves(render(<TileCharacter char="w" upper gild={5} size={48} />).container)).toHaveLength(0);
  });

  it("are gold at Gilded 4 and the foil at Holographic", () => {
    const fill = (gild: Gild) => leaves(render(<TileCharacter char="w" upper gild={gild} size={150} detail="full" />).container)[0].getAttribute("fill");
    expect(fill(4)).toBe("#f0a617");
    expect(fill(5)).toMatch(/^url\(#tc-holo-/);
  });

  it("arch over the head, clear of the eyes, and stay inside the letter's own width", () => {
    for (const gild of [4, 5] as Gild[]) {
      const ro = ringOuter(gild);
      const { stem, leaves: where } = laurel(ro);
      const xs = [...stem.matchAll(/(-?[\d.]+) (-?[\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])]);
      // the stem starts at the top left corner and ends above the head, left of the middle (the right sprig mirrors it)
      expect(xs[0][0]).toBeGreaterThan(0);
      expect(xs[xs.length - 1][0]).toBeLessThan(120);
      // above the ring's top edge everywhere: the eyes sit on that edge and reach only a little over it
      for (const t of where) {
        const y = Number(/translate\(-?[\d.]+ (-?[\d.]+)\)/.exec(t)![1]);
        expect(y).toBeLessThan(T.y - ro + 22);
      }
    }
  });

  it("take the place of the twinkle over the head", () => {
    const stars = (gild: Gild, size: number) => render(<TileCharacter char="w" upper gild={gild} size={size} detail={size > 100 ? "full" : "auto"} />).container.querySelectorAll(".tc-star").length;
    expect(stars(4, 150)).toBe(2); // with laurels: the two on the ring
    expect(stars(3, 150)).toBe(2);
    expect(stars(4, 48)).toBe(3); // a small tile wears no laurels, so it keeps the third
  });
});

describe("the share letter wears the gilding too (the server's pictures)", () => {
  const draw = (props: Record<string, unknown>) => renderToStaticMarkup(OgTile({ char: "q", upper: true, uid: "x", ...props } as Parameters<typeof OgTile>[0]));
  const count = (html: string, needle: string) => html.split(needle).length - 1;

  it.each(STAGES)("stage %s: the slim rings, that many black pips, and the letter lifted over them", (gild) => {
    const html = draw({ gild });
    for (const r of ringRects(gild)) expect(html, `ring ${r.sw}`).toContain(`stroke-width="${r.sw}"`);
    expect(html).not.toContain("#bbd1fd"); // the pale ring gives way to the gold
    expect(count(html, `fill="${INK}" stroke="${INK}" stroke-width="2.1"`)).toBe(gild);
    expect(count(html, `stroke-opacity="0.26"`)).toBe(5 - gild);
    expect(html).toMatch(/padding-bottom:\s*[\d.]+px/);
  });

  it("laurels from Gilded 4 on a whole character, gold and then foil; none on a tile without its limbs", () => {
    expect(count(draw({ gild: 4 }), LAUREL_LEAF)).toBe(16);
    expect(draw({ gild: 4 })).toContain(`fill="#f0a617"`);
    expect(count(draw({ gild: 5 }), LAUREL_LEAF)).toBe(16);
    expect(draw({ gild: 5 })).toContain(`fill="url(#rf-holo-x)"`);
    expect(draw({ gild: 5 })).toContain(`id="rf-holo-x"`);
    expect(count(draw({ gild: 3 }), LAUREL_LEAF)).toBe(0);
    expect(count(draw({ gild: 5, limbs: false }), LAUREL_LEAF)).toBe(0);
  });

  it("a letter that is not gilded is drawn as before, and a lowercase letter never wears a stage", () => {
    const plain = draw({ gild: 0 });
    expect(plain).toContain("#bbd1fd");
    expect(plain).not.toContain(pipPath(0));
    const lower = draw({ upper: false, gild: 5 });
    expect(lower).not.toContain(pipPath(0));
    expect(lower).not.toContain("rf-holo-");
  });

  it("the pips are painted last, over a rarity's glints, as the rig paints them", () => {
    for (const tier of ["Legendary", "Mythic"] as const) {
      for (const index of [0, 1]) {
        const html = draw({ gild: 3, tier, index });
        const firstPip = html.indexOf(pipPath(0));
        expect(firstPip, tier).toBeGreaterThan(-1);
        // nothing of the letter's light comes after the pips: they are the last drawing in the markup
        const after = html.slice(html.lastIndexOf(pipPath(4)));
        expect(after, `${tier} ${index}`).not.toMatch(/<circle|<ellipse|<path[^>]*d="M (?!\d+ \d+(\.\d+)? L)/);
        // and the printed letter (a div of text) is under them
        expect(html.indexOf(">Q<")).toBeLessThan(firstPip);
      }
    }
  });

  it("the legs come over the rings and under the face, as in the game", () => {
    const html = draw({ gild: 4 });
    const ring = html.indexOf(`stroke="#c8962b"`);
    const leg = html.indexOf(LEG_L);
    const face = html.indexOf(`fill="#ffffff" stroke="#3b82f6"`);
    expect(ring).toBeGreaterThan(-1);
    expect(leg).toBeGreaterThan(ring);
    expect(face).toBeGreaterThan(leg);
  });
});
