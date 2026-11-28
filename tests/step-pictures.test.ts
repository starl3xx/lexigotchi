/**
 * The pictures beside the how-it-works steps (the intro and the landing page) and the landing
 * page's "They get hungry." (decisions.md #50, part 5): the letters act the step out, with no icon
 * standing between them. starl3xx: "yes to 3A, although I don't like the static cookie/circle
 * thing in this (or They get hungry)": so no letter is shown at its snack in these pictures.
 *
 * "Keep them fed" still has its trophy: no picture for it is chosen yet.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const intro = read("src/components/game/Onboarding.tsx");
const landing = read("src/components/landing/LandingPage.tsx");
/** The JSX of one step's picture: from its key to the next key. */
const picture = (src: string, key: string, next: string) => {
  const a = src.indexOf(`  ${key}: (`);
  const b = src.indexOf(`  ${next}:`, a);
  expect(a, key).toBeGreaterThan(0);
  expect(b, next).toBeGreaterThan(a);
  return src.slice(a, b);
};
const states = (jsx: string) => [...jsx.matchAll(/<TileCharacter [^>]*state="(\w+)"/g)].map((m) => m[1]);
/** Any component in the JSX that is not a letter: an icon. */
const others = (jsx: string) => [...jsx.matchAll(/<([A-Z]\w*)/g)].map((m) => m[1]).filter((n) => n !== "TileCharacter" && n !== "TileWord");

describe("the step pictures", () => {
  it("“Raise them” is three letters: a lowercase r, the r mid-roll, and the R it becomes", () => {
    for (const [name, src] of [["the intro", intro], ["the landing page", landing]] as const) {
      const raise = picture(src, "raise", "spell");
      expect(states(raise), name).toEqual(["idle", "rolling", "upgrade"]);
      expect(others(raise), name).toEqual([]);
      // the first two are the lowercase letter, the last the raised one
      expect(raise.match(/char="r"/g), name).toHaveLength(3);
      expect(raise.match(/\bupper\b/g), name).toHaveLength(1);
      // the letter mid-roll is out of step with the one beside it
      expect(raise, name).toMatch(/state="rolling" size=\{\d+\} index=\{1\}/);
    }
    // the same picture at two sizes: the raised letter is the bigger one in both
    const sizes = (src: string) => [...picture(src, "raise", "spell").matchAll(/size=\{(\d+)\}/g)].map((m) => Number(m[1]));
    for (const s of [sizes(intro), sizes(landing)]) {
      expect(s[0]).toBe(s[1]);
      expect(s[2]).toBeGreaterThan(s[1]);
    }
  });

  it("“They get hungry.” is a hungry letter and the letter fed, with nothing between them", () => {
    const a = landing.indexOf('title="They nod off."');
    const care = landing.slice(a, landing.indexOf("</Feature>", a));
    const visual = care.slice(care.indexOf("visual={"), care.indexOf("\n          >"));
    expect(states(visual)).toEqual(["hungry", "celebrate"]);
    expect(others(visual)).toEqual([]);
  });

  it("shows no letter at its snack in these pictures", () => {
    expect(intro).not.toMatch(/state="eating"/);
    expect(landing).not.toMatch(/state="eating"/);
  });
});
