import { describe, it, expect } from "vitest";
import { computeAchievements, ACHIEVEMENT, DICTIONARY_MILESTONES } from "@/lib/keeper/achievements";
import { LETTERS_BY_FREQUENCY, ALPHABET } from "@/lib/economy";
import { WORD_COUNT } from "@/lib/dictionary";
import type { KeeperWord } from "@/lib/keeper/shares";

const A = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as const;
const word = (n: number, over: Partial<KeeperWord> = {}): KeeperWord => ({
  tokenId: BigInt(n), word: "ABOUT", owner: A, staked: false, daysUnfed: 0,
  prestigeLevel: 0, upperAll: false, ...over,
});
const counts = (idx: number[], upper = false) => {
  const a = Array.from({ length: 52 }, () => 0);
  for (const i of idx) a[i + (upper ? 26 : 0)] = 1;
  return a;
};
const grailIdx = ALPHABET.indexOf(LETTERS_BY_FREQUENCY[LETTERS_BY_FREQUENCY.length - 1]);
const commonIdx = ALPHABET.indexOf(LETTERS_BY_FREQUENCY[0]);

describe("computeAchievements", () => {
  it("FIRST_WORD for any word owner; nothing for the wordless", () => {
    const out = computeAchievements([word(1)], new Map());
    expect(out).toContainEqual({ recipient: A, achievement: ACHIEVEMENT.FIRST_WORD, value: 1 });
    expect(computeAchievements([], new Map())).toEqual([]);
  });

  it("FIRST_GRAIL only for grail letters — either case; commons never qualify", () => {
    const holders = new Map([
      [A, counts([grailIdx])],
      ["0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", counts([commonIdx])],
      ["0xcccccccccccccccccccccccccccccccccccccccc", counts([grailIdx], true)], // UPPERCASE grail
    ]);
    const out = computeAchievements([], holders);
    const grails = out.filter((a) => a.achievement === ACHIEVEMENT.FIRST_GRAIL);
    expect(grails.map((g) => g.recipient)).toEqual([
      A, "0xcccccccccccccccccccccccccccccccccccccccc",
    ]);
  });

  it("ASCENDED needs prestige ≥ 1", () => {
    const out = computeAchievements([word(1, { prestigeLevel: 1 })], new Map());
    expect(out.some((a) => a.achievement === ACHIEVEMENT.ASCENDED)).toBe(true);
    expect(computeAchievements([word(1)], new Map()).some((a) => a.achievement === ACHIEVEMENT.ASCENDED)).toBe(false);
  });

  it("DICTIONARY_PCT attests every milestone reached, none beyond", () => {
    const five = Math.ceil(WORD_COUNT * 0.05); // enough for the 5% milestone
    const words = Array.from({ length: five }, (_, i) => word(i + 1));
    const out = computeAchievements(words, new Map());
    const pcts = out.filter((a) => a.achievement === ACHIEVEMENT.DICTIONARY_PCT).map((a) => a.value);
    expect(pcts).toEqual([1, 5]);
    expect(DICTIONARY_MILESTONES).toContain(5);
  });

  it("is deterministic and sorted — re-runs must propose the identical set", () => {
    const holders = new Map([[A, counts([grailIdx])]]);
    const a = computeAchievements([word(2), word(1)], holders);
    const b = computeAchievements([word(1), word(2)], holders);
    expect(a).toEqual(b);
  });
});
