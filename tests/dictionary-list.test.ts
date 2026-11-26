/**
 * The Dictionary's list (lib/dictionaryList; decisions.md #31): "Closest first" and the quick
 * filters. "Can spell" must be exactly Spell's list, and nothing may be sorted or counted by
 * distance when there is nothing to count.
 */
import { describe, it, expect } from "vitest";
import { WORDS } from "@/lib/dictionary";
import { wordTier } from "@/lib/economy";
import { closeness, entryStatus, isTaken, listDictionary, type DictQuery, type EntryStatus, type WordHolders } from "@/lib/dictionaryList";
import { bagTotals, distanceOf, elsewhereTotals, finishedBy, type Distance, type LetterBag } from "@/lib/wordNeed";
import { oneLetterShort } from "@/lib/market/deals";
import { spellableNow } from "@/components/game/state";

const bag = (lower: string, upper = ""): LetterBag => {
  const l = new Array(26).fill(0);
  const u = new Array(26).fill(0);
  for (const c of lower.toUpperCase()) l[c.charCodeAt(0) - 65]++;
  for (const c of upper.toUpperCase()) u[c.charCodeAt(0) - 65]++;
  return { lower: l, upper: u };
};
// the practice game: its seed bag, its four words, and nobody else
const PRACTICE = bag("AABCDEEGINOLRSTTU", "RE");
const MINE = new Set(["TEASE", "CRANE", "MOTEL", "VIVID"]);
const practiceStatus = (w: string): EntryStatus => (MINE.has(w) ? "mine" : "open");
const DIST = WORDS.map((w) => distanceOf(w, bagTotals(PRACTICE), null));
const q = (over: Partial<DictQuery> = {}): DictQuery => ({ query: "", tier: "All", filter: "all", sort: "closest", ...over });

describe("closest first", () => {
  const { words, counts } = listDictionary(q(), practiceStatus, DIST);

  it("lists every word once", () => {
    expect(words).toHaveLength(WORDS.length);
    expect(new Set(words).size).toBe(WORDS.length);
  });

  it("puts what the player can spell first, then one away, then two, and their own words last", () => {
    const missing = words.map((w) => (MINE.has(w) ? 99 : DIST[WORDS.indexOf(w)].missing));
    expect([...missing].sort((a, b) => a - b)).toEqual(missing);
    expect(missing[0]).toBe(0);
    expect(words.slice(-4).sort()).toEqual([...MINE].sort());
  });

  it("puts the rarest first within the same distance", () => {
    const oneAway = words.filter((w) => !MINE.has(w) && DIST[WORDS.indexOf(w)].missing === 1);
    expect(wordTier(oneAway[0])).toBe("Mythic");
    expect(wordTier(oneAway[oneAway.length - 1])).toBe("Common");
  });

  it("counts the unclaimed words by distance", () => {
    const tally = [0, 0, 0];
    WORDS.forEach((w, i) => {
      if (!MINE.has(w) && DIST[i].missing < 3) tally[DIST[i].missing]++;
    });
    expect(counts).toEqual({ can: tally[0], one: tally[1], two: tally[2], letter: 0 });
  });
});

describe("the quick filters", () => {
  it("“Can spell” is exactly Spell’s list", () => {
    const can = listDictionary(q({ filter: "can", sort: "az" }), practiceStatus, DIST).words;
    expect(can).toEqual(spellableNow(PRACTICE.lower, PRACTICE.upper, MINE, Infinity));
  });

  it("“One away” and “Two away” hold only unclaimed words at that distance", () => {
    for (const [filter, n] of [["one", 1], ["two", 2]] as const) {
      const list = listDictionary(q({ filter }), practiceStatus, DIST).words;
      expect(list.length).toBeGreaterThan(0);
      for (const w of list) expect(DIST[WORDS.indexOf(w)].missing, w).toBe(n);
    }
  });

  it("splits claimed from unclaimed, and a word someone has is never “can spell”", () => {
    const status = (w: string): EntryStatus => (w === "ABOUT" ? "taken" : w === "ABODE" ? "sale" : practiceStatus(w));
    expect(listDictionary(q({ filter: "claimed", sort: "az" }), status, DIST).words).toEqual(["ABODE", "ABOUT", "CRANE", "MOTEL", "TEASE", "VIVID"]);
    const can = listDictionary(q({ filter: "can" }), status, DIST).words;
    expect(can).not.toContain("ABOUT");
    expect(can).not.toContain("ABODE");
    expect(listDictionary(q({ filter: "unclaimed" }), status, DIST).words).toHaveLength(WORDS.length - 6);
  });

  it("keeps to the search and the rarity", () => {
    const list = listDictionary(q({ query: "qu", tier: "Mythic" }), practiceStatus, DIST);
    expect(list.words.length).toBeGreaterThan(0);
    for (const w of list.words) {
      expect(w).toContain("QU");
      expect(wordTier(w)).toBe("Mythic");
    }
    // the counts follow the search too, so a chip's number is what tapping it shows
    expect(list.counts.one).toBe(listDictionary(q({ query: "qu", tier: "Mythic", filter: "one" }), practiceStatus, DIST).words.length);
  });
});

describe("“Only needs a q”: the Market's link", () => {
  const Q = 16;
  const unclaimed = WORDS.filter((w) => practiceStatus(w) === "open");

  it("shows exactly the words the Market counted for that letter", () => {
    // the Market's number ("A q finishes QUINT, and N more words") and the cards its link lands on
    const market = oneLetterShort(PRACTICE, PRACTICE, unclaimed);
    for (const letter of [Q, 25, 23, 14]) {
      const list = listDictionary(q({ filter: "letter", letter, sort: "az" }), practiceStatus, DIST);
      expect(list.words, String(letter)).toEqual([...(market.get(letter) ?? [])].sort());
      expect(list.counts.letter).toBe(list.words.length);
    }
    expect(listDictionary(q({ filter: "letter", letter: Q }), practiceStatus, DIST).words).toContain("QUINT");
  });

  it("opens on the rarest, the word the Market named", () => {
    const market = oneLetterShort(PRACTICE, PRACTICE, unclaimed);
    const list = listDictionary(q({ filter: "letter", letter: Q }), practiceStatus, DIST).words;
    expect(list).toEqual(market.get(Q));
  });

  it("counts the letter under any filter, so the chip's number is what tapping it shows", () => {
    const all = listDictionary(q({ letter: Q }), practiceStatus, DIST);
    expect(all.words).toHaveLength(WORDS.length);
    expect(all.counts.letter).toBe(finishedBy("q", WORDS, PRACTICE, (w) => MINE.has(w)).length);
    expect(listDictionary(q(), practiceStatus, DIST).counts.letter).toBe(0); // no letter asked about
  });

  it("leaves out a word someone has, and a word that needs a move too", () => {
    const status = (w: string): EntryStatus => (w === "QUINT" ? "sale" : practiceStatus(w));
    expect(listDictionary(q({ filter: "letter", letter: Q }), status, DIST).words).not.toContain("QUINT");
    // the same bag with its t's in another wallet: QUINT needs a q AND a move, so a q doesn't finish it
    const here = bag("AABCDEEGINOLRSU", "RE");
    const dist = WORDS.map((w) => distanceOf(w, bagTotals(here), elsewhereTotals(here, PRACTICE)));
    expect(listDictionary(q({ filter: "letter", letter: Q }), practiceStatus, dist).words).not.toContain("QUINT");
    expect(listDictionary(q({ filter: "one" }), practiceStatus, dist).words).toContain("QUINT"); // still one away
  });
});

describe("who has a word", () => {
  const ME = "0xme";
  const OTHER = "0xother";
  const known = (over: Partial<WordHolders> = {}): WordHolders => ({
    owned: new Set(["CRANE"]),
    owners: { CRANE: ME, ABOUT: OTHER, ABODE: OTHER, DEPTH: "0xmine2" },
    wallets: new Set([ME, "0xmine2"]),
    listed: new Map([["ABODE", false]]),
    ownersKnown: true,
    ...over,
  });

  it("reads the bag, the world, and the Market's board", () => {
    const k = known();
    expect(entryStatus("CRANE", k)).toBe("mine"); // in the bag
    expect(entryStatus("DEPTH", k)).toBe("mineAway"); // the player's, in a wallet the bag doesn't hold
    expect(entryStatus("ABOUT", k)).toBe("taken");
    expect(entryStatus("ABODE", k)).toBe("sale");
    expect(entryStatus("QUINT", k)).toBe("open");
  });

  it("a word on the board has an owner, its seller, before the world read knows it (decisions.md #32)", () => {
    // claimed and listed in the last minute: the world read has no owner for it yet
    const k = known({ listed: new Map([["QUINT", false], ["ZEBRA", true]]) });
    expect(entryStatus("QUINT", k)).toBe("sale");
    expect(entryStatus("ZEBRA", k)).toBe("mineAway"); // listed from another of the player's wallets
    // the practice game: no world read at all, and a stall of other sellers
    const practice: WordHolders = { owned: new Set(), wallets: new Set(), listed: new Map([["JAZZY", false]]), ownersKnown: true };
    expect(entryStatus("JAZZY", practice)).toBe("sale");
    expect(entryStatus("QUINT", practice)).toBe("open");
    // the player's own listing is in their bag: it stays theirs
    expect(entryStatus("CRANE", known({ listed: new Map([["CRANE", true]]) }))).toBe("mine");
  });

  it("never calls a word unclaimed before the owners are known, but a listed one is known to be for sale", () => {
    const waiting = known({ owners: undefined, ownersKnown: false, listed: new Map([["ABODE", false]]) });
    expect(entryStatus("QUINT", waiting)).toBe("unknown");
    expect(entryStatus("ABODE", waiting)).toBe("sale");
    expect(entryStatus("CRANE", waiting)).toBe("mine");
  });

  it("says which words a claim would revert on: Spell and “Can spell” leave them out alike", () => {
    expect((["taken", "sale", "mineAway"] as EntryStatus[]).every(isTaken)).toBe(true);
    expect((["open", "unknown", "mine"] as EntryStatus[]).some(isTaken)).toBe(false);
    // the Dictionary's "Can spell", with a word on the board, is Spell's list with the same word left out
    const holders: WordHolders = { owned: MINE, wallets: new Set(), listed: new Map([["TIGER", false], ["OCEAN", false]]), ownersKnown: true };
    const status = (w: string) => entryStatus(w, holders);
    const can = listDictionary(q({ filter: "can", sort: "az" }), status, DIST).words;
    const spell = spellableNow(PRACTICE.lower, PRACTICE.upper, MINE, Infinity).filter((w) => !isTaken(status(w)));
    expect(can).toEqual(spell);
    expect(can).not.toContain("TIGER");
    expect(spellableNow(PRACTICE.lower, PRACTICE.upper, MINE, Infinity)).toContain("TIGER"); // the letters do spell it
  });
});

describe("nothing to count", () => {
  it("lists A to Z, and counts nothing, without distances", () => {
    const list = listDictionary(q({ sort: "closest" }), practiceStatus, null);
    expect(list.words).toEqual([...WORDS]);
    expect(list.counts).toEqual({ can: 0, one: 0, two: 0, letter: 0 });
    expect(listDictionary(q({ filter: "can" }), practiceStatus, null).words).toEqual([]);
    expect(listDictionary(q({ filter: "letter", letter: 16 }), practiceStatus, null).words).toEqual([]);
  });

  it("never calls a word of unknown owner spellable", () => {
    const unknown = (): EntryStatus => "unknown";
    expect(listDictionary(q({ filter: "can" }), unknown, DIST).words).toEqual([]);
    expect(listDictionary(q({ letter: 16 }), unknown, DIST).counts).toEqual({ can: 0, one: 0, two: 0, letter: 0 });
  });
});

describe("how close a word is", () => {
  it("ranks a move closer than a mint, and anything open closer than a word someone has", () => {
    const at = (missing: number, away: number): Distance => ({ missing, away, letter: -1 });
    expect(closeness("open", at(0, 0))).toBe(0);
    expect(closeness("open", at(0, 1))).toBeLessThan(closeness("open", at(1, 0)));
    expect(closeness("open", at(5, 0))).toBeLessThan(closeness("sale", undefined));
    expect(closeness("sale", undefined)).toBeLessThan(closeness("taken", undefined));
    expect(closeness("taken", undefined)).toBeLessThan(closeness("mine", undefined));
  });
});
