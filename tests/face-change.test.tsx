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
    const travel = /@media \(prefers-reduced-motion: no-preference\) \{\s*\.scene-slide-next \{ animation: scene-slide-next[^}]*\}\s*\.scene-slide-prev \{ animation: scene-slide-prev[^}]*\}\s*\.cf-stand \{ transition: transform[^}]*\}\s*\}/;
    expect(reduced).toMatch(travel);
    // and the letters' glide exists nowhere else
    expect(css.match(/\.cf-stand \{/g)).toHaveLength(1);
  });
  it("moves each face whole and scales nothing", () => {
    const frames = css.match(/@keyframes scene-slide-(next|prev) \{[^}]*\{[^}]*\}\s*\}/g) ?? [];
    expect(frames).toHaveLength(2);
    for (const f of frames) {
      expect(f).toMatch(/transform: translateX\((-)?100%\)/);
      expect(f).not.toMatch(/scale|opacity|rotate/);
    }
  });
  it("the card keeps the old face at least as long as the slide runs", () => {
    const ms = Number(/\.scene-slide-next \{ animation: scene-slide-next (\d+)ms/.exec(css)![1]);
    const kept = Number(/const SCENE_SWAP_MS = (\d+);/.exec(readFileSync("src/components/scenes/SceneFrame.tsx", "utf8"))![1]);
    expect(kept).toBeGreaterThanOrEqual(ms);
    expect(kept).toBeGreaterThanOrEqual(450); // the fade's time
  });
});
