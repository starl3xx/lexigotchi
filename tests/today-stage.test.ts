/**
 * The Today stage (src/components/game/stagePick.ts): the word that needs the player most takes
 * the stage, and says so in one line.
 */
import { describe, it, expect } from "vitest";
import { pickStage, stageLine } from "@/components/game/stagePick";
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

  it("with everyone full, shows the best word: most raised, then rarest", () => {
    const pick = pickStage([word("ABBEY", { tier: "Rare" }), word("CRANE", { upper: [true, true, true, false, false] }), word("ABUZZ", { tier: "Legendary" })], hungerOf)!;
    expect(pick.word.word).toBe("CRANE");
    expect(pick.mood).toBe("full");
    expect(pick.others[0].word.word).toBe("ABUZZ");
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

describe("stageLine", () => {
  it("says what the mood costs, and earning only for an all-UPPERCASE word", () => {
    expect(stageLine({ word: word("VIVID", { upper: ALL_UP }), mood: "hungry" })).toBe("VIVID is hungry. It can’t win or earn today.");
    expect(stageLine({ word: word("TEASE"), mood: "hungry" })).toBe("TEASE is hungry. It can’t win today.");
    expect(stageLine({ word: word("VIVID", { upper: ALL_UP }), mood: "peckish" })).toBe("VIVID is peckish. It earns half until you feed it.");
    expect(stageLine({ word: word("TEASE"), mood: "full" })).toBe("TEASE is full and in the daily jackpot.");
    expect(stageLine({ word: word("MOTEL"), mood: "unstaked" })).toBe("MOTEL is waiting. Stake it to enter the jackpot.");
  });
});
