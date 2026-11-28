// @vitest-environment jsdom
/**
 * A tile's size never changes in an animation (decisions.md #48; starl3xx, 2026-11-26: "however
 * the tiles are animated, their size should never change in animation; it breaks the character
 * illusion in a weird way"). A letter is moved and turned, never scaled: not by its own loops, not
 * by a press, and not by a box around it as it arrives.
 *
 * What may still change size, by the owner's word ("the tile size stays consistent"): the legs,
 * which stretch so the feet stay down while the body rises; a whole card's small lift as it turns;
 * and the small things that fly off a letter (a bead of sweat, a z, a twinkle, confetti).
 */
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { beforeEach, describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import config from "../tailwind.config";
import { TileCharacter } from "@/components/game/TileCharacter";
import { SHADOW_LINES } from "@/components/game/tileShapes";

beforeEach(() => {
  // jsdom has no matchMedia; this viewer does not ask for reduced motion
  window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
});

type Frames = Record<string, Record<string, string>>;
const keyframes = (config.theme?.extend?.keyframes ?? {}) as Record<string, Frames>;
const animations = (config.theme?.extend?.animation ?? {}) as Record<string, string>;
const transformsOf = (name: string) => Object.values(keyframes[name] ?? {}).map((f) => String((f as Record<string, string>).transform ?? ""));

/** The loops that move a tile's BODY: the tile itself. None may scale. */
const BODY = ["tcBreathe", "tcSigh", "tcSleep", "tcHop", "tcJump", "tcBrace"];
/** The loops that stretch the LEGS under it: allowed, and how the feet stay down. */
const LEGS = ["tcLegBreathe", "tcLegSigh", "tcLegHop", "tcLegJump", "tcKnock"];
/** Loops of things that are not the tile: what flies off a letter, its eyes' swap, the rays behind it. */
const OFF = ["tcSweat", "tcZzz", "tcConfetti", "tcRay", "tcPeekOpen", "tcPeekShut"];

describe("a tile's size never changes in an animation", () => {
  it("every letter loop is sorted: a new one must be put in a list here, so nobody adds a scale without meaning to", () => {
    const tc = Object.keys(keyframes).filter((k) => k.startsWith("tc"));
    expect(tc.sort()).toEqual([...BODY, ...LEGS, ...OFF].sort());
  });

  it.each(BODY)("%s moves and turns the body, and never scales it", (name) => {
    const all = transformsOf(name);
    expect(all.length).toBeGreaterThan(0);
    for (const t of all) expect(t, `${name}: ${t}`).not.toMatch(/scale|matrix/);
  });

  it("the win is a hop: a raised letter's body runs tcHop, its legs stretch by the rise, and nothing pulses", () => {
    expect(keyframes.tcPop).toBeUndefined();
    expect(animations["tc-pop"]).toBeUndefined();
    const { container } = render(<TileCharacter char="r" upper state="upgrade" size={150} />);
    const classes = [...container.querySelectorAll("[class*='animate-tc-']")].flatMap((el) => (el.getAttribute("class") ?? "").split(/\s+/).filter((c) => c.startsWith("animate-tc-")));
    expect(classes).toContain("animate-tc-hop");
    expect(classes).toContain("animate-tc-leghop");
    // the legs' stretch is the body's rise over the leg's own length (52 units), at the same moments, so the feet stay down
    const rise = (t: string) => Number(/var\(--uy\) \* (-?[\d.]+)/.exec(t)?.[1] ?? 0);
    const stretch = (t: string) => Number(/scaleY\(([\d.]+)\)/.exec(t)?.[1] ?? 1);
    for (const stop of Object.keys(keyframes.tcHop)) {
      const body = String(keyframes.tcHop[stop].transform);
      const legs = String(keyframes.tcLegHop[stop].transform);
      expect(stretch(legs), `at ${stop}`).toBeCloseTo(1 - rise(body) / 52, 2);
    }
  });

  it("a letter that arrives drops in: `drop` has no scale, and `pop` is used only where there is no letter", () => {
    for (const t of transformsOf("drop")) expect(t).not.toMatch(/scale|matrix/);
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const f of readdirSync(dir)) {
        const p = join(dir, f);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.tsx?$/.test(f)) files.push(p);
      }
    };
    walk(join(process.cwd(), "src/components"));
    walk(join(process.cwd(), "src/app"));
    const users = files.filter((f) => /\banimate-pop\b/.test(readFileSync(f, "utf8"))).map((f) => f.replace(process.cwd() + "/", ""));
    // a toast, and the Jackpot's confetti icon: neither is a letter, a word, or a card
    expect(users.sort()).toEqual(["src/components/game/primitives.tsx", "src/components/game/screens/JackpotScreen.tsx"]);
  });

  it("a press pushes a letter or a word down, and never squashes it", () => {
    const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter((m) => /\.(tile|word)-press\b/.test(m[1]));
    expect(rules.length).toBeGreaterThan(3);
    for (const [, selector, body] of rules) expect(body, selector.trim()).not.toMatch(/scale|matrix/);
  });
});

describe("what is around a letter is drawn like the cards", () => {
  it("the ground shadow is ruled lines in the shape of the shadow, not a grey oval", () => {
    const { container } = render(<TileCharacter char="g" size={140} />);
    expect(container.querySelector("ellipse[opacity]"), "a flat oval under the feet").toBeNull();
    const floor = container.querySelector("svg")!;
    const lines = [...floor.querySelectorAll("path")].filter((p) => /^M [\d.]+ [\d.]+ H [\d.]+$/.test(p.getAttribute("d") ?? ""));
    expect(lines).toHaveLength(SHADOW_LINES.length);
    // an oval: the middle line is the longest and the heaviest
    const mid = SHADOW_LINES[(SHADOW_LINES.length - 1) / 2];
    for (const l of SHADOW_LINES) {
      expect(l.x1 - l.x0).toBeLessThanOrEqual(mid.x1 - mid.x0);
      expect(l.w).toBeLessThanOrEqual(mid.w);
    }
  });

  it("a raised letter's rays are one still drawing on a layer of their own, cut off at the ground", () => {
    const { container } = render(<TileCharacter char="r" upper state="upgrade" size={150} />);
    const box = container.querySelector<HTMLElement>("[data-piece='rays']")!;
    expect(box).not.toBeNull();
    // the box stands still and cuts the rays off above the shadow; only the drawing inside it turns
    expect(box.getAttribute("class") ?? "").not.toContain("animate-");
    expect(box.style.clipPath).toMatch(/^inset\(/);
    const turning = box.querySelector("svg")!;
    expect(turning.getAttribute("class")).toContain("animate-tc-ray");
    expect(turning.querySelector("[class*='animate-']"), "a loop inside the rays' drawing").toBeNull();
    // and no rays in the floor's drawing, where they used to turn
    const floor = [...container.querySelectorAll("svg")].find((s) => !box.contains(s))!;
    expect(floor.querySelector("[class*='animate-tc-ray']")).toBeNull();
  });
});
