/**
 * The back of a word's card as a picture (the share video's back; decisions.md #48, part 5): what
 * it says about the word, in a stranger's words, from the chain and never from the link.
 */
import { writeFileSync } from "fs";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { backFoot, backLedger, type BackFacts } from "@/lib/backPicture";
import { cardDate, type WordStory } from "@/lib/cardFacts";

const HOLDER = "0x00000000000000000000000000000000000000a1";
const OTHER = "0x00000000000000000000000000000000000000b2";
const FINDER = "0x00000000000000000000000000000000000000c3";
const STORY: WordStory = {
  claims: [{ owner: FINDER, at: 1_794_000_000 }],
  // found by one wallet, sold to another profile's wallet, then moved to that profile's other wallet
  transfers: [
    { from: "0x0000000000000000000000000000000000000000", to: FINDER, at: 1_794_000_000 },
    { from: FINDER, to: OTHER, at: 1_794_400_000 },
    { from: OTHER, to: HOLDER, at: 1_794_600_000 },
  ],
};

const chain = vi.hoisted(() => ({
  deployed: true,
  level: 2 as number | null,
  world: null as unknown,
  worldFails: false,
  worldNever: false,
  params: null as unknown,
  paramsFail: false,
  wallets: [] as string[],
  seen: [] as string[],
}));
vi.mock("@/lib/onchain/addresses", async (orig) => ({ ...(await orig<typeof import("@/lib/onchain/addresses")>()), isSuiteDeployed: () => chain.deployed }));
vi.mock("@/lib/onchain/cardNumbers", () => ({ cardNumberOf: async () => 40 }));
vi.mock("@/lib/onchain/cardLevel", () => ({ cardLevelOf: async (word: string, hint: number | null) => (chain.seen.push(`level:${word}:${hint}`), chain.level) }));
vi.mock("@/lib/onchain/wordStory", () => ({ readWordStory: async (word: string) => (chain.seen.push(`story:${word}`), STORY) }));
vi.mock("@/lib/profile/faces", () => ({ playerFaces: async () => ({ accountFor: new Map(), profiles: { [FINDER]: { username: "starl3xx", pfpUrl: null } } }) }));
vi.mock("@/lib/worldSnapshot", () => ({
  worldNow: () => (chain.worldNever ? new Promise(() => {}) : chain.worldFails ? Promise.reject(new Error("scan failed")) : Promise.resolve(chain.world)),
}));
vi.mock("@/lib/onchain/reads", () => ({ readGameParams: async () => (chain.paramsFail ? Promise.reject(new Error("rpc")) : chain.params) }));
vi.mock("@/lib/db/walletLinks", () => ({ accountWallets: async (a: string) => ({ account: a, wallets: chain.wallets }) }));

const { readBackFacts, resetBackFacts } = await import("@/lib/backPictureFacts");
const { GET } = await import("@/app/s/[text]/back/route");
const get = (text: string, query = "") => GET(new Request(`https://lexigotchi.test/s/${text}/back${query}`), { params: Promise.resolve({ text }) });

const worldOf = (o: { raised?: number; weight?: number; own?: number; pot?: number; drawn?: Record<string, number> } = {}) => ({
  body: { ok: true, live: true, owners: { GLYPH: HOLDER }, yieldToday: { pot: o.pot ?? 1000, weight: o.weight ?? 50 }, drawn: o.drawn ?? {} },
  weights: { GLYPH: o.own ?? 0 },
  raised: { GLYPH: o.raised ?? 5 },
});
const FACTS: BackFacts = { word: "GLYPH", upper: [true, true, true, true, true], level: 2, finder: "@starl3xx", since: 1_794_400_000, perDay: 85.4, cost: 9_400, drawn: "never", token: "0x9c1e…41d7" };

beforeEach(() => {
  chain.deployed = true;
  chain.level = 2;
  chain.world = worldOf();
  chain.worldFails = false;
  chain.worldNever = false;
  chain.params = { word: { pack: 1000, roll: 200, claim: 300, prestigeFee: 100, prestigeSnackCost: 50 } };
  chain.paramsFail = false;
  chain.wallets = [HOLDER, OTHER];
  chain.seen = [];
  resetBackFacts();
});

describe("what the back's picture says", () => {
  it("is the game's ledger about the WORD, in the game's order", () => {
    expect(backLedger(FACTS)).toEqual([
      ["Case", "UPPERCASE"],
      ["Ascension", "Gilded 2"],
      ["Held since", cardDate(1_794_400_000)],
      ["Earns staked", "~85 a day"],
      ["Cost to make", "~9.4K $WORD"],
      ["Points", "14"],
      ["Found by", "@starl3xx"],
    ]);
    expect(backFoot(FACTS)).toEqual(["Never drawn for the jackpot", "0x9c1e…41d7"]);
    expect(backFoot({ ...FACTS, drawn: 7 })[0]).toBe("Drawn for the jackpot (draw 7)");
  });

  it("never says \"you\", and never an amount a player earned or a state that changes by the day", () => {
    const all = [...backLedger(FACTS), ...backFoot(FACTS).map((x) => ["", x])].flat().join(" | ");
    expect(all).not.toMatch(/\byou\b|\byours\b|earned|staked,|hungry|peckish|\bfull\b/i);
    expect(all).not.toContain("Yours since");
    expect(all).not.toContain("Earned so far");
  });

  it("leaves out what couldn't be read: never a dash, never a guess", () => {
    const bare = { ...FACTS, level: null, finder: null, since: null, perDay: null, cost: null, drawn: null, token: null };
    expect(backLedger(bare)).toEqual([
      ["Case", "UPPERCASE"],
      ["Points", "14"],
    ]);
    expect(backFoot(bare)).toEqual([]);
    expect(backLedger({ ...FACTS, perDay: "upper" }).find((r) => r[0] === "Earns staked")?.[1]).toBe("Once UPPERCASE");
  });
});

describe("the facts read for it", () => {
  it("\"Held since\" is the day the word reached its holder's PROFILE: a move between its own wallets keeps the day", async () => {
    expect((await readBackFacts("GLYPH", 2, STORY)).since).toBe(1_794_400_000);
    // the same word, when the two wallets are not one profile: the day of the last move
    chain.wallets = [HOLDER];
    expect((await readBackFacts("GLYPH", 2, STORY)).since).toBe(1_794_600_000);
  });

  it("\"Earns staked\" counts the word in once: its own part of today's weight is taken out first", async () => {
    // Legendary (weight 8) at Gilded 2 is 8 × 1.1² = 9.68 of weight
    chain.world = worldOf({ weight: 50, own: 0, pot: 1000 });
    const fresh = (await readBackFacts("GLYPH", 2, STORY)).perDay as number;
    chain.world = worldOf({ weight: 50 + fresh * 0 + 9.68, own: 9.68, pot: 1000 });
    const staked = (await readBackFacts("GLYPH", 2, STORY)).perDay as number;
    expect(staked).toBeCloseTo(fresh, 6);
    expect(fresh).toBeGreaterThan(0);
  });

  it("how many letters are UPPERCASE is the chain's count: a word not all raised earns nothing yet, whatever a link's casing", async () => {
    chain.world = worldOf({ raised: 3 });
    const f = await readBackFacts("GLYPH", 0, STORY);
    expect(f.perDay).toBe("upper");
    // and it costs less to make than the same word fully raised
    chain.world = worldOf({ raised: 5 });
    expect((await readBackFacts("GLYPH", 0, STORY)).cost!).toBeGreaterThan(f.cost!);
  });

  it("a read that fails or never answers leaves its facts out, and never holds the picture or throws", async () => {
    chain.worldFails = true;
    expect(await readBackFacts("GLYPH", 2, STORY)).toEqual({ since: null, perDay: null, cost: null, drawn: null });
    chain.worldFails = false;
    chain.paramsFail = true;
    resetBackFacts(); // the prices read a moment ago are kept for minutes
    const f = await readBackFacts("GLYPH", 2, STORY);
    expect(f.cost).toBeNull();
    expect(f.perDay).not.toBeNull();
    // the stage couldn't be read: nothing that depends on it is guessed
    chain.paramsFail = false;
    resetBackFacts();
    const g = await readBackFacts("GLYPH", null, STORY);
    expect(g.perDay).toBeNull();
    expect(g.cost).toBeNull();
    expect(g.drawn).toBe("never");
  });

  it("gives up on a world that never answers, after a few seconds", async () => {
    vi.useFakeTimers();
    chain.worldNever = true;
    const read = readBackFacts("GLYPH", 2, STORY);
    await vi.advanceTimersByTimeAsync(5000);
    expect((await read).drawn).toBeNull();
    vi.useRealTimers();
  });
});

describe("the back's picture", () => {
  it("is the card's own shape, drawn with the word's facts, and reads nothing from the query", async () => {
    const res = await get("GLYPH", "?g=2&since=1&cost=1&finder=%40nobody&held=%40nobody");
    expect(res.status).toBe(200);
    const png = Buffer.from(await res.arrayBuffer());
    expect(png.subarray(1, 4).toString("latin1")).toBe("PNG");
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1200, 675]);
    // the only part of the query that went anywhere is the stage, and only as a reason to read again
    expect(chain.seen).toEqual(expect.arrayContaining(["level:GLYPH:2", "story:GLYPH"]));
    expect(chain.seen.join(" ")).not.toContain("nobody");
    if (process.env.BACK_PNG_OUT) writeFileSync(process.env.BACK_PNG_OUT, png);
  }, 60_000);

  it("is still drawn where there is no chain, with the facts a word has anyway", async () => {
    chain.deployed = false;
    expect((await get("CRAne")).status).toBe(200);
    expect((await get("zzzzz")).status).toBe(404);
  }, 60_000);
});
