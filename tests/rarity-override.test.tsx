/**
 * @vitest-environment jsdom
 *
 * The collab layer on a word's rarity (lib/rarity.ts; decisions.md, "Collab sets", item 2): a word
 * of a collab set is Legendary from its set's REVEAL, everywhere a rarity is shown, counted, or
 * paid; a word whose own rarity is higher keeps it; and the derived tier stays what supply, odds,
 * and the simulator use. The last test here lists every file that still reads the derived tier.
 */
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { WORD_COUNT } from "@/lib/dictionary";
import { MYTHICS, RANKED_WORDS, TIER_COUNTS, TIER_WEIGHT, TIERS, wordTier, wordsByTier, type Tier } from "@/lib/economy";
import { COLLAB_TIER, NO_COLLAB, collabWordsOf, raisedByCollab, tierCountsWith, tierFn, tierWith } from "@/lib/rarity";
import { STANDARD_FIELDS, publicSets, type WordSet } from "@/lib/sets/rules";
import { bountyLeaves, yieldLeaves, yieldWeight, type KeeperWord } from "@/lib/keeper/shares";
import { epochTiers } from "@/lib/keeper/tiers";
import { dailyEarnEstimate } from "@/lib/wordCost";
import { earnsStaked, tierCount } from "@/lib/cardFacts";
import { filterWords, oneLetterShort, pickDeals, rarestFirst, rarestFirstBy, sortWords, tierLowest, type WordForSale } from "@/lib/market/deals";
import { listDictionary } from "@/lib/dictionaryList";
import { saleOfFill } from "@/lib/market/sales";
import { tokenIdOf } from "@/lib/onchain/tokenId";
import { DEFAULT_PARAMS } from "@/lib/params";

const COMMON = wordsByTier("Common")[0];
const RARE = wordsByTier("Rare")[0];
const LEGEND = wordsByTier("Legendary")[0];
const MYTHIC = MYTHICS[0];
/** A collab set's five words: three below Legendary, one Legendary, one Mythic. */
const FIVE = [COMMON, wordsByTier("Uncommon")[0], RARE, LEGEND, MYTHIC];
const collab = new Set(FIVE);

function setOf(status: WordSet["status"], type: WordSet["type"], words: string[]): WordSet {
  return {
    id: 1, name: "S", status, revealAt: null, releaseAt: null, gateHours: 24, perPlayerLimit: 1, sort: 0,
    revealedAt: null, releasedAt: null, gateUntil: null, releaseBlock: null, releaseRoot: null,
    words: words.map((word) => ({ word, headliner: false })),
    ...STANDARD_FIELDS, type,
    ...(type === "collab" ? { partnerName: "Partner", colorA: "#112233", colorB: "#aabbcc", stampAt: new Date(0) } : {}),
  };
}

describe("the tier the game treats a word as", () => {
  it("a collab word below Legendary is Legendary; its own tier is still there to ask for", () => {
    expect(wordTier(COMMON)).toBe("Common");
    expect(tierWith(COMMON, collab)).toBe("Legendary");
    expect(tierWith(RARE, collab)).toBe("Legendary");
    expect(tierWith(COMMON.toLowerCase(), collab)).toBe("Legendary");
    expect(wordTier(COMMON)).toBe("Common"); // the derived tier never moves
    expect(COLLAB_TIER).toBe("Legendary");
  });
  it("a word whose own rarity is higher keeps it", () => {
    expect(tierWith(MYTHIC, collab)).toBe("Mythic");
    expect(tierWith(LEGEND, collab)).toBe("Legendary");
    expect(raisedByCollab(MYTHIC, collab)).toBe(false);
    expect(raisedByCollab(LEGEND, collab)).toBe(false);
    expect(raisedByCollab(COMMON, collab)).toBe(true);
  });
  it("a word in no collab set is what it always was", () => {
    const other = wordsByTier("Common")[1];
    expect(tierWith(other, collab)).toBe("Common");
    for (const r of RANKED_WORDS.filter((_, i) => i % 97 === 0)) expect(tierWith(r.word, NO_COLLAB)).toBe(wordTier(r.word));
    expect(tierFn(NO_COLLAB)).toBe(wordTier); // no collab words: the derived function itself
  });
});

describe("the override applies from the reveal, and not before", () => {
  it("on the server: a draft collab raises nothing; a revealed or released one raises its words", () => {
    expect(collabWordsOf([setOf("draft", "collab", FIVE)]).size).toBe(0);
    expect([...collabWordsOf([setOf("revealed", "collab", FIVE)])].sort()).toEqual([...FIVE].sort());
    expect(collabWordsOf([setOf("released", "collab", FIVE)]).size).toBe(5);
    expect(collabWordsOf([setOf("revealed", "standard", FIVE)]).size).toBe(0); // a standard set never does
    expect(tierWith(COMMON, collabWordsOf([setOf("draft", "collab", FIVE)]))).toBe("Common");
  });
  it("in the game: the same answer from what a browser is told, which holds nothing of a draft", () => {
    const told = (s: WordSet) => collabWordsOf(publicSets([s]));
    expect(told(setOf("draft", "collab", FIVE)).size).toBe(0);
    expect([...told(setOf("revealed", "collab", FIVE))].sort()).toEqual([...FIVE].sort());
    expect(told(setOf("released", "collab", FIVE)).size).toBe(5);
    expect(told(setOf("released", "standard", FIVE)).size).toBe(0);
  });
});

describe("tier counts come from the same rule", () => {
  it("a raised word counts in Legendary and no longer in its own tier; the total never moves", () => {
    const counts = tierCountsWith(collab);
    expect(counts.Legendary).toBe(TIER_COUNTS.Legendary + 3);
    expect(counts.Common).toBe(TIER_COUNTS.Common - 1);
    expect(counts.Uncommon).toBe(TIER_COUNTS.Uncommon - 1);
    expect(counts.Rare).toBe(TIER_COUNTS.Rare - 1);
    expect(counts.Mythic).toBe(TIER_COUNTS.Mythic);
    expect(Object.values(counts).reduce((a, b) => a + b, 0)).toBe(WORD_COUNT);
    expect(tierCountsWith(NO_COLLAB)).toEqual({ ...TIER_COUNTS });
  });
  it("is exactly a count of `tierWith` over the whole dictionary", () => {
    const tally = Object.fromEntries(TIERS.map((t) => [t.name, 0])) as Record<Tier, number>;
    for (const r of RANKED_WORDS) tally[tierWith(r.word, collab)] += 1;
    expect(tierCountsWith(collab)).toEqual(tally);
    expect(tierCount("Legendary", tierCountsWith(collab))).toBe(TIER_COUNTS.Legendary + 3); // what a card's back says
  });
});

describe("earnings and bounty weights use the override", () => {
  const A = "0x00000000000000000000000000000000000000a1";
  const mk = (word: string, tokenId: bigint): KeeperWord =>
    ({ tokenId, word, owner: A, staked: true, upperAll: true, daysUnfed: 0, prestigeLevel: 0 }) as unknown as KeeperWord;
  const tier = tierFn(collab);
  const plain = wordsByTier("Common")[1];

  it("the daily yield pays a collab word a Legendary's share", () => {
    const POT = 10n ** 24n;
    const leaves = yieldLeaves([mk(COMMON, 1n), mk(plain, 2n)], POT, tier);
    const ratio = Number(leaves.find((l) => l.tokenId === 1n)!.amount) / Number(leaves.find((l) => l.tokenId === 2n)!.amount);
    expect(ratio).toBeCloseTo(TIER_WEIGHT.Legendary / TIER_WEIGHT.Common, 3);
    // and with the derived tiers the two Common words split evenly
    const even = yieldLeaves([mk(COMMON, 1n), mk(plain, 2n)], POT, wordTier);
    expect(even[0].amount).toBe(even[1].amount);
    expect(yieldWeight(mk(COMMON, 1n), tier)).toBe(TIER_WEIGHT.Legendary);
    expect(yieldWeight(mk(MYTHIC, 3n), tier)).toBe(TIER_WEIGHT.Mythic); // the higher rarity is kept
  });
  it("the bounty weighs it as Legendary too", () => {
    const POT = 10n ** 24n;
    const leaves = bountyLeaves([mk(COMMON, 1n), mk(plain, 2n)], POT, () => true, tier);
    const ratio = Number(leaves.find((l) => l.tokenId === 1n)!.amount) / Number(leaves.find((l) => l.tokenId === 2n)!.amount);
    expect(ratio).toBeCloseTo((TIER_WEIGHT.Legendary / TIER_WEIGHT.Common) ** DEFAULT_PARAMS.bounty.rarityWeight, 3);
  });
  it("and the cards' estimates agree with the keeper", () => {
    const shape = { word: COMMON, upper: [true, true, true, true, true], prestigeLevel: 0 };
    const today = { pot: 100, weight: TIER_WEIGHT.Legendary };
    expect(dailyEarnEstimate(shape, today, tier)).toBeCloseTo(50, 9); // one Legendary weight joining another
    expect(dailyEarnEstimate(shape, today, wordTier)).toBeCloseTo((100 * TIER_WEIGHT.Common) / (TIER_WEIGHT.Legendary + TIER_WEIGHT.Common), 9);
    // a staked collab word alone in the pot takes all of it (its own weight comes out first, at Legendary)
    expect(earnsStaked({ ...shape, staked: true, daysUnfed: 0 }, { pot: 100, weight: TIER_WEIGHT.Legendary }, tier)).toBeCloseTo(100, 9);
  });
});

describe("the keeper opens no epoch on guessed rarities", () => {
  it("refuses when the sets can't be read, or the read throws", async () => {
    await expect(epochTiers("yield epoch 1", async () => ({ known: false, words: NO_COLLAB }))).rejects.toThrow(/no epoch is opened on guessed rarities/);
    await expect(
      epochTiers("bounty epoch 2", async () => {
        throw new Error("db down");
      }),
    ).rejects.toThrow(/bounty epoch 2/);
  });
  it("weighs by the collab words when they are known, and by the derived tiers when there are none", async () => {
    expect((await epochTiers("yield", async () => ({ known: true, words: collab })))(COMMON)).toBe("Legendary");
    expect(await epochTiers("yield", async () => ({ known: true, words: NO_COLLAB }))).toBe(wordTier);
  });
  it("is what the yield and bounty jobs weigh with (the job's own source)", () => {
    const src = readFileSync(join(__dirname, "..", "src/lib/keeper/jobs.ts"), "utf8");
    expect(src).toMatch(/const tier = await epochTiers\(/);
    expect(src).toMatch(/yieldLeaves\(words, pot, tier\)/);
    expect(src).toMatch(/bountyLeaves\(words, bucket, THEMES\[themeIdx\]\.test, tier\)/);
    // and the refusal comes before either split is computed
    expect(src.indexOf("await epochTiers(")).toBeLessThan(src.indexOf("yieldLeaves(words, pot, tier)"));
  });
});

describe("filters, sort order, and what the market records", () => {
  const tier = tierFn(collab);
  const listing = (word: string, price: number): WordForSale => ({ word, maker: "0xm", price, upper: [false, false, false, false, false], prestigeLevel: 0, orderHash: `0x${word}` });
  const plainLegend = wordsByTier("Legendary")[1];
  const board = [listing(COMMON, 50), listing(plainLegend, 70), listing(wordsByTier("Common")[1], 10)];

  it("the Legendary filter finds a collab word, and the Common filter no longer does", () => {
    const f = { q: "", cases: "all" as const, within: null };
    expect(filterWords(board, { ...f, tier: "Legendary" }, tier).map((l) => l.word).sort()).toEqual([COMMON, plainLegend].sort());
    expect(filterWords(board, { ...f, tier: "Common" }, tier).map((l) => l.word)).toEqual([wordsByTier("Common")[1]]);
    expect(filterWords(board, { ...f, tier: "Common" }).map((l) => l.word)).toHaveLength(2); // the derived tiers, when none is passed
  });
  it("rarest first puts it with the Legendary words; the lowest Legendary price counts it", () => {
    expect(sortWords(board, "rare", () => null, tier).map((l) => l.word)).toEqual([COMMON, plainLegend, wordsByTier("Common")[1]]); // 50 before 70 within the tier
    expect(tierLowest(board, "Legendary", () => false, undefined, tier)).toBe(50);
    expect(tierLowest(board, "Legendary", () => false)).toBe(70);
  });
  it("the one word-by-word order is unchanged for every other word, and moves only a collab word", () => {
    const sample = RANKED_WORDS.filter((_, i) => i % 53 === 0).map((r) => r.word);
    expect([...sample].sort(rarestFirstBy(wordTier))).toEqual([...sample].sort(rarestFirst));
    const order = [COMMON, plainLegend, RARE, wordsByTier("Rare")[1], MYTHIC].sort(rarestFirstBy(tierFn(new Set([COMMON]))));
    expect(order[0]).toBe(MYTHIC);
    expect(order.indexOf(COMMON)).toBeLessThan(order.indexOf(RARE)); // above every Rare word
    expect(order.indexOf(plainLegend)).toBeLessThan(order.indexOf(COMMON)); // and last among the Legendary: its own rank within the tier
  });
  it("the Dictionary's tier filter follows it", () => {
    const open = () => "open" as const;
    const legendary = listDictionary({ query: "", tier: "Legendary", filter: "all", sort: "az" }, open, null, tier).words;
    expect(legendary).toContain(COMMON);
    expect(legendary).toHaveLength(TIER_COUNTS.Legendary + 3);
    expect(listDictionary({ query: "", tier: "Common", filter: "all", sort: "az" }, open, null, tier).words).not.toContain(COMMON);
    expect(listDictionary({ query: "", tier: "Legendary", filter: "all", sort: "az" }, open, null).words).not.toContain(COMMON);
  });
  it("a sale is recorded at the tier the game treats the word as", () => {
    const c = { words: "0x00000000000000000000000000000000000000aa", letters: "0x00000000000000000000000000000000000000bb", word: "0x00000000000000000000000000000000000000cc", saleFees: "0x00000000000000000000000000000000000000dd" };
    const fill = {
      orderHash: "0x01" as const, offerer: "0x00000000000000000000000000000000000000e1" as const, recipient: "0x00000000000000000000000000000000000000e2" as const,
      offer: [{ itemType: 2, token: c.words as `0x${string}`, identifier: tokenIdOf(COMMON), amount: 1n }],
      consideration: [
        { itemType: 1, token: c.word as `0x${string}`, identifier: 0n, amount: 95n, recipient: "0x00000000000000000000000000000000000000e1" as const },
        { itemType: 1, token: c.word as `0x${string}`, identifier: 0n, amount: 5n, recipient: c.saleFees as `0x${string}` },
      ],
    };
    expect(saleOfFill(fill, c, tier)).toMatchObject({ kind: "word", word: COMMON, tier: "Legendary" });
    expect(saleOfFill(fill, c)).toMatchObject({ tier: "Common" });
  });
  it("the Market's picks rank a letter that finishes a collab word as one that finishes a Legendary", () => {
    // Two letters for sale, each finishing one word: the collab word's letter comes first.
    const plainRare = wordsByTier("Rare")[1];
    const ask = (letterId: number, hash: string) => ({ letterId, unitPrice: 5, available: 1, maker: "0xseller", orderHash: hash }) as never;
    const deals = pickDeals({
      book: { 0: { asks: [ask(0, "0xa")] }, 1: { asks: [ask(1, "0xb")] } } as never,
      words: [],
      short: new Map([[0, [plainRare]], [1, [COMMON]]]),
      isMine: () => false,
      prices: { pack: 1, roll: 1 } as never,
      balance: 0,
      tierOf: tier,
    });
    expect(deals.map((d) => (d.kind === "finish" ? d.word : ""))).toEqual([COMMON, plainRare]);
    void oneLetterShort;
  });
});

// --- in a component: the tier follows the sets answer when it arrives ---------------------------
const hook = vi.hoisted(() => ({ collab: undefined as ReadonlySet<string> | undefined }));
vi.mock("@/components/game/useSets", () => ({ useSets: () => ({ collab: hook.collab }) }));

describe("in the game", () => {
  afterEach(() => {
    cleanup();
    hook.collab = undefined;
  });
  it("draws the derived tier until the sets answer arrives, then the game's tier, with no reload", async () => {
    const { useTierCounts, useTierOf } = await import("@/components/game/useRarity");
    function Probe() {
      const tierOf = useTierOf();
      const counts = useTierCounts();
      return <p>{`${tierOf(COMMON)} ${counts.Legendary}`}</p>;
    }
    const { rerender } = render(<Probe />);
    expect(screen.getByText(`Common ${TIER_COUNTS.Legendary}`)).toBeTruthy(); // no answer yet (and a stand-in hook with no collab words)
    hook.collab = collab;
    rerender(<Probe />);
    expect(screen.getByText(`Legendary ${TIER_COUNTS.Legendary + 3}`)).toBeTruthy();
  });
});

// --- every other reader of the derived tier is on a list -----------------------------------------
describe("who may still read the DERIVED tier", () => {
  /** file → why the derived tier is right there. Anything else must ask for the game's tier. */
  const MAY: Record<string, string> = {
    "src/lib/economy.ts": "defines it",
    "src/lib/rarity.ts": "the layer itself: the derived tier is its input",
    "src/lib/sim/simulate.ts": "the simulator models supply and odds: never the collab layer",
    "src/components/game/state.tsx": "the practice game: no chain, no sets",
    "src/components/game/market/practiceMarket.ts": "the practice game's market",
    "src/app/api/admin/sets/route.ts": "picks the test collab's words BY their own tier, on purpose",
    // A default for callers with no sets (tests, the practice game). The game's own calls pass a tier: checked below.
    "src/lib/market/deals.ts": "a default parameter",
    "src/lib/dictionaryList.ts": "a default parameter",
    "src/lib/market/sales.ts": "a default parameter",
    "src/lib/notify/deals.ts": "a default parameter",
    "src/lib/keeper/shares.ts": "names it in a comment only",
    "src/components/game/useRarity.ts": "names it in a comment only",
  };
  const root = join(__dirname, "..");
  const files = (dir: string): string[] =>
    readdirSync(join(root, dir)).flatMap((name) => {
      const rel = `${dir}/${name}`;
      return statSync(join(root, rel)).isDirectory() ? files(rel) : /\.(ts|tsx)$/.test(name) ? [rel] : [];
    });
  const all = files("src");

  it("only the files on the list name `wordTier` at all", () => {
    const users = all.filter((f) => /\bwordTier\b/.test(readFileSync(join(root, f), "utf8"))).sort();
    expect(users.filter((f) => !(f in MAY))).toEqual([]);
    expect(Object.keys(MAY).filter((f) => !users.includes(f))).toEqual([]); // and the list holds nothing stale
  });

  it("the game's own calls of the functions with a default pass a tier", () => {
    // Each call of these in src (outside the file that defines it) must carry a tier argument.
    const need: [RegExp, string][] = [
      [/\bfilterWords\(/, "filterWords"],
      [/\bsortWords\(filterWords/, "sortWords"],
      [/\btierLowest\(/, "tierLowest"],
      [/\bpickDeals\(\{/, "pickDeals"],
      [/\boneLetterShort\(/, "oneLetterShort"],
      [/\blistDictionary\(/, "listDictionary"],
      [/\bsaleOfFill\(/, "saleOfFill"],
      [/\brankedDeals\(wallets/, "rankedDeals"],
    ];
    const missing: string[] = [];
    for (const f of all) {
      const src = readFileSync(join(root, f), "utf8");
      for (const [re, name] of need) {
        const defines = new RegExp(`export (async )?function ${name}\\b`).test(src);
        src.split("\n").forEach((line, i) => {
          if (!re.test(line) || /export (async )?function/.test(line)) return;
          // the call, and the few lines it may run over
          const call = src.split("\n").slice(i, i + 12).join("\n");
          const end = call.search(/\)\s*;|\}\);/);
          const text = end >= 0 ? call.slice(0, end + 3) : call;
          if (!/\btier(Of)?\b/.test(text) && !(defines && /^\s*\*|^\s*\/\//.test(line))) missing.push(`${f}:${i + 1} ${name}`);
        });
      }
    }
    expect(missing).toEqual([]);
  });
});
