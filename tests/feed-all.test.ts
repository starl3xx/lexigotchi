import { describe, expect, it } from "vitest";
import { feedAllLabel, wordsToFeed } from "@/components/game/feedAll";
import type { OwnedWord } from "@/components/game/state";

const w = (word: string, over: Partial<OwnedWord> = {}): OwnedWord =>
  ({ word, tier: "Common", upper: 0, staked: true, daysUnfed: 1, prestigeLevel: 0, prestigePity: 0, mine: true, ...over }) as OwnedWord;

describe("Feed all", () => {
  it("feeds staked words that aren't full, yours or a staker's you care for", () => {
    const words = [
      w("CRANE"), // peckish, mine
      w("VIVID", { daysUnfed: 4 }), // hungry, mine
      w("GRAPE", { daysUnfed: 0 }), // full: a snack for nothing
      w("BLAZE", { staked: false }), // unstaked: nothing to feed
      w("MOTEL", { mine: false, care: true }), // a staker's word this wallet cares for
      w("SPOON", { mine: false }), // another linked wallet's: it would revert the batch
    ];
    expect(wordsToFeed(words).map((x) => x.word)).toEqual(["CRANE", "VIVID", "MOTEL"]);
  });

  it("names one word, and counts more", () => {
    expect(feedAllLabel([w("CRANE")])).toBe("Wake CRANE");
    expect(feedAllLabel([w("CRANE"), w("VIVID"), w("MOTEL")])).toBe("Wake all 3");
  });
});
