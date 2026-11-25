/**
 * GET /api/words/story: a word's onchain story for the back of its card. It answers only for a
 * dictionary word, says "not live" where no contracts are deployed (the practice game makes up its
 * own stories), and serves the read keyed by the word alone, so one answer is everyone's.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const deployed = { yes: false };
vi.mock("@/lib/onchain/addresses", () => ({ isSuiteDeployed: () => deployed.yes }));
const readWordStory = vi.fn();
vi.mock("@/lib/onchain/wordStory", () => ({ readWordStory: (w: string) => readWordStory(w) }));
const { GET } = await import("@/app/api/words/story/route");

const get = (word: string) => GET(new Request(`https://lexigotchi.test/api/words/story?word=${word}`));

beforeEach(() => {
  deployed.yes = false;
  readWordStory.mockReset();
});

describe("a word's story", () => {
  it("refuses anything that isn't a dictionary word", async () => {
    const res = await get("zzzzz");
    expect(res.status).toBe(400);
    expect(readWordStory).not.toHaveBeenCalled();
  });

  it("says it isn't live where nothing is deployed", async () => {
    const res = await get("crane");
    expect(await res.json()).toEqual({ ok: true, live: false });
    expect(readWordStory).not.toHaveBeenCalled();
  });

  it("serves the chain's story, for everyone, for a minute", async () => {
    deployed.yes = true;
    readWordStory.mockResolvedValue({ claims: [{ owner: "0xabc", at: 5 }], transfers: [] });
    const res = await get("crane");
    expect(readWordStory).toHaveBeenCalledWith("CRANE");
    expect(await res.json()).toEqual({ ok: true, live: true, claims: [{ owner: "0xabc", at: 5 }], transfers: [] });
    expect(res.headers.get("cache-control")).toMatch(/public, s-maxage=60/);
  });

  it("says the read failed rather than an empty story", async () => {
    deployed.yes = true;
    readWordStory.mockRejectedValue(new Error("rpc down"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await get("crane");
    expect(res.status).toBe(503);
    expect((await res.json()).ok).toBe(false);
  });
});
