/**
 * /api/dictionary/proof after a re-vendor: the bundled dictionary moved but the deployed Words
 * contract still holds the old root until the owner sends setDictionaryRoot. A proof served then
 * would revert NotInDictionary inside the wallet, so the route must say so instead.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.stubEnv("NEXT_PUBLIC_CHAIN_ID", "84532"); // a network with a deployed suite

let chainRoot = "";
vi.mock("@/lib/onchain/reads", async (orig) => ({
  ...(await orig<typeof import("@/lib/onchain/reads")>()),
  getPublicClient: () => ({ readContract: async () => chainRoot }),
}));

const get = (w: string) => new Request(`http://localhost/api/dictionary/proof?word=${w}`);

beforeEach(() => vi.resetModules()); // the route caches the onchain root for a minute

describe("GET /api/dictionary/proof", () => {
  it("serves the proof when the contract holds the bundled root", async () => {
    const { dictionaryRoot } = await import("@/lib/onchain/dictionaryTree");
    chainRoot = dictionaryRoot();
    const { GET } = await import("@/app/api/dictionary/proof/route");
    const res = await GET(get("crane"));
    expect(res.status).toBe(200);
    expect((await res.json()).word).toBe("CRANE");
  });

  it("refuses plainly while the onchain root lags behind a re-vendor", async () => {
    chainRoot = "0x" + "ab".repeat(32); // e.g. the 4,438-word root the August deploy holds
    const { GET } = await import("@/app/api/dictionary/proof/route");
    const res = await GET(get("ABUZZ")); // a round-36 word
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("dictionary_mismatch");
  });

  it("still 404s a word that isn't in the dictionary at all", async () => {
    const { GET } = await import("@/app/api/dictionary/proof/route");
    expect((await GET(get("qqqqq"))).status).toBe(404);
  });
});
