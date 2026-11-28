/**
 * Waking a word, as rules (components/game/wake; decisions.md #64): the four beats, the act's
 * order and times, what a card holds while the wake is on its way, and that no letter is scaled.
 */
import { readFileSync } from "fs";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BLINK, BOW, RISE, WAKE, hopDelay, stirFrame, stirLetter, wakeActMs, wakeScore } from "@/components/game/wake/wakeFlow";
import { beginWake, currentWake, endWake, releaseWake, resetWake } from "@/components/game/wake/wakeRun";

const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const word = (w: string, daysUnfed: number) => ({ word: w, staked: true, daysUnfed });

describe("the wait: nothing looks awake before the chain says so", () => {
  it("a card holds every letter as it was", () => {
    expect(stirFrame(5, "hungry", null)).toEqual({ states: Array(5).fill("hungry"), armsUp: false, moments: Array(5).fill("") });
    expect(stirFrame(5, "peckish", null).states).toEqual(Array(5).fill("peckish"));
  });

  it("a sleeper half opens its eyes, one at a time; a sleepy letter blinks", () => {
    const peek = stirFrame(5, "hungry", 2);
    expect(peek.states).toEqual(["hungry", "hungry", "peckish", "hungry", "hungry"]);
    expect(peek.states).not.toContain("glad");
    expect(peek.states).not.toContain("idle");
    const blink = stirFrame(5, "peckish", 1);
    expect(blink.states).toEqual(Array(5).fill("peckish"));
    expect(blink.moments).toEqual(["", BLINK, "", "", ""]);
  });

  it("the letters stir out of order, never two beats on one letter, and never along the row", () => {
    const beats = Array.from({ length: 20 }, (_, k) => stirLetter(k, 5));
    for (const j of beats) expect(j).toBeGreaterThanOrEqual(0), expect(j).toBeLessThan(5);
    for (let k = 1; k < beats.length; k++) expect(beats[k]).not.toBe(beats[k - 1]);
    // a run of three neighbours in order would read as the wake itself
    for (let k = 2; k < beats.length; k++) expect(beats[k] - beats[k - 1] === 1 && beats[k - 1] - beats[k - 2] === 1).toBe(false);
    // a short word still gets a letter
    expect(stirLetter(3, 1)).toBe(0);
  });
});

describe("it lands: a wake, a stretch, and a bow", () => {
  const steps = wakeScore(5, "hungry", false);

  it("the wake passes along the word, a letter at a time, and each rises as it wakes", () => {
    for (let i = 0; i < 5; i++) {
      expect(steps[i].at).toBe(i * WAKE.step);
      expect(steps[i].frame!.states).toEqual([...Array(i + 1).fill("glad"), ...Array(4 - i).fill("hungry")]);
      expect(steps[i].frame!.moments).toEqual([...Array(i + 1).fill(RISE), ...Array(4 - i).fill("")]);
      expect(steps[i].frame!.armsUp).toBe(false);
    }
  });

  it("then they come down, raise their joined hands on their toes, bow with their eyes shut, and rest", () => {
    const [down, up, bow, rise, end] = steps.slice(5);
    expect(down.frame).toEqual({ states: Array(5).fill("glad"), armsUp: false, moments: Array(5).fill("") });
    expect(up.frame).toEqual({ states: Array(5).fill("glad"), armsUp: true, moments: Array(5).fill(RISE) });
    expect(bow.frame).toEqual({ states: Array(5).fill("glad"), armsUp: false, moments: Array(5).fill(BOW) });
    expect(BOW).toContain("tc-blink"); // the rig's own blink shuts the eyes
    expect(rise.frame!.moments).toEqual(Array(5).fill(""));
    expect(end.frame).toBeNull();
    expect(up.at - down.at).toBe(WAKE.breath);
    expect(bow.at - up.at).toBe(WAKE.up);
    expect(rise.at - bow.at).toBe(WAKE.bow);
    expect(end.at - rise.at).toBe(WAKE.rest);
  });

  it("the steps are in order, and the act is about two and a half seconds", () => {
    for (let k = 1; k < steps.length; k++) expect(steps[k].at).toBeGreaterThan(steps[k - 1].at);
    expect(wakeActMs(5, false)).toBe(4 * WAKE.step + WAKE.settle + WAKE.breath + WAKE.up + WAKE.bow + WAKE.rest);
    expect(wakeActMs(5, false)).toBeGreaterThan(2000);
    expect(wakeActMs(5, false)).toBeLessThan(3000);
  });

  it("a sleepy word wakes from its own look", () => {
    expect(wakeScore(5, "peckish", false)[1].frame!.states).toEqual(["glad", "glad", "peckish", "peckish", "peckish"]);
  });

  it("under reduced motion the letters still wake one by one, and nothing rises, lifts, or bows", () => {
    const quiet = wakeScore(5, "hungry", true);
    expect(quiet).toHaveLength(6);
    expect(quiet[4].frame!.states).toEqual(Array(5).fill("glad"));
    for (const s of quiet) {
      if (!s.frame) continue;
      expect(s.frame.armsUp).toBe(false);
      expect(s.frame.moments.join("")).toBe("");
    }
    expect(quiet.at(-1)).toEqual({ at: 4 * WAKE.step + WAKE.reducedHold, frame: null });
  });

  it("small cards take their turn one after another, and past the ninth they go together", () => {
    expect(hopDelay(0)).toBe(WAKE.hopFirst);
    expect(hopDelay(3) - hopDelay(2)).toBe(WAKE.hopStep);
    expect(hopDelay(40)).toBe(hopDelay(WAKE.hopCards - 1));
  });
});

describe("the wake in hand", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetWake();
  });
  afterEach(() => {
    resetWake();
    vi.useRealTimers();
  });
  it("remembers how each word looked when the player pressed Wake, and which word was in focus", () => {
    beginWake([word("VIVID", 3), word("CRANE", 1)], "VIVID");
    expect(currentWake()).toMatchObject({ words: ["VIVID", "CRANE"], before: { VIVID: "hungry", CRANE: "peckish" }, focus: "VIVID", phase: "waiting" });
  });

  it("landed: the act plays, and then the wake is let go", () => {
    const id = beginWake([word("VIVID", 3)], "VIVID");
    endWake(id, "landed");
    expect(currentWake()?.phase).toBe("landed");
    vi.advanceTimersByTime(wakeActMs(5, false) + 300);
    expect(currentWake()).toBeNull();
  });

  it("nothing sent, or sent and not seen: the letters settle back at once", () => {
    for (const outcome of ["none", "pending"] as const) {
      const id = beginWake([word("VIVID", 3)], "VIVID");
      endWake(id, outcome);
      expect(currentWake()).toBeNull();
    }
  });

  it("an older wake's ending never touches a newer wake", () => {
    const old = beginWake([word("VIVID", 3)], "VIVID");
    const next = beginWake([word("TEASE", 1)], null);
    endWake(old, "none");
    expect(currentWake()?.id).toBe(next);
  });

  it("a wake that woke only some words keeps only those: a word that stayed asleep has no part (Bugbot on #334)", () => {
    const id = beginWake([word("VIVID", 3), word("CRANE", 1), word("TEASE", 2)], "TEASE");
    endWake(id, "landed", false, ["VIVID"]);
    expect(currentWake()).toMatchObject({ words: ["VIVID"], phase: "landed", focus: null });
    // and none at all is no wake
    const none = beginWake([word("VIVID", 3)], "VIVID");
    endWake(none, "landed", false, []);
    expect(currentWake()).toBeNull();
  });

  it("a skipped bow lets the wake go, so Today stops holding the word on stage (Bugbot on #334)", () => {
    const id = beginWake([word("VIVID", 3)], "VIVID");
    releaseWake(id); // not while it is still on its way: the chain has not answered
    expect(currentWake()?.phase).toBe("waiting");
    endWake(id, "landed");
    releaseWake(id);
    expect(currentWake()).toBeNull();
  });

  it("a wallet that never answers does not leave the letters stirring for good", () => {
    beginWake([word("VIVID", 3)], "VIVID");
    vi.advanceTimersByTime(WAKE.giveUp + 10);
    expect(currentWake()).toBeNull();
  });
});

describe("no letter is scaled, and a small card's stance is kept", () => {
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ sel: m[1].trim(), body: m[2] })).filter((r) => /\.wk-/.test(r.sel));

  it("finds the wake's rules", () => expect(rules.length).toBe(7));

  it("a pointer resting on the word cannot cancel the rise or the bow: each rule outranks the hover's (Bugbot on #334)", () => {
    for (const part of ["tc-perk", "tc-perk-layer", "tc-legs-perk"]) {
      for (const moment of ["wk-rise", "wk-bow"]) {
        expect(css, `${moment} ${part}`).toContain(`.tc-perks:hover:not(:active) .${moment} .${part}`);
      }
    }
  });

  it("Today sets the next word's side while rendering, never in an effect (Bugbot on #334)", () => {
    const src = readFileSync(join(process.cwd(), "src/components/game/TodayStage.tsx"), "utf8");
    expect(src).toMatch(/if \(held !== heldSeen\) \{\s*setHeldSeen\(held\);\s*if \(heldSeen && !held\) setEnter\("next"\);/);
    expect(src).not.toMatch(/useEffect\(/);
  });

  it("a rise and a bow move the body, and only the legs stretch", () => {
    for (const r of rules) {
      if (/tc-legs-perk/.test(r.sel)) expect(r.body, r.sel).toMatch(/scaleY\(/);
      else expect(r.body, r.sel).not.toMatch(/scale|matrix/);
    }
  });

  it("the hop is the translate property, never a transform: a letter's stance on curved ground stays", () => {
    const hop = css.match(/@keyframes wk-hop\s*\{([\s\S]*?)\}\s*\}/)?.[1] ?? "";
    expect(hop).toMatch(/translate:/);
    expect(hop).not.toMatch(/transform|scale/);
  });

  it("all of it sits behind prefers-reduced-motion: no-preference", () => {
    const whole = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");
    const at = whole.indexOf(".wk-rise .tc-perk {");
    const media = whole.lastIndexOf("@media (prefers-reduced-motion: no-preference)", at);
    expect(media).toBeGreaterThan(-1);
    // nothing closes that block between its opening and the first wake rule
    expect(whole.slice(media, at)).not.toMatch(/\n\}/);
  });
});

describe("the old look is gone", () => {
  it("no eating state, no cookie, and no chew timer", () => {
    const rig = readFileSync(join(process.cwd(), "src/components/game/TileCharacter.tsx"), "utf8");
    expect(rig).not.toMatch(/"eating"/);
    expect(rig).not.toMatch(/function Snack/);
    expect(readFileSync(join(process.cwd(), "tailwind.config.ts"), "utf8")).not.toMatch(/tcEat|tc-eat/);
    for (const f of ["src/components/game/TodayStage.tsx", "src/components/game/sheets/WordSheet.tsx", "src/components/cards/WordSheetCard.tsx"]) {
      expect(readFileSync(join(process.cwd(), f), "utf8"), f).not.toMatch(/eating|EAT_MS|useEatingFlash/);
    }
  });

  it("every Wake button starts the wake through useWake, never the store's feed on its own", () => {
    for (const f of ["src/components/game/TodayStage.tsx", "src/components/game/sheets/WordSheet.tsx", "src/components/game/screens/BagScreen.tsx"]) {
      const src = readFileSync(join(process.cwd(), f), "utf8");
      expect(src, f).toMatch(/useWake\(\)/);
      expect(src, f).not.toMatch(/g\.feed(All)?\(/);
    }
  });
});
