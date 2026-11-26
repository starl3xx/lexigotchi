// @vitest-environment jsdom
/**
 * The letter characters (components/game/TileCharacter, tileShapes; decisions.md #28): the rules
 * that keep them cheap and keep a word's hands together.
 *
 * The first is the one that matters most. A loop on a shape INSIDE an <svg> makes WebKit redraw
 * the whole letter on every frame (measured: 47% of a processor core for one word at rest, against
 * 6.5% with the loops on layers), and nothing on screen tells you it happened.
 */
import type { ReactElement } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, renderHook } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { TileCharacter, TileWord, forgetWebKit, useGaze, useWordLife, type TileState } from "@/components/game/TileCharacter";
import { ARM_REST, ARM_REST_R, BOT, CLASP, CX, LINK_L, LINK_R, PITCH, WORD_LEAN, leanFor } from "@/components/game/tileShapes";
import { OgTile } from "@/app/_og/tile";

beforeEach(() => {
  // jsdom has no matchMedia; this viewer doesn't ask for reduced motion
  window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
});

const STATES: TileState[] = ["idle", "peckish", "hungry", "eating", "rolling", "upgrade", "celebrate"];
/** The loops: each may only ever be on a layer (a whole <svg>). */
const LOOP = /animate-tc-(breathe|legbreathe|sigh|legsigh|sleep|eat|hop|leghop|jump|legjump|brace|knock|zzz|sweat|ray)\b/;
/**
 * What may run inside a layer: short, or one letter in a sheet, or a swap in steps (the peek, which
 * redraws nothing between its two halves). Never a sleeping word's zzz: a hungry word sleeps on the
 * Today stage for as long as it is hungry, and its z's looping inside the top layer cost 44% of a
 * processor core at rest in WebKit (5% with them still). And never a nervous letter's sweat: five
 * letters wait together in the ascend sheet, and their beads inside the top layers cost 27 points.
 * And never a raised letter's rays: turning inside the floor's drawing they cost 11% to 20% of a
 * core, and under 2% as a layer of their own (decisions.md #48).
 */
const INSIDE = new Set(["animate-tc-peek-open", "animate-tc-peek-shut", "animate-tc-confetti"]);
const animated = (root: Element) => [...root.querySelectorAll("[class*='animate-tc-']")];
const tcClasses = (el: Element) => (el.getAttribute("class") ?? "").split(/\s+/).filter((c) => c.startsWith("animate-tc-"));

/** The moving pieces of a rarity's light (globals.css, .rf-moment .rf-*). */
const MOMENT = /^rf-(pass|passing|catch|edge|facet|fire|glint|mote|rising)$/;
const isMoment = (el: Element) => (el.getAttribute("class") ?? "").split(/\s+/).some((c) => MOMENT.test(c));
const momentEls = (root: Element) => [...root.querySelectorAll("*")].filter(isMoment);

describe("a finished tile's light runs on layers, in WebKit", () => {
  // jsdom says its maker is Apple, as Safari and every iPhone browser do: these run as WebKit.
  afterEach(() => {
    vi.restoreAllMocks();
    forgetWebKit();
  });

  // Measured in WebKit over 40 s, one word: with the light inside the letter's drawing, a Legendary
  // word cost 35% of a processor core and a Rare one 23%; with every moving piece a layer of its
  // own, 17% and 11% (a Common word: about 9%). One glint moving inside the drawing cost 27% alone.
  const cases = (["Uncommon", "Rare", "Legendary", "Mythic"] as const).flatMap((tier) =>
    [0, 1].flatMap((index) => (["idle", "peckish"] as const).map((state) => ({ tier, index, state }))),
  );

  it.each(cases)("$tier, tile $index, $state: every moving piece is a whole <svg>, and none shares a drawing with the letter", ({ tier, index, state }) => {
    const { container } = render(<TileCharacter char="q" upper={index === 0} tier={tier} state={state} size={140} index={index} lean={2} />);
    const moving = momentEls(container);
    expect(moving.length).toBeGreaterThan(2);
    for (const el of moving) {
      expect(el.tagName.toLowerCase(), `${el.getAttribute("class")} on <${el.tagName}>`).toBe("svg");
      // and nothing moves inside a moving layer
      expect(momentEls(el)).toHaveLength(0);
    }
    // the letter's own drawing holds no moving piece, nor does any other still piece of the body
    const letter = container.querySelector("text")!.closest("svg")!;
    expect(letter.getAttribute("data-piece")).toBe("mid");
    for (const still of ["base", "mid", "over"]) {
      const piece = container.querySelector(`svg[data-piece="${still}"]`)!;
      expect(isMoment(piece), still).toBe(false);
      expect(momentEls(piece), still).toHaveLength(0);
    }
  });

  it("keeps the body's loop on the one wrapper that holds the pieces, in the order the body is painted", () => {
    const { container } = render(<TileCharacter char="q" upper tier="Mythic" size={140} index={0} />);
    const body = container.querySelector('[data-piece="body"]')!;
    expect(body.tagName.toLowerCase()).toBe("div");
    expect(tcClasses(body).some((c) => LOOP.test(c))).toBe(true);
    // no other loop inside it: a piece can't carry the loop and its own moment
    expect(animated(body)).toHaveLength(0);
    const piece = (name: string) => body.querySelector(`[data-piece="${name}"]`)!;
    const before = (a: string, b: string) => expect(piece(a).compareDocumentPosition(piece(b)) & Node.DOCUMENT_POSITION_FOLLOWING, `${a} is painted before ${b}`).toBeTruthy();
    // the glow under the letter; the streak, the facets, the glints over it and under the eyes; the motes over all
    before("base", "catch");
    before("catch", "band");
    before("band", "mid");
    before("mid", "streak");
    before("streak", "facet-left");
    before("facet-right", "fire");
    before("fire", "edge");
    before("edge", "glint0");
    before("glint1", "over");
    before("over", "mote0");
  });

  it("cuts the travelling light at the face's edge with a shape that stays put, and leans it as a layer", () => {
    const { container } = render(<TileCharacter char="q" upper tier="Legendary" size={140} index={0} lean={2} />);
    for (const name of ["band", "streak"]) {
      const layer = container.querySelector(`svg[data-piece="${name}"]`)!;
      const cut = layer.parentElement as HTMLElement;
      expect(cut.style.clipPath, name).toMatch(/^inset\(.* round /);
      // the cut itself never moves
      expect(isMoment(cut)).toBe(false);
      const rise = cut.parentElement as HTMLElement;
      expect(rise.classList.contains("tc-perk-layer")).toBe(true);
      expect((rise.parentElement as HTMLElement).style.transform).toBe("rotate(2deg)");
    }
    // a piece that only fades keeps the lean AND the hover's rise inside its own drawing, as the tile does
    const fade = container.querySelector('svg[data-piece="catch"]')!;
    expect(fade.querySelector("g")!.getAttribute("transform")).toBe(`rotate(2 ${CX} ${BOT})`);
    expect(fade.querySelector(".tc-perk")).not.toBeNull();
    expect(fade.parentElement!.getAttribute("data-piece")).toBe("body");
  });

  it("lifts a turning glint as a layer OUTSIDE its turn: inside, the turn would swing the risen glint off its point", () => {
    // Bugbot on #237: with the hover's rise inside the layer, the layer's own quarter turn put a
    // hovered glint six units to the side of where it belongs, until the moment ended.
    const { container } = render(<TileCharacter char="q" upper tier="Mythic" size={140} index={0} lean={2} />);
    for (const name of ["edge", "glint0", "glint1"]) {
      const layer = container.querySelector(`svg[data-piece="${name}"]`)!;
      // the lean is inside its drawing (a glint is seen at rest, so it must be drawn as the tile is)
      expect(layer.querySelector("g")!.getAttribute("transform"), name).toBe(`rotate(2 ${CX} ${BOT})`);
      // the rise is not
      expect(layer.querySelector(".tc-perk"), name).toBeNull();
      const [undo, rise, lean] = [layer.parentElement as HTMLElement, layer.parentElement!.parentElement as HTMLElement, layer.parentElement!.parentElement!.parentElement as HTMLElement];
      expect(rise.classList.contains("tc-perk-layer"), name).toBe(true);
      // the rise runs along the leaned tile's own up; the two turns round it leave the glint where it was
      expect(lean.style.transform, name).toBe("rotate(2deg)");
      expect(undo.style.transform, name).toBe("rotate(-2deg)");
      expect(undo.style.transformOrigin, name).toBe(lean.style.transformOrigin);
    }
  });

  it("dims a peckish word's light as one group, not piece by piece (overlapping pieces would come out brighter)", () => {
    const { container } = render(<TileCharacter char="q" upper tier="Mythic" state="peckish" size={140} index={0} />);
    for (const group of ["light", "shine"]) {
      const g = container.querySelector(`div[data-piece="${group}"]`) as HTMLElement;
      expect(g.style.opacity, group).toBe("0.45");
      expect(momentEls(g).length, group).toBeGreaterThan(1);
    }
    // a peckish word has no glints and no motes
    expect(container.querySelector('[data-piece^="glint"], [data-piece="edge"], [data-piece^="mote"]')).toBeNull();
  });

  it("in any other engine is the one drawing it always was, the light moving inside it", () => {
    // Headless Chrome, slowed four times, paid for each layer: 106% of a core for a Legendary word
    // as layers against 99% in one drawing. So only WebKit, which redraws the whole drawing, is cut.
    vi.spyOn(navigator, "vendor", "get").mockReturnValue("Google Inc.");
    forgetWebKit();
    const { container } = render(<TileCharacter char="q" upper tier="Mythic" size={140} index={0} />);
    expect(container.querySelector("[data-piece]")).toBeNull();
    const moving = momentEls(container);
    expect(moving.length).toBeGreaterThan(4);
    const body = container.querySelector("text")!.closest("svg")!;
    for (const el of moving) {
      expect(el.tagName.toLowerCase()).not.toBe("svg");
      expect(body.contains(el)).toBe(true);
      // the shapes' own keyframes, in px: never the layers'
      expect(el.getAttribute("class")).not.toMatch(/rf-(passing|rising)/);
    }
  });

  it("draws the same pieces at the same times either way (the layers, and the one drawing)", () => {
    const pieces = (root: Element) =>
      momentEls(root)
        .map((el) => `${el.getAttribute("class")!.split(/\s+/).find((c) => MOMENT.test(c))!.replace("rf-passing", "rf-pass").replace("rf-rising", "rf-mote")}@${parseFloat((el as HTMLElement).style.animationDelay).toFixed(2)}`)
        .sort();
    for (const tier of ["Uncommon", "Rare", "Legendary", "Mythic"] as const) {
      for (const index of [0, 1, 4]) {
        for (const state of ["idle", "peckish"] as const) {
          const tile = <TileCharacter char="q" upper tier={tier} state={state} size={140} index={index} />;
          forgetWebKit();
          const layers = render(tile);
          expect(layers.container.querySelector("[data-piece]"), "cut into pieces").not.toBeNull();
          const asLayers = pieces(layers.container);
          layers.unmount();
          vi.spyOn(navigator, "vendor", "get").mockReturnValue("Google Inc.");
          forgetWebKit();
          const one = render(tile);
          expect(one.container.querySelector("[data-piece]"), "one drawing").toBeNull();
          expect(asLayers, `${tier} ${index} ${state}`).toEqual(pieces(one.container));
          expect(asLayers.length).toBeGreaterThan(2);
          one.unmount();
          vi.restoreAllMocks();
        }
      }
    }
  });

  it("asks which engine this is only for a tile that could be cut (the answer costs a second render)", () => {
    const vendor = vi.spyOn(navigator, "vendor", "get");
    const asks = (el: ReactElement) => {
      forgetWebKit();
      vendor.mockClear();
      render(el).unmount();
      return vendor.mock.calls.length > 0;
    };
    // no finish, or a light that holds still: never
    expect(asks(<TileCharacter char="q" upper size={140} />)).toBe(false);
    expect(asks(<TileCharacter char="q" size={52} />)).toBe(false);
    expect(asks(<TileCharacter char="q" upper tier="Mythic" size={140} still />)).toBe(false);
    expect(asks(<TileCharacter char="q" upper tier="Mythic" size={140} state="hungry" />)).toBe(false);
    expect(asks(<TileCharacter char="q" upper tier="Mythic" size={52} />)).toBe(false);
    expect(asks(<TileCharacter char="q" upper tier="Mythic" size={140} detail="full" flat />)).toBe(false);
    // a finished tile whose light moves: yes
    expect(asks(<TileCharacter char="q" upper tier="Mythic" size={140} />)).toBe(true);
  });

  it("is one body, as it was, wherever the light doesn't move", () => {
    const one = (el: ReactElement) => {
      const { container } = render(el);
      expect(container.querySelector("[data-piece]"), "no pieces").toBeNull();
      expect(momentEls(container), "nothing moves").toHaveLength(0);
    };
    one(<TileCharacter char="q" upper tier="Mythic" size={140} still />);
    one(<TileCharacter char="q" upper tier="Mythic" size={140} state="hungry" />);
    one(<TileCharacter char="q" upper tier="Mythic" size={52} />);
    one(<TileCharacter char="q" upper size={140} />);
    // a picture in a single file is one <svg>, whatever its rarity
    const html = renderToStaticMarkup(<TileCharacter char="q" upper tier="Mythic" size={140} detail="full" flat />);
    expect(html.match(/<svg/g)).toHaveLength(1);
    expect(html).not.toContain("data-piece");
  });
});

describe("the loops run on layers", () => {
  it.each(STATES)("%s: a loop is only ever on a whole <svg>, and only the allowed moments run inside one", (state) => {
    const { container } = render(<TileCharacter char="q" state={state} upper={state === "upgrade"} size={140} />);
    const els = animated(container);
    for (const el of els) {
      for (const c of tcClasses(el)) {
        if (LOOP.test(c)) expect(el.tagName.toLowerCase(), `${c} on <${el.tagName}>`).toBe("svg");
        else expect(INSIDE.has(c), `${c} runs inside a layer`).toBe(true);
      }
    }
    // every state moves a layer
    expect(els.some((el) => el.tagName.toLowerCase() === "svg")).toBe(true);
  });

  it("a sleeping letter's three z's are a layer each, rising in turn, and nothing loops inside a layer", () => {
    const { container } = render(<TileCharacter char="q" state="hungry" size={140} />);
    const zs = [...container.querySelectorAll("svg.animate-tc-zzz")] as SVGElement[];
    expect(zs).toHaveLength(3);
    expect(zs.map((z) => z.textContent)).toEqual(["z", "z", "z"]);
    expect(zs.map((z) => z.style.animationDelay)).toEqual(["0s", "0.5s", "1s"]);
    // each turns and grows about its own place, not the letter's
    expect(new Set(zs.map((z) => z.style.transformOrigin)).size).toBe(3);
    // the layer that holds the still things (the clasp) has no z in it
    for (const svg of [...container.querySelectorAll("svg")]) if (!svg.classList.contains("animate-tc-zzz")) expect(svg.querySelector("text")?.textContent ?? "").not.toBe("z");
    expect(container.querySelector("svg [class*='animate-tc-zzz']")).toBeNull();
  });

  it("a sleeping letter that holds still (a list, reduced motion) shows its z's and moves none", () => {
    const { container } = render(<TileCharacter char="q" state="hungry" size={140} still />);
    expect(animated(container)).toHaveLength(0);
    expect([...container.querySelectorAll("text")].filter((el) => el.textContent === "z")).toHaveLength(3);
  });

  it("is stacked layers (floor, legs, body, top), and draws only the ones that hold something", () => {
    // a letter holding its left neighbour's hand has all four: the clasp is on the top
    expect(render(<TileCharacter char="a" size={140} linkLeft />).container.querySelectorAll("svg")).toHaveLength(4);
    // alone at rest, nothing is on top
    expect(render(<TileCharacter char="a" size={140} />).container.querySelectorAll("svg")).toHaveLength(3);
    // a small tile in a grid is the body alone, one <svg>, as it was before the layers
    expect(render(<TileCharacter char="a" size={52} />).container.querySelectorAll("svg")).toHaveLength(1);
  });

  it("a still tile, and a small tile with no legs at rest, run nothing", () => {
    const still = render(<TileCharacter char="a" size={140} still />);
    expect(animated(still.container)).toHaveLength(0);
    const small = render(<TileCharacter char="a" size={52} />);
    expect(animated(small.container)).toHaveLength(0);
  });

  it("flat is one <svg> with a size, the same loops on its groups (the docs' pictures)", () => {
    const html = renderToStaticMarkup(<TileCharacter char="a" size={120} detail="full" flat />);
    expect(html.match(/<svg/g)).toHaveLength(1);
    expect(html).toMatch(/<svg[^>]* width="120" height="170"/);
    expect(html).toMatch(/<g class="animate-tc-breathe"/);
    // the units the loops' keyframes move by are on the drawing itself
    expect(html).toContain("--uy:");
  });
});

describe("a word holds hands", () => {
  const word = renderToStaticMarkup(<TileWord word="crane" upper={[true, true, true, false, false]} size={110} still />);
  const count = (s: string) => word.split(`d="${s}"`).length - 1;

  it("each pair's arms reach for each other, and the end letters' outer arms hang at rest", () => {
    expect(count(LINK_L)).toBe(4);
    expect(count(LINK_R)).toBe(4);
    expect(count(ARM_REST.d)).toBe(1);
    expect(count(ARM_REST_R.d)).toBe(1);
  });

  it("each arm ends under its own hand of the clasp, so a body can rise without parting them", () => {
    const end = (d: string) => d.trim().split(/\s+/).slice(-2).map(Number);
    const [lx, ly] = end(LINK_L); // my arm, to the hand over
    const [rx, ry] = end(LINK_R); // my neighbour's arm, in ITS space: one pitch to the left is mine
    expect(Math.hypot(lx - CLASP.over.cx, ly - CLASP.over.cy)).toBeLessThan(2.5);
    expect(Math.hypot(rx - PITCH - CLASP.under.cx, ry - CLASP.under.cy)).toBeLessThan(2.5);
  });

  it("small word rows have no limbs, so no hands to hold", () => {
    const row = renderToStaticMarkup(<TileWord word="crane" upper={[]} size={44} />);
    expect(row).not.toContain(`d="${LINK_L}"`);
  });
});

describe("a word that can't look (the ascend sheet)", () => {
  const UP = [true, true, true, true, true];
  const delaysOf = (els: Element[]) => els.map((el) => (el as HTMLElement).style.animationDelay);

  it("trembles out of step: each letter's body and legs start a part of a shake behind the last", () => {
    const { container } = render(<TileWord word="vivid" upper={UP} state="rolling" size={110} />);
    // An UPPERCASE letter with legs trembles as two layers: its rings, under the legs, and its body,
    // over them (decisions.md #48). The two are one tile, so they shake in step.
    const bodies = [...container.querySelectorAll("svg.animate-tc-brace")];
    expect(bodies).toHaveLength(10);
    const delays = delaysOf(bodies);
    expect(delays[0]).toBe(""); // the first letter is the beat the rest are behind
    expect(new Set(delays).size).toBe(5);
    for (let i = 0; i < bodies.length; i += 2) expect(delays[i + 1], `letter ${i / 2}: rings and body`).toBe(delays[i]);
    // and the loops are still on layers, never inside one (the rule at the top of this file)
    for (const el of container.querySelectorAll(".animate-tc-brace, .animate-tc-knock")) expect(el.tagName.toLowerCase()).toBe("svg");
  });

  it("peeks one letter at a time: the five eyes open at five points of the cycle, both halves of each together", () => {
    const { container } = render(<TileWord word="vivid" upper={UP} state="rolling" size={110} />);
    const open = delaysOf([...container.querySelectorAll(".animate-tc-peek-open")]);
    const shut = delaysOf([...container.querySelectorAll(".animate-tc-peek-shut")]);
    expect(open).toHaveLength(5);
    expect(new Set(open).size).toBe(5);
    expect(shut).toEqual(open);
  });

  it("sweats on layers: each bead is a whole <svg> that flies along its own turn, at its own time", () => {
    const { container } = render(<TileWord word="vivid" upper={UP} state="rolling" size={110} />);
    const beads = [...container.querySelectorAll(".animate-tc-sweat")] as HTMLElement[];
    expect(beads).toHaveLength(10);
    for (const b of beads) {
      expect(b.tagName.toLowerCase()).toBe("svg");
      expect(b.style.opacity).toBe("0"); // unseen until its turn comes
      expect(Math.hypot(Number(b.style.getPropertyValue("--fx")), Number(b.style.getPropertyValue("--fy")))).toBeCloseTo(1, 2);
    }
    expect(new Set(beads.map((b) => b.style.animationDelay)).size).toBe(10);
    // a still frame shows none: a bead frozen in the air reads as an ear
    const still = render(<TileWord word="vivid" upper={UP} state="rolling" size={110} still />);
    expect(still.container.querySelectorAll(".animate-tc-sweat")).toHaveLength(0);
  });

  it("one letter alone is as it was: nothing is delayed", () => {
    const { container } = render(<TileCharacter char="q" state="rolling" size={140} />);
    expect((container.querySelector("svg.animate-tc-brace") as HTMLElement).style.animationDelay).toBe("");
    expect((container.querySelector(".animate-tc-peek-open") as HTMLElement).style.animationDelay).toBe("");
  });

  it("takes a state and a stage per letter, so a result can pass along the word", () => {
    const { container } = render(
      <TileWord word="vivid" upper={UP} state="rolling" gild={1} states={["celebrate", "celebrate"]} gilds={[2, 2]} size={110} />,
    );
    const labels = [...container.querySelectorAll("[aria-label*='tile']")].map((el) => el.getAttribute("aria-label"));
    expect(labels).toEqual([
      "V tile (UPPERCASE), celebrate · gilded 2",
      "I tile (UPPERCASE), celebrate · gilded 2",
      "V tile (UPPERCASE), rolling · gilded 1",
      "I tile (UPPERCASE), rolling · gilded 1",
      "D tile (UPPERCASE), rolling · gilded 1",
    ]);
  });
});

describe("the lean", () => {
  it("is the same every time for a word, whatever its case, and never more than the limit", () => {
    const a = [..."CRANE"].map((_, i) => leanFor("CRANE", i));
    expect([..."crane"].map((_, i) => leanFor("crane", i))).toEqual(a);
    expect([..."CRANE"].map((_, i) => leanFor("CRANE", i))).toEqual(a);
    for (const deg of a) expect(Math.abs(deg)).toBeLessThanOrEqual(WORD_LEAN);
  });

  it("is uneven: a word's letters don't all lean alike", () => {
    for (const w of ["CRANE", "TEASE", "VIVID", "JAZZY"]) {
      const leans = [...w].map((_, i) => leanFor(w, i));
      expect(new Set(leans).size).toBeGreaterThan(2);
      expect(Math.max(...leans) - Math.min(...leans)).toBeGreaterThan(0.5);
    }
  });

  it("turns the tile about its feet", () => {
    const html = renderToStaticMarkup(<TileCharacter char="a" size={120} lean={1.5} still />);
    expect(html).toContain(`rotate(1.5 ${CX} ${BOT})`);
  });
});

describe("a word's life", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });
  const row = () => {
    const el = document.createElement("div");
    el.innerHTML = `<i data-tc=""></i><i data-tc=""></i><i data-tc=""></i>`;
    document.body.append(el);
    return el;
  };
  const at = (ms: number) => act(() => void vi.advanceTimersByTime(ms));

  it("blinks a letter for a moment, then lets go", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.1); // the blink branch, the first letter, first tick at 590 ms
    const el = row();
    renderHook(() => useWordLife({ current: el }, true));
    at(580);
    expect(el.querySelector(".tc-blink")).toBeNull();
    at(20);
    expect(el.children[0].classList.contains("tc-blink")).toBe(true);
    at(125);
    expect(el.children[0].classList.contains("tc-blink")).toBe(false);
  });

  it("follows the row when its element is swapped (the Today stage keys the row by word)", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.1);
    const ref = { current: row() };
    renderHook(() => useWordLife(ref, true));
    const next = row();
    ref.current = next; // the next word's row; the hook isn't told
    at(600);
    expect(next.children[0].classList.contains("tc-blink")).toBe(true);
  });

  it("a glance has its own property, so it and the pointer can't take the eyes off each other", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.7); // the glance branch, the last letter, ending 1670 ms on
    const el = row();
    renderHook(() => useWordLife({ current: el }, true));
    const tile = el.children[2] as HTMLElement;
    // the pointer is on this letter the whole time (useGaze writes the pupil's own transform)
    const pupil = tile.appendChild(document.createElement("b"));
    pupil.className = "tc-pupil";
    pupil.style.transform = "translate(2.2px, 0px)";
    at(1200); // the first tick, at 1130 ms
    expect(tile.style.getPropertyValue("--glance")).toBe("-0.9");
    expect(pupil.style.transform).toBe("translate(2.2px, 0px)");
    at(1700); // the glance has ended: it let go of its own property, and only that
    expect(tile.style.getPropertyValue("--glance")).toBe("");
    expect(pupil.style.transform).toBe("translate(2.2px, 0px)");
  });

  it("a second glance on a letter mid-glance lasts its own time, not the first one's", () => {
    // start at 590 ms · glance on the last letter for 999 ms · next tick 800 ms on · glance on it
    // again for 1989 ms · then blinks elsewhere
    const rnd = vi.spyOn(Math, "random").mockReturnValue(0.5);
    for (const v of [0.1, 0.7, 0.7, 0.09, 0, 0.7, 0.7, 0.99]) rnd.mockReturnValueOnce(v);
    const el = row();
    renderHook(() => useWordLife({ current: el }, true));
    const tile = el.children[2] as HTMLElement;
    at(600);
    expect(tile.style.getPropertyValue("--glance")).toBe("-0.9");
    at(1100); // 1700 ms: the first glance was due to end at 1589, and the second began at 1390
    expect(tile.style.getPropertyValue("--glance")).toBe("-0.9");
    at(1700); // 3400 ms: the second has ended (3379)
    expect(tile.style.getPropertyValue("--glance")).toBe("");
  });

  it("does nothing while it isn't active, and cleans up when it stops", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.1);
    const idle = row();
    renderHook(() => useWordLife({ current: idle }, false));
    at(10_000);
    expect(idle.querySelector(".tc-blink")).toBeNull();

    const el = row();
    const { unmount } = renderHook(() => useWordLife({ current: el }, true));
    at(600);
    expect(el.querySelector(".tc-blink")).not.toBeNull();
    unmount();
    expect(el.querySelector(".tc-blink")).toBeNull();
    at(10_000);
    expect(el.querySelector(".tc-blink")).toBeNull();
  });
});

describe("the share card's letter (Satori)", () => {
  it("in a word: held hands and a lean, with every attribute a real value", () => {
    const html = renderToStaticMarkup(OgTile({ char: "a", upper: true, w: 160, linkLeft: true, linkRight: true, lean: 1.5, uid: "t1" }));
    expect(html).not.toMatch(/undefined|NaN/);
    expect(html).toContain(`d="${LINK_L}"`);
    expect(html).toContain(`d="${LINK_R}"`);
    expect(html).toContain(`rotate(1.5 ${CX} ${BOT})`);
  });

  it("upright is still a real rotate (Satori drops a group whose transform it can't read)", () => {
    const html = renderToStaticMarkup(OgTile({ char: "a" }));
    expect(html).toContain(`rotate(0 ${CX} ${BOT})`);
    expect(html).not.toMatch(/undefined|NaN/);
    // alone, both arms hang at rest
    expect(html).toContain(`d="${ARM_REST.d}"`);
    expect(html).toContain(`d="${ARM_REST_R.d}"`);
  });
});

describe("the eyes follow the pointer (useGaze)", () => {
  // One frame at a time: the hook asks for a frame, and the test runs it.
  let frames: FrameRequestCallback[] = [];
  const frame = () => act(() => void frames.splice(0).forEach((cb) => cb(0)));
  beforeEach(() => {
    frames = [];
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => frames.push(cb));
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });
  const row = () => {
    const el = document.createElement("div");
    el.innerHTML = `<i data-tc=""><b class="tc-pupil"></b><b class="tc-pupil"></b></i><i data-tc=""><b class="tc-pupil"></b></i>`;
    document.body.append(el);
    return el;
  };
  const pupils = (el: HTMLElement) => Array.from(el.querySelectorAll<HTMLElement>(".tc-pupil"));
  const move = (x: number, y: number, pointerType = "mouse") => ({ clientX: x, clientY: y, pointerType });

  it("writes each pupil's place onto the pupil, with no transition while it follows", () => {
    const el = row();
    const { result } = renderHook(() => useGaze({ current: el }, true));
    result.current.onPointerMove?.(move(40, 0));
    expect(pupils(el)[0].style.transform).toBe(""); // nothing until the frame
    frame();
    for (const p of pupils(el)) {
      expect(p.style.transform).toBe("translate(5.50px, 0.00px)"); // full look to the right
      expect(p.style.transition).toBe("none");
    }
  });

  it("sets no custom property on the tile: one there is inherited by every shape in the letter", () => {
    const el = row();
    const { result } = renderHook(() => useGaze({ current: el }, true));
    result.current.onPointerMove?.(move(0, 40));
    frame();
    for (const tile of Array.from(el.children) as HTMLElement[]) expect(tile.getAttribute("style") ?? "").not.toContain("--");
    expect(pupils(el)[0].style.transform).toBe("translate(0.00px, 4.00px)"); // full look down
  });

  it("asks for one frame however many times the pointer moves before it", () => {
    const el = row();
    const { result } = renderHook(() => useGaze({ current: el }, true));
    result.current.onPointerMove?.(move(40, 0));
    result.current.onPointerMove?.(move(-40, 0));
    expect(frames).toHaveLength(1);
    frame();
    expect(pupils(el)[0].style.transform).toBe("translate(-5.50px, 0.00px)"); // the last place wins
    result.current.onPointerMove?.(move(40, 0));
    expect(frames).toHaveLength(1); // and the next move asks again
  });

  it("lets go when the pointer leaves, so the pupil eases back to its glance or its rest", () => {
    const el = row();
    const { result } = renderHook(() => useGaze({ current: el }, true));
    result.current.onPointerMove?.(move(40, 0));
    frame();
    result.current.onPointerLeave?.();
    for (const p of pupils(el)) {
      expect(p.style.transform).toBe("");
      expect(p.style.transition).toBe("");
    }
  });

  it("a frame that lands after the pointer left writes nothing", () => {
    const el = row();
    const { result } = renderHook(() => useGaze({ current: el }, true));
    result.current.onPointerMove?.(move(40, 0));
    result.current.onPointerLeave?.();
    frame();
    expect(pupils(el)[0].style.transform).toBe("");
  });

  it("does not follow a touch, and hands back no handlers when the word is not watched", () => {
    const el = row();
    const { result, rerender } = renderHook(({ on }) => useGaze({ current: el }, on), { initialProps: { on: true } });
    result.current.onPointerMove?.(move(40, 0, "touch"));
    expect(frames).toHaveLength(0);
    result.current.onPointerMove?.(move(40, 0));
    frame();
    expect(pupils(el)[0].style.transform).not.toBe("");
    rerender({ on: false }); // the word went still, or off screen
    expect(result.current).toEqual({});
    expect(pupils(el)[0].style.transform).toBe("");
  });
});
