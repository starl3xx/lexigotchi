// @vitest-environment jsdom
/**
 * The letter characters (components/game/TileCharacter, tileShapes; decisions.md #28): the rules
 * that keep them cheap and keep a word's hands together.
 *
 * The first is the one that matters most. A loop on a shape INSIDE an <svg> makes WebKit redraw
 * the whole letter on every frame (measured: 47% of a processor core for one word at rest, against
 * 6.5% with the loops on layers), and nothing on screen tells you it happened.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, renderHook } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { TileCharacter, TileWord, useWordLife, type TileState } from "@/components/game/TileCharacter";
import { ARM_REST, ARM_REST_R, BOT, CLASP, CX, LINK_L, LINK_R, PITCH, WORD_LEAN, leanFor } from "@/components/game/tileShapes";
import { OgTile } from "@/app/_og/tile";

beforeEach(() => {
  // jsdom has no matchMedia; this viewer doesn't ask for reduced motion
  window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
});

const STATES: TileState[] = ["idle", "peckish", "hungry", "eating", "rolling", "upgrade", "celebrate"];
/** The loops: each may only ever be on a layer (a whole <svg>). */
const LOOP = /animate-tc-(breathe|legbreathe|sigh|legsigh|sleep|eat|pop|jump|legjump|brace|knock)\b/;
/** What may run inside a layer: short, or one letter in a sheet, or a still word's zzz. */
const INSIDE = new Set(["animate-tc-sweat", "animate-tc-peek-open", "animate-tc-peek-shut", "animate-tc-zzz", "animate-tc-confetti", "animate-tc-ray"]);
const animated = (root: Element) => [...root.querySelectorAll("[class*='animate-tc-']")];
const tcClasses = (el: Element) => (el.getAttribute("class") ?? "").split(/\s+/).filter((c) => c.startsWith("animate-tc-"));

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
    // every state but a sleeping word's moves its body
    if (state !== "hungry") expect(els.some((el) => el.tagName.toLowerCase() === "svg")).toBe(true);
  });

  it("is four stacked layers: floor, legs, body, top", () => {
    const { container } = render(<TileCharacter char="a" size={140} />);
    expect(container.querySelectorAll("svg")).toHaveLength(4);
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
