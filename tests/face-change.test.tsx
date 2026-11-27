/**
 * @vitest-environment jsdom
 *
 * A face change on a card's front (decisions.md #59; starl3xx, 2026-11-27: "when switching faces,
 * the faces should have a nice swipe animation/transition rather than just
 * appearing/disappearing"). In the face picker the new face slides in over the old one, from the
 * side it sits on in the picker; everywhere else it fades in, as before. What must hold:
 * - the old face is under the new one while it comes in, and is dropped once it is in;
 * - a face is never drawn twice;
 * - each face is a still picture moved whole, nothing is scaled, and all travel waits for
 *   `prefers-reduced-motion: no-preference` (under reduced motion: the fade).
 */
import { readFileSync } from "fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { CARD_H, CARD_W } from "@/lib/cardArt/engrave";
import { WINDOW } from "@/lib/cardArt/looks";
import { SCENE_IDS, SCENES, swapSide, type SceneId } from "@/lib/scenes";

// jsdom has no matchMedia; this viewer doesn't ask for reduced motion
window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;

vi.mock("@/components/game/useSets", () => ({ useSets: () => ({ collab: new Map() }) }));
vi.mock("@/lib/onchain/gameMode", () => ({ isChainBacked: () => false }));

const { SceneFrame } = await import("@/components/scenes/SceneFrame");
const { sceneArtImage } = await import("@/components/scenes/SceneFrame");

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const UPPER = [true, true, false, false, true];
const card = (scene: SceneId, change?: "fade" | "slide") => <SceneFrame scene={scene} word="CRANE" upper={UPPER} tier="Common" collab={null} animated={false} change={change} />;
/** The faces drawn on the card, bottom first: which face, and the class that brings it in. */
const faces = (root: HTMLElement) =>
  [...root.querySelectorAll<HTMLElement>(".cf-art")].map((el) => ({
    face: SCENE_IDS.find((id) => el.style.backgroundImage === sceneArtImage(id, "Common")),
    coming: [...el.classList].find((c) => /^scene-(slide|fade)/.test(c)) ?? null,
  }));

describe("the side a face comes in from", () => {
  it("is the side it sits on in the picker: a later face from the right, an earlier one from the left", () => {
    expect(swapSide("stock", "stage")).toBe("next");
    expect(swapSide("stage", "stock")).toBe("prev");
    expect(swapSide("darkstock", "space")).toBe("next");
    expect(swapSide("space", "darkstock")).toBe("prev");
  });
  it("follows the order the picker lists the faces in", () => {
    // the picker maps SCENES; the rule reads SCENE_IDS: the two must be one order
    expect(SCENES.map((s) => s.id)).toEqual([...SCENE_IDS]);
    for (let a = 0; a < SCENE_IDS.length; a++)
      for (let b = 0; b < SCENE_IDS.length; b++) if (a !== b) expect(swapSide(SCENE_IDS[a], SCENE_IDS[b])).toBe(b > a ? "next" : "prev");
  });
});

describe("a face change on the card's front", () => {
  it("at rest draws one face, with nothing coming in", () => {
    const { container } = render(card("stage", "slide"));
    expect(faces(container)).toEqual([{ face: "stage", coming: null }]);
  });
  it("in the picker: the new face slides in over the old one, which holds still under it", () => {
    const { container, rerender } = render(card("stage", "slide"));
    rerender(card("spring", "slide"));
    expect(faces(container)).toEqual([
      { face: "stage", coming: null },
      { face: "spring", coming: "scene-slide-next" },
    ]);
    rerender(card("stock", "slide"));
    // spring is the old face now: it holds still under the new one, its own slide dropped
    expect(faces(container)).toEqual([
      { face: "spring", coming: null },
      { face: "stock", coming: "scene-slide-prev" },
    ]);
  });
  it("everywhere else: the new face fades in over the old one, as before", () => {
    const { container, rerender } = render(card("stage"));
    rerender(card("spring"));
    expect(faces(container)).toEqual([
      { face: "stage", coming: null },
      { face: "spring", coming: "scene-fade-in" },
    ]);
  });
  it("drops the old face once the new one is in", () => {
    vi.useFakeTimers();
    const { container, rerender } = render(card("stage", "slide"));
    rerender(card("spring", "slide"));
    expect(faces(container)).toHaveLength(2);
    act(() => void vi.advanceTimersByTime(600));
    expect(faces(container)).toEqual([{ face: "spring", coming: null }]);
  });
  it("marks the card as changing for exactly as long as the old face is kept (the letters' glide hangs on it)", () => {
    vi.useFakeTimers();
    for (const change of ["slide", "fade"] as const) {
      const { container, rerender, unmount } = render(card("stage", change));
      const root = () => container.querySelector(".cf") as HTMLElement;
      expect(root().classList.contains("cf-changing")).toBe(false);
      rerender(card("spring", change));
      expect(root().classList.contains("cf-changing")).toBe(true);
      expect(root().querySelectorAll(".cf-stand")).toHaveLength(5);
      act(() => void vi.advanceTimersByTime(600));
      expect(root().classList.contains("cf-changing")).toBe(false);
      unmount();
    }
  });
  it("never draws a face twice: back to the old face inside the change draws it once", () => {
    const { container, rerender } = render(card("stage", "slide"));
    rerender(card("spring", "slide"));
    rerender(card("stage", "slide"));
    const drawn = faces(container).map((f) => f.face);
    expect(new Set(drawn).size).toBe(drawn.length);
    expect(drawn.at(-1)).toBe("stage");
  });
  it("an earlier change's timer never drops a later change's old face early", () => {
    vi.useFakeTimers();
    const { container, rerender } = render(card("stage", "slide"));
    rerender(card("spring", "slide"));
    act(() => void vi.advanceTimersByTime(400));
    rerender(card("trophy", "slide"));
    // 200 ms more: past the first change's time, well inside the second's
    act(() => void vi.advanceTimersByTime(200));
    expect(faces(container).map((f) => f.face)).toEqual(["spring", "trophy"]);
    act(() => void vi.advanceTimersByTime(600));
    expect(faces(container).map((f) => f.face)).toEqual(["trophy"]);
  });
  it("a letter turns about its feet on every face, level ground too", () => {
    // Set only together with the turn, the turning point was dropped the moment a word left a
    // curved face for a level one, and the letter swung about its middle for the glide (Bugbot
    // on #317).
    const stances = (scene: SceneId) => {
      const { container, unmount } = render(card(scene));
      const out = [...container.querySelectorAll<HTMLElement>(".cf-stand")].map((el) => ({ origin: el.style.transformOrigin, turned: el.style.transform !== "" }));
      unmount();
      return out;
    };
    const level = stances("stage");
    const curved = stances("spring");
    expect(level).toHaveLength(5);
    expect(level.some((s) => s.turned)).toBe(false); // level ground: nothing to turn
    expect(curved.some((s) => s.turned)).toBe(true); // a hill: the outer letters lean to it
    const origins = new Set([...level, ...curved].map((s) => s.origin));
    expect(origins.size).toBe(1);
    expect([...origins][0]).toMatch(/^50% \d+(\.\d+)?%$/);
  });
  it("the face picker asks for the slide, and it is the only place that does", () => {
    expect(readFileSync("src/components/game/sheets/SceneSheet.tsx", "utf8")).toMatch(/change="slide"/);
    for (const f of ["src/components/game/TodayStage.tsx", "src/components/cards/SceneCard.tsx", "src/components/game/sheets/CelebrateSheet.tsx"]) {
      expect(readFileSync(f, "utf8"), f).not.toMatch(/change="slide"/);
    }
  });
});

describe("the slide's styles (globals.css)", () => {
  const css = readFileSync("src/app/globals.css", "utf8");
  const reduced = css.slice(0, css.indexOf("@keyframes scene-slide-next"));
  it("travel waits for motion to be welcome: under reduced motion the new face fades in", () => {
    // outside any media block, the slide classes are the fade
    expect(css).toMatch(/\.scene-slide-next,\s*\.scene-slide-prev \{ animation: scene-fade-in 450ms var\(--ease-out\) both; \}/);
    // Everything that travels (the slide, its edge's shade, the letters' glide) is inside ONE
    // no-preference block, and nowhere else in the file.
    const block = /@media \(prefers-reduced-motion: no-preference\) \{\s*\.scene-slide-next \{ animation: scene-slide-next[^}]*\}\s*\.scene-slide-prev \{ animation: scene-slide-prev[^}]*\}(?:\s*\.scene-slide-(?:next|prev)::before[^}]*\})+\s*\.cf-changing \.cf-stand \{ transition: transform[^}]*\}\s*\}/.exec(reduced);
    expect(block).not.toBeNull();
    const rest = css.replace(block![0], "").replace(/\/\*[\s\S]*?\*\//g, ""); // the rules, not the notes about them
    expect(rest).not.toMatch(/animation: scene-slide-(next|prev)/);
    expect(rest).not.toMatch(/\.scene-slide-(next|prev)::before/);
    expect(rest).not.toMatch(/\.cf-stand/);
  });
  it("the letters glide only while a face change is in flight, never when a card merely changes size", () => {
    // A stance is written in units of the card's width. With the glide always on, a resize (or
    // the Shop's closer look, which doubles the card) set the letters drifting for half a second.
    expect(css.match(/\.cf-stand \{/g)).toHaveLength(1);
    expect(css).toMatch(/\.cf-changing \.cf-stand \{ transition: transform/);
    // no rule gives a letter's stance a transition but under .cf-changing
    expect(css).not.toMatch(/(?<!\.cf-changing )\.cf-stand \{/);
  });
  const frames = (side: "next" | "prev") => new RegExp(`@keyframes scene-slide-${side} \\{\\s*from \\{([^}]*)\\}\\s*to \\{([^}]*)\\}\\s*\\}`).exec(css)!;
  it("moves each face whole and scales nothing", () => {
    for (const side of ["next", "prev"] as const) {
      const [all, from, to] = frames(side);
      expect(from).toMatch(side === "next" ? /transform: translateX\(100%\)/ : /transform: translateX\(-100%\)/);
      expect(to).toMatch(/transform: translateX\(0\)/);
      expect(all).not.toMatch(/scale|opacity|rotate/);
    }
  });
  it("the card's border holds still: the moving face is clipped to the window, and the clip doesn't move with it", () => {
    // A face's picture is clear outside the window and the paper border is the card's own, so a
    // picture that simply slid passed under the side border: a dark face showed through it.
    const pct = (n: number) => `${Number(n.toFixed(4))}%`;
    const side = pct((WINDOW.x / CARD_W) * 100); // 3.5%
    const top = pct((WINDOW.y / CARD_H) * 100); // 6.2222%
    const bottom = pct(((CARD_H - WINDOW.y - WINDOW.h) / CARD_H) * 100);
    const right = pct(((CARD_W - WINDOW.x - WINDOW.w) / CARD_W) * 100);
    expect(right).toBe(side); // the window sits in the middle of the card
    expect(bottom).toBe(top);
    expect(Number(((WINDOW.r / CARD_W) * 100).toFixed(4))).toBe(1); // "round 1cqw"
    const atRest = `clip-path: inset(${top} ${side} ${top} ${side} round 1cqw)`;
    // a picture one card-width to the right sees the window one card-width to its left, and back
    const away = (s: number) => pct(s);
    const far = { near: away(parseFloat(side) - 100), off: away(parseFloat(side) + 100) }; // -96.5%, 103.5%
    expect(frames("next")[1]).toContain(`clip-path: inset(${top} ${far.off} ${top} ${far.near} round 1cqw)`);
    expect(frames("prev")[1]).toContain(`clip-path: inset(${top} ${far.near} ${top} ${far.off} round 1cqw)`);
    for (const s of ["next", "prev"] as const) expect(frames(s)[2]).toContain(atRest);
    // and the shade is a strip at the picture's own edge (the window's), never the box's shadow
    expect(css).not.toMatch(/\.scene-slide-(next|prev) \{[^}]*box-shadow/);
    expect(css).toMatch(new RegExp(`\\.scene-slide-next::before \\{ right: ${pct(100 - parseFloat(side)).replace(".", "\\.")};`));
    expect(css).toMatch(new RegExp(`\\.scene-slide-prev::before \\{ left: ${pct(100 - parseFloat(side)).replace(".", "\\.")};`));
  });
  it("the card keeps the old face at least as long as the slide runs", () => {
    const ms = Number(/\.scene-slide-next \{ animation: scene-slide-next (\d+)ms/.exec(css)![1]);
    const kept = Number(/const SCENE_SWAP_MS = (\d+);/.exec(readFileSync("src/components/scenes/SceneFrame.tsx", "utf8"))![1]);
    expect(kept).toBeGreaterThanOrEqual(ms);
    expect(kept).toBeGreaterThanOrEqual(450); // the fade's time
  });
});
