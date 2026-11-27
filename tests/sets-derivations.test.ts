/**
 * What must stay derived from the FULL dictionary when words are held back in reserved sets
 * (decisions.md, "Reserved word sets"): letter supply caps, mint odds, rarity tiers, and token ids.
 * A reserved word still needs its letters to exist, and it comes back with the tier and the token id
 * it always had. None of these may move when a set is reserved or released.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { STANDARD_FIELDS, type WordSet } from "@/lib/sets/rules";

vi.stubEnv("NEXT_PUBLIC_CHAIN_ID", "84532");
vi.stubEnv("DATABASE_URL", "postgresql://stand-in");

const world = vi.hoisted(() => ({ sets: [] as WordSet[], chainRoot: "", roots: new Map<string, string[]>() }));

vi.mock("@/lib/db/sets", () => ({
  SetError: class extends Error {},
  listSets: async () => ({ sets: world.sets, migrated: true }),
  revealDue: async () => [],
  saveRoot: async (_c: number, root: string, held: string[]) => void world.roots.set(root, [...held]),
  heldOfRoot: async (_c: number, root: string) => world.roots.get(root) ?? null,
  newestRoot: async () => null,
  setReleaseRoot: async () => true,
  markReleased: async () => false,
}));
vi.mock("@/lib/onchain/reads", async (orig) => ({
  ...(await orig<typeof import("@/lib/onchain/reads")>()),
  getPublicClient: () => ({
    readContract: async ({ functionName }: { functionName: string }) => {
      if (functionName === "dictionaryRoot") return world.chainRoot;
      throw new Error("no gate");
    },
    multicall: async ({ contracts }: { contracts: unknown[] }) => contracts.map(() => false),
  }),
}));

/** Everything derived from the dictionary that a set must not move, read from freshly loaded modules. */
async function derived() {
  const economy = await import("@/lib/economy");
  const { WORDS, WORD_COUNT } = await import("@/lib/dictionary");
  const { letterWeights, letterOdds } = await import("@/lib/letterOdds");
  const { tokenIdOf } = await import("@/lib/onchain/tokenId");
  const { dictionaryRoot } = await import("@/lib/onchain/dictionaryTree");
  const caps = economy.ALPHABET.map((L) => economy.LETTER_SUPPLY_CAP[L]);
  return {
    wordCount: WORD_COUNT,
    slots: { ...economy.LETTER_SLOTS },
    caps,
    totalCap: economy.TOTAL_SUPPLY_CAP,
    odds: { ...economy.LETTER_ODDS },
    mintWeights: letterWeights(caps),
    mintOdds: letterOdds(),
    tierCounts: { ...economy.TIER_COUNTS },
    tiers: WORDS.map((w) => economy.wordTier(w)).join(","),
    ranks: economy.RANKED_WORDS.map((r) => `${r.word}:${r.rank}`).join(","),
    mythics: [...economy.MYTHICS],
    tokenIds: WORDS.map((w) => tokenIdOf(w).toString()).join(","),
    fullRoot: dictionaryRoot(),
  };
}

function setOf(id: number, status: WordSet["status"], words: string[]): WordSet {
  return {
    id, name: `set ${id}`, status, revealAt: null, releaseAt: null, gateHours: 24, perPlayerLimit: 1, sort: id,
    revealedAt: null, releasedAt: null, gateUntil: null, releaseBlock: null, releaseRoot: null,
    words: words.map((word) => ({ word, headliner: false })), ...STANDARD_FIELDS,
  };
}

beforeEach(() => {
  vi.resetModules();
  world.sets = [];
  world.roots.clear();
});

describe("derived from the full dictionary, whatever is held back", () => {
  it("caps, mint odds, rarity tiers, and token ids don't move when a set is reserved or released", async () => {
    const { dictionaryRoot } = await import("@/lib/onchain/dictionaryTree");
    world.chainRoot = dictionaryRoot();
    const before = await derived();

    // Reserve 200 words, the rarest among them (the words whose letters are scarcest).
    vi.resetModules();
    const economy = await import("@/lib/economy");
    const reserved = [...economy.MYTHICS.slice(0, 20), ...economy.RANKED_WORDS.slice(1000, 1180).map((r) => r.word)];
    expect(new Set(reserved).size).toBe(200);
    world.sets = [setOf(1, "draft", reserved.slice(0, 120)), setOf(2, "revealed", reserved.slice(120))];
    const server = await import("@/lib/sets/server");
    const plan = await server.planReserve();
    if (!plan.ok) throw new Error("no plan");
    world.chainRoot = plan.root; // reserved on the chain too
    server.forgetSets();
    expect(await server.releasedWordCount()).toBe(before.wordCount - 200); // the sets ARE in force
    vi.resetModules();
    const whileReserved = await derived();
    expect(whileReserved).toEqual(before);

    // Release one of them: its root lands on the chain, and the set is marked from there.
    vi.resetModules();
    const server2 = await import("@/lib/sets/server");
    const release = await server2.planRelease(2);
    if (!release.ok) throw new Error("no release plan");
    world.chainRoot = release.root;
    world.sets[1] = { ...world.sets[1], status: "released" };
    server2.forgetSets();
    expect(await server2.releasedWordCount()).toBe(before.wordCount - 120);
    vi.resetModules();
    expect(await derived()).toEqual(before);
    // Five fresh loads of the dictionary and its trees: seconds on a busy machine, by design.
  }, 30_000);

  it("the deployed caps and weights are the full dictionary's (contracts/config/economy.json)", async () => {
    const d = await derived();
    const config = JSON.parse(readFileSync(join(__dirname, "..", "contracts", "config", "economy.json"), "utf8"));
    const economy = await import("@/lib/economy");
    expect(config.wordCount).toBe(d.wordCount);
    expect(config.caps).toEqual(d.caps);
    expect(config.weights).toEqual(economy.ALPHABET.map((L) => economy.LETTER_SLOTS[L]));
    expect(config.totalSupplyCap).toBe(d.totalCap);
  });

  it("no module that derives them reads the sets", () => {
    // A direct import is the only way a set could reach these numbers: each is a constant of the
    // bundled dictionary. This fails the day one of them starts asking what is held back.
    const full = [
      "src/lib/dictionary.ts",
      "src/lib/economy.ts",
      "src/lib/letterOdds.ts",
      "src/lib/onchain/tokenId.ts",
      "src/lib/onchain/signer.ts",
      "src/lib/onchain/dictionaryTree.ts",
      "src/lib/answerPool.ts",
      "src/lib/answerChain.ts",
      "scripts/derive-contracts-config.ts",
      "scripts/derive-economy.ts",
    ];
    for (const f of full) {
      const src = readFileSync(join(__dirname, "..", f), "utf8");
      expect(/from\s+["'][^"']*\/sets\/[^"']*["']/.test(src), `${f} must not import lib/sets`).toBe(false);
      expect(/db\/sets/.test(src), `${f} must not import lib/db/sets`).toBe(false);
    }
  });
});
