/**
 * The Today stage (src/components/game/stagePick.ts): the word that needs the player most takes
 * the stage, and says so in one line.
 */
import { describe, it, expect } from "vitest";
import { emptyStageCase, pickStage, stageLine, stageLineup, upNext } from "@/components/game/stagePick";
import type { Hunger, OwnedWord } from "@/components/game/state";

const word = (w: string, o: Partial<OwnedWord> = {}): OwnedWord => ({
  word: w,
  tier: "Common",
  upper: [false, false, false, false, false],
  staked: true,
  daysUnfed: 0,
  prestigeLevel: 0,
  prestigePity: 0,
  mine: true,
  ...o,
});
const hungerOf = (w: OwnedWord): Hunger => (w.daysUnfed >= 3 ? "hungry" : w.daysUnfed >= 1 ? "peckish" : "fed");
const ALL_UP = [true, true, true, true, true];

describe("pickStage", () => {
  it("puts a hungry word ahead of a peckish one, and a peckish one ahead of a full one", () => {
    const pick = pickStage([word("TEASE"), word("CRANE", { daysUnfed: 1 }), word("VIVID", { daysUnfed: 3 })], hungerOf)!;
    expect(pick.word.word).toBe("VIVID");
    expect(pick.mood).toBe("hungry");
    expect(pick.others.map((o) => [o.word.word, o.mood])).toEqual([["CRANE", "peckish"], ["TEASE", "full"]]);
    expect(pick.needFood).toBe(2);
  });

  it("with everyone full, shows the best word: rarest, then most raised", () => {
    const pick = pickStage([word("ABBEY", { tier: "Rare" }), word("CRANE", { upper: [true, true, true, false, false] }), word("ABUZZ", { tier: "Mythic" })], hungerOf)!;
    expect(pick.word.word).toBe("ABUZZ");
    expect(pick.mood).toBe("full");
    expect(pick.others[0].word.word).toBe("ABBEY");
  });

  it("with nothing staked, the best word waits to be staked", () => {
    const pick = pickStage([word("MOTEL", { staked: false }), word("VIVID", { staked: false, upper: ALL_UP })], hungerOf)!;
    expect(pick).toMatchObject({ mood: "unstaked", needFood: 0, others: [] });
    expect(pick.word.word).toBe("VIVID");
  });

  it("never stages a linked wallet's word, and is empty with no words", () => {
    expect(pickStage([word("PIXEL", { mine: false, daysUnfed: 5 })], hungerOf)).toBeNull();
    expect(pickStage([], hungerOf)).toBeNull();
  });
});

describe("stageLineup (the ← and → arrows)", () => {
  it("starts with the star, walks the staked words neediest first, then the unstaked best first", () => {
    const { items, needFood } = stageLineup(
      [word("TEASE"), word("MOTEL", { staked: false }), word("CRANE", { daysUnfed: 1 }), word("VIVID", { daysUnfed: 3 }), word("ZESTY", { staked: false, upper: ALL_UP })],
      hungerOf,
    );
    expect(items.map((i) => [i.word.word, i.mood])).toEqual([
      ["VIVID", "hungry"],
      ["CRANE", "peckish"],
      ["TEASE", "full"],
      ["ZESTY", "unstaked"],
      ["MOTEL", "unstaked"],
    ]);
    expect(items[0].word.word).toBe(pickStage(items.map((i) => i.word), hungerOf)!.word.word);
    expect(needFood).toBe(2);
  });

  it("with nothing staked, lists the waiting words once each", () => {
    const { items } = stageLineup([word("MOTEL", { staked: false }), word("VIVID", { staked: false, upper: ALL_UP })], hungerOf);
    expect(items.map((i) => i.word.word)).toEqual(["VIVID", "MOTEL"]);
  });

  it("leaves out a linked wallet's words, and is empty with none", () => {
    expect(stageLineup([word("PIXEL", { mine: false }), word("TEASE")], hungerOf).items.map((i) => i.word.word)).toEqual(["TEASE"]);
    expect(stageLineup([], hungerOf)).toEqual({ items: [], needFood: 0 });
  });
});

describe("emptyStageCase (the stage with no word of the player's to show)", () => {
  const base = { loading: false, words: 0, mineWords: 0, letters: 0, canSpell: false };

  it("tells each kind of player the one step toward their first word", () => {
    expect(emptyStageCase(base)).toBe("start"); // brand new: no letters, no words
    expect(emptyStageCase({ ...base, letters: 3 })).toBe("more"); // letters, not enough to spell
    expect(emptyStageCase({ ...base, letters: 7, canSpell: true })).toBe("spell"); // letters that spell a word
  });

  it("never shows a returning player the newcomer's invitation while their words load", () => {
    expect(emptyStageCase({ ...base, loading: true })).toBe("loading");
    expect(emptyStageCase({ ...base, loading: true, letters: 7, canSpell: true })).toBe("loading");
  });

  it("says a failed read is a connection problem, not an empty bag", () => {
    expect(emptyStageCase({ ...base, error: true, letters: 7, canSpell: true })).toBe("error");
    expect(emptyStageCase({ ...base, loading: true, error: true })).toBe("loading");
  });

  it("knows the words are in a linked wallet, not missing", () => {
    expect(emptyStageCase({ ...base, words: 3, mineWords: 0, letters: 9, canSpell: true })).toBe("elsewhere");
  });
});

describe("upNext (the cards under the stage)", () => {
  it("shows up to three words after the featured one, wrapping around, never the featured one", () => {
    const five = ["A", "B", "C", "D", "E"];
    expect(upNext(five, 0, 3)).toEqual(["B", "C", "D"]);
    expect(upNext(five, 3, 3)).toEqual(["E", "A", "B"]);
    expect(upNext(["A", "B"], 1, 3)).toEqual(["A"]);
    expect(upNext(["A"], 0, 3)).toEqual([]);
    expect(upNext([], 0, 3)).toEqual([]);
  });
});

describe("stageLine", () => {
  it("says what the mood costs, and earning only for an all-UPPERCASE word", () => {
    expect(stageLine({ word: word("VIVID", { upper: ALL_UP }), mood: "hungry" })).toBe("VIVID is asleep. It can’t win or earn today.");
    expect(stageLine({ word: word("TEASE"), mood: "hungry" })).toBe("TEASE is asleep. It can’t win today.");
    expect(stageLine({ word: word("VIVID", { upper: ALL_UP }), mood: "peckish" })).toBe("VIVID is sleepy. It earns half until you wake it.");
    expect(stageLine({ word: word("TEASE"), mood: "full" })).toBe("TEASE is awake and in the daily jackpot.");
    expect(stageLine({ word: word("MOTEL"), mood: "unstaked" })).toBe("MOTEL is waiting. Stake it to enter the jackpot.");
  });
});

describe("a word for sale on the stage", () => {
  const forSale = new Set(["STORE"]);
  it("a word waiting to be staked takes the stage before a listed one", () => {
    const pick = pickStage([word("STORE", { staked: false, upper: ALL_UP }), word("FRESH", { staked: false })], hungerOf, forSale)!;
    expect(pick.word.word).toBe("FRESH");
    expect(pick.mood).toBe("unstaked");
  });

  it("when every word is listed, the star says it's for sale instead of asking to be staked", () => {
    const pick = pickStage([word("STORE", { staked: false })], hungerOf, forSale)!;
    expect(pick.mood).toBe("forSale");
    expect(stageLine(pick)).toBe("STORE is for sale in the Market.");
  });

  it("the lineup puts listed words last, marked for sale", () => {
    const { items } = stageLineup([word("STORE", { staked: false }), word("FRESH", { staked: false }), word("DOUGH")], hungerOf, forSale);
    expect(items.map((i) => [i.word.word, i.mood])).toEqual([["DOUGH", "full"], ["FRESH", "unstaked"], ["STORE", "forSale"]]);
  });
});
