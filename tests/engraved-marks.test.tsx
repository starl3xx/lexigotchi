// @vitest-environment jsdom
/**
 * The game's own star, crown, and twinkle (lib/engravedMark, components/game/EngravedMark;
 * decisions.md #66, part 2; the design audit's 2C, starl3xx: "2C and 2D are g2g"). They took the
 * place of three icons from the bought set: solid shapes with no ink line, from somewhere else.
 */
import { describe, it, expect, afterEach } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { EngravedMark } from "@/components/game/EngravedMark";
import { CROWN_BAND, MARK_BOX, MARK_GOLD, MARK_OUTLINE, MARK_POINTS, MARK_SHADE, RAYS_FROM, SHADE_FROM, TWINKLE_RAYS, markHairline, markStroke, type MarkKind } from "@/lib/engravedMark";

afterEach(cleanup);
const KINDS: MarkKind[] = ["star", "crown", "twinkle"];

/** Is the point inside the outline? (Crossing count.) */
function inside(pts: readonly (readonly [number, number])[], x: number, y: number): boolean {
  let hit = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}
const segments = (d: string) => [...d.matchAll(/M(-?[\d.]+) (-?[\d.]+)L(-?[\d.]+) (-?[\d.]+)/g)].map((m) => m.slice(1).map(Number) as [number, number, number, number]);

describe("the marks' drawings", () => {
  it.each(KINDS)("%s: one closed outline, inside the box, by the kit's rules", (kind) => {
    const d = MARK_OUTLINE[kind];
    expect(d).toMatch(/^M[\d. L-]+Z$/);
    expect(d).not.toMatch(/NaN|Infinity|undefined/);
    for (const [x, y] of MARK_POINTS[kind]) {
      expect(x).toBeGreaterThanOrEqual(1);
      expect(x).toBeLessThanOrEqual(MARK_BOX - 1);
      expect(y).toBeGreaterThanOrEqual(1);
      expect(y).toBeLessThanOrEqual(MARK_BOX - 1);
    }
  });

  it.each(KINDS)("%s: its shade is ruled lines INSIDE the outline, on the side turned from the light", (kind) => {
    const pts = MARK_POINTS[kind];
    const lines = segments(MARK_SHADE[kind]);
    expect(lines.length).toBeGreaterThanOrEqual(2);
    const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length;
    const cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
    for (const [x1, y1, x2, y2] of lines) {
      // both ends and the middle are inside: nothing has to be clipped when it is drawn
      for (const [x, y] of [[x1, y1], [x2, y2], [(x1 + x2) / 2, (y1 + y2) / 2]]) expect(inside(pts, x, y), `${kind} ${x},${y}`).toBe(true);
      // every line leans the same way (up to the right), and lies lower right of the middle: the light is upper left
      expect(x2 - x1).toBeCloseTo(y1 - y2, 1);
      expect(x1 + y1).toBeGreaterThan(cx + cy);
    }
  });

  it("the twinkle is the letters' own four-point star, and the star has five points", () => {
    expect(MARK_POINTS.twinkle).toHaveLength(8);
    expect(MARK_POINTS.star).toHaveLength(10);
    // TileCharacter's star4 keeps its inner radius a little over a third of its outer one
    const [top, inner] = [MARK_POINTS.twinkle[0], MARK_POINTS.twinkle[1]];
    const share = Math.hypot(inner[0] - 12, inner[1] - 12) / Math.hypot(top[0] - 12, top[1] - 12);
    expect(share).toBeGreaterThan(0.34);
    expect(share).toBeLessThan(0.45);
    expect(readFileSync("src/components/game/TileCharacter.tsx", "utf8")).toContain(`const GOLD = "${MARK_GOLD}";`);
  });

  it("a line is never finer than a pixel on the screen, at any size a mark is shown", () => {
    for (let size = 10; size <= 96; size++) {
      expect((markStroke(size) * size) / MARK_BOX, `${size}`).toBeGreaterThanOrEqual(0.99);
      expect((markHairline(size) * size) / MARK_BOX, `${size}`).toBeGreaterThanOrEqual(0.74);
    }
  });
});

describe("a mark as it is drawn", () => {
  const paths = (c: HTMLElement) => [...c.querySelectorAll("path")].map((p) => p.getAttribute("d"));

  it("small: the outline and a flat gold fill, and nothing finer", () => {
    const { container } = render(<EngravedMark kind="star" size={12} />);
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("width")).toBe("12");
    expect(svg.getAttribute("aria-hidden")).toBe("true");
    expect(svg.getAttribute("stroke")).toBe("currentColor"); // the outline is the text's colour: ink, unless its box says otherwise
    expect(paths(container)).toEqual([MARK_OUTLINE.star]);
    expect(container.querySelector("path")!.getAttribute("fill")).toBe(MARK_GOLD);
  });

  it("large enough: ruled shade lines too, and the twinkle's rays from a larger size still", () => {
    expect(paths(render(<EngravedMark kind="star" size={SHADE_FROM - 1} />).container)).toEqual([MARK_OUTLINE.star]);
    expect(paths(render(<EngravedMark kind="star" size={SHADE_FROM} />).container)).toEqual([MARK_OUTLINE.star, MARK_SHADE.star]);
    expect(paths(render(<EngravedMark kind="twinkle" size={RAYS_FROM - 1} />).container)).toEqual([MARK_OUTLINE.twinkle, MARK_SHADE.twinkle]);
    expect(paths(render(<EngravedMark kind="twinkle" size={RAYS_FROM} />).container)).toEqual([TWINKLE_RAYS, MARK_OUTLINE.twinkle, MARK_SHADE.twinkle]);
    // the crown always has its band
    expect(paths(render(<EngravedMark kind="crown" size={12} />).container)).toEqual([MARK_OUTLINE.crown, CROWN_BAND]);
  });

  it("not yet earned: its outline alone", () => {
    const { container } = render(<EngravedMark kind="star" size={32} earned={false} />);
    expect(paths(container)).toEqual([MARK_OUTLINE.star]);
    expect(container.querySelector("path")!.getAttribute("fill")).toBe("none");
  });

  it("never moves and never changes size: no animation, no gradient, no filter, no id", () => {
    for (const kind of KINDS) {
      const html = render(<EngravedMark kind={kind} size={48} />).container.innerHTML;
      expect(html).not.toMatch(/animate|transition|<linearGradient|<radialGradient|<filter|<clipPath|<mask| id="/);
    }
  });
});

describe("the bought star, crown, and burst are gone from the game", () => {
  function files(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) {
        if (path === join("src", "components", "admin") || path === join("src", "app", "admin")) continue; // the operator console keeps its own icons
        files(path, out);
      } else if (/\.tsx?$/.test(name)) out.push(path);
    }
    return out;
  }
  const FILES = [...files(join("src", "components")), ...files(join("src", "app"))];
  const uses = (name: string) => FILES.filter((f) => new RegExp(`<${name}\\b|\\b${name},|\\{ ${name} \\}|Icon: ${name}\\b`).test(readFileSync(f, "utf8"))).map((f) => f.replaceAll("\\", "/"));

  it("the game's icon set has no star and no crown, and no screen draws one from the bought set", () => {
    const set = readFileSync("src/components/game/ui/icons.tsx", "utf8");
    expect(set).not.toMatch(/^\s+(Star|Crown),$/m);
    for (const f of FILES) {
      const src = readFileSync(f, "utf8");
      expect(src, f).not.toMatch(/<(Star|Crown|StarFour|ShootingStar|CrownSimple)\b/);
    }
  });

  it("the bought sparkle is left only where it means Mint, and in the one step picture the owner has yet to choose", () => {
    // Mint's own icon (the rail, the phone's tab, the quick grid, a "Mint" button, the "get letters" step) is an
    // open choice of the audit's parts 5 and 6. A sparkle that is only decoration is the game's twinkle now.
    expect(uses("Sparkle").sort()).toEqual(
      [
        "src/components/game/GameApp.tsx",
        "src/components/game/NextSteps.tsx",
        "src/components/game/Onboarding.tsx",
        "src/components/game/QuickGrid.tsx",
        "src/components/game/TodayLetters.tsx",
        "src/components/game/TodayStage.tsx",
        "src/components/game/screens/BagScreen.tsx",
        "src/components/game/sheets/CheatSheet.tsx",
        "src/components/game/ui/icons.tsx",
        "src/components/landing/LandingPage.tsx",
      ].sort(),
    );
  });

  it("the bought confetti is left only in that step picture; the jackpot's burst is the letters' own confetti", () => {
    // the letter rig has a part of its own called Confetti: that is the engraved one
    expect(uses("Confetti").filter((f) => !f.endsWith("TileCharacter.tsx")).sort()).toEqual(["src/components/game/Onboarding.tsx", "src/components/game/ui/icons.tsx", "src/components/landing/LandingPage.tsx"]);
    const jackpot = readFileSync("src/components/game/screens/JackpotScreen.tsx", "utf8");
    expect(jackpot).not.toMatch(/<Confetti|animate-pop/);
    // the winner's card is shown with its letters cheering: their confetti is the celebration
    expect(jackpot).toContain('<SceneFrame scene={scene} word={word.word} upper={word.upper} state="celebrate" gild={gild} tier={word.tier} />');
    expect(jackpot).toContain("{ownedAnswer && <WonCard word={ownedAnswer} />}");
  });
});
