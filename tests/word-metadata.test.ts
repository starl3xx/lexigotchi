/**
 * A word's token metadata (lib/wordMetadata.ts, GET /api/word/{id}; decisions.md, "Collab sets"):
 * what a marketplace reads about a word. Its name and picture follow the chain's state now, its
 * rarity is the tier the game treats it as, and a set is named only as any visitor may see it.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { STANDARD_FIELDS, type WordSet } from "@/lib/sets/rules";
import { parseTokenId, wordMetadata } from "@/lib/wordMetadata";

vi.stubEnv("NEXT_PUBLIC_CHAIN_ID", "84532");
vi.stubEnv("DATABASE_URL", "postgresql://stand-in");

const world = vi.hoisted(() => ({
  sets: [] as WordSet[],
  setsFail: false,
  held: new Map<string, { upper: boolean[]; level: number }>(), // token id → the word's state
  chainDown: false,
  number: null as number | null,
}));

vi.mock("@/lib/db/sets", () => ({
  SetError: class extends Error {},
  listSets: async () => {
    if (world.setsFail) throw Object.assign(new Error("down"), { code: "08006" });
    return { sets: world.sets, migrated: true, collab: true };
  },
  revealDue: async () => [],
}));
// The WAITING read of the number: the quick one answers "none yet" on a cold server, and a
// marketplace keeps the first answer it is given.
vi.mock("@/lib/onchain/cardNumbers", () => ({
  cardNumberOf: async () => world.number,
  cardNumberSoon: async () => {
    throw new Error("the metadata must wait for the number, not use the quick read");
  },
}));
vi.mock("@/lib/onchain/reads", async (orig) => ({
  ...(await orig<typeof import("@/lib/onchain/reads")>()),
  getPublicClient: () => ({
    multicall: async ({ contracts, allowFailure }: { contracts: { functionName: string; args: [bigint, number?] }[]; allowFailure: boolean }) => {
      if (world.chainDown) throw new Error("rpc down");
      return contracts.map((c) => {
        const w = world.held.get(String(c.args[0]));
        if (c.functionName === "exists") return Boolean(w);
        if (c.functionName === "prestigeLevel") return w?.level ?? 0;
        // escrowLetter: reverts for a word nobody holds
        if (!w) return allowFailure ? { status: "failure", error: new Error("NoSuchToken") } : (() => { throw new Error("NoSuchToken"); })();
        return { status: "success", result: [0, w.upper[c.args[1] ?? 0]] };
      });
    },
  }),
}));

const SITE = "https://game.example";
const set = (id: number, name: string, status: WordSet["status"], words: string[], over: Partial<WordSet> = {}): WordSet => ({
  id, name, status, revealAt: null, releaseAt: null, gateHours: 24, perPlayerLimit: 1, sort: id,
  revealedAt: null, releasedAt: null, gateUntil: null, releaseBlock: null, releaseRoot: null,
  words: words.map((word) => ({ word, headliner: false })), ...STANDARD_FIELDS, ...over,
});
const collabLook = { type: "collab", partnerName: "Test partner", colorA: "#112233", colorB: "#aabbcc", stampAt: new Date(0) } as const;

describe("the metadata itself", () => {
  const base = { word: "CRANE", upper: [true, true, true, false, false], level: 0, number: 12, tier: "Common" as const, setName: null, collabPartner: null };
  it("names the word as its letters stand now, and points at its card", () => {
    const m = wordMetadata(base, SITE);
    expect(m.name).toBe("CRAne");
    expect(m.external_url).toBe("https://game.example/s/CRAne");
    expect(m.image.startsWith("https://game.example/s/CRAne/card?")).toBe(true);
    expect(m.image).toContain("face=1");
    expect(m.description).toBe("CRANE is a word in Lexigotchi, made from five letters. There is one of it.");
  });
  it("carries its rarity, its case, its ascension, and its number", () => {
    expect(wordMetadata(base, SITE).attributes).toEqual([
      { trait_type: "Rarity", value: "Common" },
      { trait_type: "UPPERCASE letters", value: 3, display_type: "number", max_value: 5 },
      { trait_type: "Ascension", value: "Not ascended" },
      { trait_type: "Number", value: 12, display_type: "number" },
    ]);
    const gilded = wordMetadata({ ...base, upper: [true, true, true, true, true], level: 2, number: null }, SITE);
    expect(gilded.attributes.map((a) => `${a.trait_type}=${a.value}`)).toEqual(["Rarity=Common", "UPPERCASE letters=5", "Ascension=Gilded 2"]);
    expect(gilded.image).not.toBe(wordMetadata({ ...base, upper: [true, true, true, true, true], level: 0, number: null }, SITE).image); // a new stage is a new picture address
  });
  it("a collab word carries a “Collab” trait with its partner, and a released set's word its set", () => {
    const m = wordMetadata({ ...base, tier: "Legendary", setName: "Test collab", collabPartner: "Test partner" }, SITE);
    expect(m.attributes[0]).toEqual({ trait_type: "Rarity", value: "Legendary" });
    expect(m.attributes.slice(-2)).toEqual([{ trait_type: "Set", value: "Test collab" }, { trait_type: "Collab", value: "Test partner" }]);
  });
  it("reads a token id as tokenURI writes it: decimal digits only", () => {
    expect(parseTokenId("12345")).toBe(12345n);
    expect(parseTokenId((2n ** 256n - 1n).toString())).toBe(2n ** 256n - 1n);
    for (const bad of ["", "0x1f", "-1", "1.5", "12 ", (2n ** 256n).toString(), "9".repeat(79), "crane"]) expect(parseTokenId(bad), bad).toBeNull();
  });
});

describe("GET /api/word/{id}", () => {
  let COMMON: string;
  let idOf: (w: string) => string;
  const get = async (id: string) => {
    const { GET } = await import("@/app/api/word/[id]/route");
    const res = await GET(new Request(`http://localhost/api/word/${id}`), { params: Promise.resolve({ id }) });
    return { status: res.status, body: await res.json(), cache: res.headers.get("cache-control"), cors: res.headers.get("access-control-allow-origin") };
  };
  const trait = (body: { attributes: { trait_type: string; value: unknown }[] }, name: string) => body.attributes.find((a) => a.trait_type === name)?.value;

  beforeEach(async () => {
    vi.resetModules();
    const { wordsByTier } = await import("@/lib/economy");
    const { tokenIdOf } = await import("@/lib/onchain/tokenId");
    COMMON = wordsByTier("Common")[0];
    idOf = (w) => tokenIdOf(w).toString();
    Object.assign(world, { sets: [], setsFail: false, held: new Map(), chainDown: false, number: 7 });
    world.held.set(idOf(COMMON), { upper: [true, false, false, false, false], level: 1 });
  });

  it("gives a held word's metadata from the chain's state, open to any reader, kept a minute", async () => {
    const { status, body, cache, cors } = await get(idOf(COMMON));
    expect(status).toBe(200);
    expect(body.name).toBe(COMMON[0] + COMMON.slice(1).toLowerCase());
    expect(trait(body, "Rarity")).toBe("Common");
    expect(trait(body, "UPPERCASE letters")).toBe(1);
    expect(trait(body, "Ascension")).toBe("Gilded 1");
    expect(trait(body, "Number")).toBe(7);
    expect(trait(body, "Set")).toBeUndefined();
    expect(trait(body, "Collab")).toBeUndefined();
    expect(cache).toContain("s-maxage=60");
    expect(cors).toBe("*");
  });

  it("an id that is no dictionary word, and a word nobody holds, have none", async () => {
    expect(await get("12345")).toMatchObject({ status: 404, body: { error: "not_a_word" } });
    expect(await get("0x12")).toMatchObject({ status: 404, body: { error: "not_a_word" } });
    const { wordsByTier } = await import("@/lib/economy");
    expect(await get(idOf(wordsByTier("Common")[1]))).toMatchObject({ status: 404, body: { error: "not_minted" } });
  });

  it("answers 503, never a guess, when the chain can't be read", async () => {
    world.chainDown = true;
    const res = await get(idOf(COMMON));
    expect(res).toMatchObject({ status: 503, body: { error: "try_again" }, cache: "no-store" });
  });

  it("a word of a DRAFT collab set says nothing of it: not the trait, not the rarity", async () => {
    world.sets = [set(1, "SecretSet", "draft", [COMMON], collabLook)];
    const { body } = await get(idOf(COMMON));
    expect(trait(body, "Rarity")).toBe("Common");
    expect(JSON.stringify(body)).not.toMatch(/Collab|SecretSet|Test partner|Legendary/);
    expect(body.image).not.toMatch(/[?&]c=/); // nor its picture's address: a draft's word is addressed as any word
  });

  it("from the reveal it is Legendary with its “Collab” trait; its set is named once released", async () => {
    world.sets = [set(1, "Shown", "revealed", [COMMON], collabLook)];
    const revealed = (await get(idOf(COMMON))).body;
    expect(trait(revealed, "Rarity")).toBe("Legendary");
    expect(trait(revealed, "Collab")).toBe("Test partner");
    // and its picture is at a NEW address (it names the look), so a marketplace told to read the
    // word again gets the collab card, never the picture it kept from before the reveal
    expect(revealed.image).toContain("&c=1-0");
    expect(trait(revealed, "Set")).toBeUndefined(); // the card's back names a set only once it is released
    vi.resetModules();
    world.sets = [set(1, "Shown", "released", [COMMON], collabLook)];
    const released = (await get(idOf(COMMON))).body;
    expect(trait(released, "Set")).toBe("Shown");
    expect(trait(released, "Collab")).toBe("Test partner");
  });

  it("a released standard set's word names its set and keeps its own rarity", async () => {
    world.sets = [set(2, "Kitchen", "released", [COMMON])];
    const { body } = await get(idOf(COMMON));
    expect(trait(body, "Set")).toBe("Kitchen");
    expect(trait(body, "Rarity")).toBe("Common");
    expect(trait(body, "Collab")).toBeUndefined();
  });

  it("when the sets can't be read it is 503, never a collab word's metadata without its rarity and trait", async () => {
    world.sets = [set(1, "Shown", "released", [COMMON], collabLook)];
    world.setsFail = true;
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await get(idOf(COMMON))).toMatchObject({ status: 503, body: { error: "try_again" }, cache: "no-store" });
    log.mockRestore();
  });

  it("a word with no number yet still has its metadata, without the trait", async () => {
    world.number = null;
    const { status, body } = await get(idOf(COMMON));
    expect(status).toBe(200);
    expect(trait(body, "Number")).toBeUndefined();
  });
});
