// @vitest-environment jsdom
/**
 * The share video's living letters (decisions.md #48, part 7): the score they follow, and what the
 * video reads from the rig's drawing to cut a letter into its pieces.
 */
import { beforeEach, describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { TileCharacter } from "@/components/game/TileCharacter";
import { LOOP_SECONDS, loopPose } from "@/components/cards/loop/loopRenderer";
import { BLINK_S, BREATH_S, BREATH_UNITS, FRONT_AWAY, LEG_STRETCH, breathAt, eyesAt } from "@/components/cards/loop/score";
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
