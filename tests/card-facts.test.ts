/**
 * The back of a word's card (lib/cardFacts): who found it, since when it's yours, and the facts
 * worked out from the word itself.
 */
import { describe, it, expect } from "vitest";
import {
  ascensionLabel,
  cardDigits,
  cardNo,
  cardNumber,
  caseLabel,
  cardDate,
  earnsStaked,
  madeOrder,
  practiceNumbers,
  foundBy,
  shortTokenId,
  wordPoints,
  yoursSince,
  type Custody,
} from "@/lib/cardFacts";
import { TIER_WEIGHT, wordTier } from "@/lib/economy";
import { DEFAULT_PARAMS } from "@/lib/params";
import { tokenIdHexOf } from "@/lib/onchain/tokenId";

const ZERO = "0x0000000000000000000000000000000000000000";
const ME = "0xaaaa000000000000000000000000000000000001";
const MY_OTHER = "0xaaaa000000000000000000000000000000000002";
const THEM = "0xbbbb000000000000000000000000000000000003";
const mine = new Set([ME, MY_OTHER]);
const t = (from: string, to: string, at: number): Custody => ({ from, to, at });

describe("yours since", () => {
  it("is the day you claimed it", () => {
    expect(yoursSince([t(ZERO, ME, 100)], mine)).toBe(100);
  });

  it("keeps the date when it moves between your own wallets", () => {
    expect(yoursSince([t(ZERO, ME, 100), t(ME, MY_OTHER, 200), t(MY_OTHER, ME, 300)], mine)).toBe(100);
  });

  it("is the day you bought it, not the day someone else claimed it", () => {
    expect(yoursSince([t(ZERO, THEM, 100), t(THEM, ME, 250)], mine)).toBe(250);
  });

  it("starts over when it leaves and comes back", () => {
    expect(yoursSince([t(ZERO, ME, 100), t(ME, THEM, 200), t(THEM, ME, 300)], mine)).toBe(300);
  });

  it("starts over after a dissolve and a new claim", () => {
    expect(yoursSince([t(ZERO, ME, 100), t(ME, ZERO, 200), t(ZERO, ME, 400)], mine)).toBe(400);
  });

  it("is nothing once it's someone else's, or never was yours", () => {
    expect(yoursSince([t(ZERO, ME, 100), t(ME, THEM, 200)], mine)).toBeNull();
    expect(yoursSince([t(ZERO, THEM, 100)], mine)).toBeNull();
    expect(yoursSince([], mine)).toBeNull();
  });

  it("reads addresses in any case", () => {
    expect(yoursSince([t(ZERO, ME.toUpperCase().replace("0X", "0x"), 100)], mine)).toBe(100);
  });
});

describe("found by", () => {
  it("is the first claim's owner, even after a dissolve and someone else's claim", () => {
    expect(foundBy([{ owner: ME, at: 1 }, { owner: THEM, at: 9 }], mine)).toEqual({ kind: "you" });
    expect(foundBy([{ owner: THEM, at: 1 }, { owner: ME, at: 9 }], mine)).toEqual({ kind: "other", address: THEM });
  });

  it("is never 'you' when nothing has been read", () => {
    expect(foundBy(undefined, mine)).toEqual({ kind: "unknown" });
    expect(foundBy([], mine)).toEqual({ kind: "unknown" });
  });
});

describe("earns staked", () => {
  const up = [true, true, true, true, true];
  const crane = { word: "CRANE", upper: up, prestigeLevel: 0, daysUnfed: 0 };
  const weight = TIER_WEIGHT[wordTier("CRANE")];

  it("counts a staked word once: alone in the pot, it takes all of it", () => {
    // the pot's weight is this word's own: it is already counted (Bugbot on #211)
    expect(earnsStaked({ ...crane, staked: true }, { pot: 1000, weight }, wordTier)).toBeCloseTo(1000);
  });

  it("adds a word not staked yet to the words already sharing", () => {
    expect(earnsStaked({ ...crane, staked: false }, { pot: 1000, weight }, wordTier)).toBeCloseTo(500);
  });

  it("estimates a peckish staked word fed again (its half weight comes out, its full weight goes in)", () => {
    const peckish = { ...crane, staked: true, daysUnfed: DEFAULT_PARAMS.care.peckishAfterDays };
    const half = weight * DEFAULT_PARAMS.care.peckishYieldFactor;
    expect(earnsStaked(peckish, { pot: 1000, weight: half + weight }, wordTier)).toBeCloseTo(500);
  });

  it("says a word not yet UPPERCASE can't earn", () => {
    expect(earnsStaked({ ...crane, upper: [true, false, true, true, true], staked: true }, { pot: 1000, weight }, wordTier)).toBeNull();
  });
});

describe("the word's own facts", () => {
  it("says its case", () => {
    expect(caseLabel([false, false, false, false, false])).toBe("lowercase");
    expect(caseLabel([true, true, true, true, true])).toBe("UPPERCASE");
    expect(caseLabel([true, false, true, false, false])).toBe("Mixed · 2 of 5 raised");
  });

  it("says its stage on the ladder", () => {
    expect(ascensionLabel(0)).toBe("Not ascended");
    expect(ascensionLabel(3)).toBe("Gilded 3");
    expect(ascensionLabel(5)).toBe("Holographic");
  });

  it("writes its number with four digits, and a dash while it's unknown", () => {
    expect(cardNumber(1)).toBe("#0001");
    expect(cardNumber(42)).toBe("#0042");
    expect(cardNumber(4584)).toBe("#4584");
    expect(cardNumber(null)).toBe("#–");
    expect(cardNumber(0)).toBe("#–");
    // as the card letters it: "No. 0042" on the front's ribbon, the digits alone as the back's
    // headline; and nothing at all while the number isn't known (never a dash that reads as a number)
    expect(cardNo(42)).toBe("No. 0042");
    expect(cardDigits(42)).toBe("0042");
    for (const unknown of [null, undefined, 0]) {
      expect(cardNo(unknown)).toBeNull();
      expect(cardDigits(unknown)).toBeNull();
    }
  });

  it("numbers words in the order they were first made, not A to Z or by rarity", () => {
    const at = (word: string, block: bigint, index: number) => ({ word, block, index });
    // logs out of order, two in one block, and a word claimed again after a dissolve
    const n = madeOrder([
      at("JAZZY", 30n, 0),
      at("crane", 10n, 4),
      at("ABOUT", 10n, 2),
      at("CRANE", 40n, 1), // spelled again: keeps #2
      at("ZESTY", 20n, 0),
    ]);
    expect(n).toEqual({ ABOUT: 1, CRANE: 2, ZESTY: 3, JAZZY: 4 });
  });

  it("numbers the practice game's words by when each came to the player", () => {
    expect(
      practiceNumbers([
        { word: "TEASE", since: 300 },
        { word: "CRANE", since: 100 },
        { word: "MOTEL", since: 200 },
      ]),
    ).toEqual({ CRANE: 1, MOTEL: 2, TEASE: 3 });
  });

  it("adds up its letters' points", () => {
    expect(wordPoints("JAZZY")).toBe(8 + 1 + 10 + 10 + 4);
    expect(wordPoints("crane")).toBe(3 + 1 + 1 + 1 + 1);
  });

  it("shortens its token id from the id itself", () => {
    const full = tokenIdHexOf("CRANE");
    expect(shortTokenId("crane")).toBe(`${full.slice(0, 6)}…${full.slice(-4)}`);
  });

  it("writes a day the same everywhere (UTC)", () => {
    expect(cardDate(Date.UTC(2026, 10, 25, 23, 59) / 1000)).toBe("25 Nov 2026");
  });
});
