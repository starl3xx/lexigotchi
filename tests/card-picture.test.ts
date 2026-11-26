/**
 * A word's share picture (`/s/<word>/card`, decisions.md #33): the card on a table in X's and
 * Farcaster's shapes, the card's front alone for the share video, and a number that only the chain
 * can put on it.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const chain = vi.hoisted(() => ({ deployed: false, numberOf: vi.fn(async (_word: string): Promise<number | null> => null) }));
vi.mock("@/lib/onchain/addresses", async (orig) => ({ ...(await orig<typeof import("@/lib/onchain/addresses")>()), isSuiteDeployed: () => chain.deployed }));
vi.mock("@/lib/onchain/cardNumbers", () => ({ cardNumberSoon: chain.numberOf }));

const { GET } = await import("@/app/s/[text]/card/route");

const get = (text: string, query = "") => GET(new Request(`https://lexigotchi.test/s/${text}/card${query}`), { params: Promise.resolve({ text }) });
/** A PNG's width and height, from its header. */
async function size(res: Response): Promise<[number, number]> {
  const b = Buffer.from(await res.arrayBuffer());
  expect(b.subarray(1, 4).toString("latin1")).toBe("PNG");
  return [b.readUInt32BE(16), b.readUInt32BE(20)];
}
const LONG = /max-age=86400, s-maxage=604800/;
const SHORT = /max-age=300, s-maxage=300/;

beforeEach(() => {
  chain.deployed = false;
  chain.numberOf.mockReset();
  chain.numberOf.mockResolvedValue(null);
});

describe("a word's share picture", () => {
  it("draws only dictionary words and the house cards", async () => {
    expect((await get("zzzzz")).status).toBe(404);
    expect((await get("CR4NE")).status).toBe(404);
  });

  it("is X's shape by default, Farcaster's on request, and the card's own for its front alone", async () => {
    expect(await size(await get("CRAne"))).toEqual([1200, 630]);
    expect(await size(await get("CRAne", "?ratio=3x2&scene=trophy"))).toEqual([1200, 800]);
    expect(await size(await get("CRAne", "?face=1&scene=spring"))).toEqual([1200, 675]);
    // the front alone is never the tall table, whatever else the link says
    expect(await size(await get("CRAne", "?face=1&ratio=3x2&saved=1"))).toEqual([1200, 675]);
  }, 30_000);

  it("draws a link to a retired scene, and one with no scene at all", async () => {
    expect((await get("tease", "?scene=winter")).status).toBe(200);
    expect((await get("tease")).status).toBe(200);
  }, 30_000);

  it("asks the chain for the number, by the word alone: nothing in the link can number a card", async () => {
    chain.deployed = true;
    chain.numberOf.mockResolvedValue(20);
    await get("CRAne", "?number=1&no=0001&n=1");
    expect(chain.numberOf).toHaveBeenCalledTimes(1);
    expect(chain.numberOf).toHaveBeenCalledWith("CRANE");
  }, 30_000);

  it("gives a house card no rarity and no number: it never asks", async () => {
    chain.deployed = true;
    expect((await get("HEYOO", "?saved=1")).status).toBe(200);
    expect(chain.numberOf).not.toHaveBeenCalled();
  }, 30_000);

  it("keeps a finished picture for a week, and one still waiting for its number for minutes", async () => {
    // the practice game and a not-yet-deployed network have no numbers to wait for
    expect((await get("CRAne")).headers.get("cache-control")).toMatch(LONG);
    chain.deployed = true;
    chain.numberOf.mockResolvedValue(20);
    expect((await get("CRAne")).headers.get("cache-control")).toMatch(LONG);
    chain.numberOf.mockResolvedValue(null); // made a moment ago
    expect((await get("CRAne")).headers.get("cache-control")).toMatch(SHORT);
    // a house card has no number to wait for
    expect((await get("HEYOO")).headers.get("cache-control")).toMatch(LONG);
  }, 60_000);
});
