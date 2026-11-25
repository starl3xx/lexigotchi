/**
 * The back of a word's card (lib/cardFacts): who found it, since when it's yours, and the facts
 * worked out from the word itself.
 */
import { describe, it, expect } from "vitest";
import {
  DICTIONARY_SIZE,
  ascensionLabel,
  caseLabel,
  cardDate,
  dictionaryNumber,
  foundBy,
  shortTokenId,
  wordPoints,
  yoursSince,
  type Custody,
} from "@/lib/cardFacts";
import { WORDS } from "@/lib/dictionary";
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

  it("numbers it by its place in the dictionary, A to Z", () => {
    expect(dictionaryNumber(WORDS[0])).toBe(1);
    expect(dictionaryNumber(WORDS[WORDS.length - 1].toLowerCase())).toBe(DICTIONARY_SIZE);
    expect(dictionaryNumber("ZZZZZ")).toBe(0);
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
