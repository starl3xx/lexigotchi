/**
 * The Dictionary's list (lib/dictionaryList; decisions.md #30): "Closest first" and the quick
 * filters. "Can spell" must be exactly Spell's list, and nothing may be sorted or counted by
 * distance when there is nothing to count.
 */
import { describe, it, expect } from "vitest";
import { WORDS } from "@/lib/dictionary";
import { wordTier } from "@/lib/economy";
import { closeness, listDictionary, type DictQuery, type EntryStatus } from "@/lib/dictionaryList";
import { bagTotals, distanceOf, type LetterBag } from "@/lib/wordNeed";
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
    expect(counts).toEqual({ can: tally[0], one: tally[1], two: tally[2] });
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

describe("nothing to count", () => {
  it("lists A to Z, and counts nothing, without distances", () => {
    const list = listDictionary(q({ sort: "closest" }), practiceStatus, null);
    expect(list.words).toEqual([...WORDS]);
    expect(list.counts).toEqual({ can: 0, one: 0, two: 0 });
    expect(listDictionary(q({ filter: "can" }), practiceStatus, null).words).toEqual([]);
  });

  it("never calls a word of unknown owner spellable", () => {
    const unknown = (): EntryStatus => "unknown";
    expect(listDictionary(q({ filter: "can" }), unknown, DIST).words).toEqual([]);
    expect(listDictionary(q(), unknown, DIST).counts).toEqual({ can: 0, one: 0, two: 0 });
  });
});

describe("how close a word is", () => {
  it("ranks a move closer than a mint, and anything open closer than a word someone has", () => {
    expect(closeness("open", { missing: 0, away: 0 })).toBe(0);
    expect(closeness("open", { missing: 0, away: 1 })).toBeLessThan(closeness("open", { missing: 1, away: 0 }));
    expect(closeness("open", { missing: 5, away: 0 })).toBeLessThan(closeness("sale", undefined));
    expect(closeness("sale", undefined)).toBeLessThan(closeness("taken", undefined));
    expect(closeness("taken", undefined)).toBeLessThan(closeness("mine", undefined));
  });
});
