/**
 * Card numbers on the server (lib/onchain/cardNumbers) and the small read the card's front makes
 * for them (`/api/words/numbers`).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const chain = vi.hoisted(() => ({ deployed: true, read: vi.fn(async (): Promise<Record<string, number>> => ({})) }));
vi.mock("@/lib/onchain/addresses", async (orig) => ({ ...(await orig<typeof import("@/lib/onchain/addresses")>()), isSuiteDeployed: () => chain.deployed }));
vi.mock("@/lib/keeper/scan", () => ({ readMadeOrder: chain.read }));

const { NUMBER_WAIT_MS, cardNumberOf, cardNumberSoon, cardNumbersOf, resetCardNumbers } = await import("@/lib/onchain/cardNumbers");
const { GET } = await import("@/app/api/words/numbers/route");

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-25T12:00:00Z"));
  chain.deployed = true;
  chain.read.mockReset();
  chain.read.mockResolvedValue({ CRANE: 3, VIVID: 1 });
  resetCardNumbers();
});
afterEach(() => vi.useRealTimers());

describe("card numbers on the server", () => {
  it("reads the chain once and keeps a known number for good", async () => {
    expect(await cardNumberOf("CRANE")).toBe(3);
    vi.advanceTimersByTime(10 * 60_000);
    expect(await cardNumberOf("CRANE")).toBe(3);
    expect(await cardNumberOf("VIVID")).toBe(1);
    expect(chain.read).toHaveBeenCalledTimes(1);
  });

  it("asks again for a word with no number yet, at most once a minute", async () => {
    expect(await cardNumberOf("PLUMB")).toBeNull();
    expect(await cardNumberOf("PLUMB")).toBeNull();
    expect(chain.read).toHaveBeenCalledTimes(1);
    chain.read.mockResolvedValue({ CRANE: 3, VIVID: 1, PLUMB: 7 });
    vi.advanceTimersByTime(61_000);
    expect(await cardNumberOf("PLUMB")).toBe(7);
    expect(chain.read).toHaveBeenCalledTimes(2);
  });

  it("shares one read between callers that arrive together", async () => {
    const all = await Promise.all([cardNumberOf("CRANE"), cardNumberOf("VIVID"), cardNumbersOf(["CRANE", "VIVID"])]);
    expect(all).toEqual([3, 1, { CRANE: 3, VIVID: 1 }]);
    expect(chain.read).toHaveBeenCalledTimes(1);
  });

  it("answers nothing, never a guess, when the read fails", async () => {
    chain.read.mockRejectedValue(new Error("rpc down"));
    expect(await cardNumberOf("CRANE")).toBeNull();
    expect(await cardNumbersOf(["CRANE"])).toEqual({});
  });

  it("keeps the numbers it had when a later read fails", async () => {
    expect(await cardNumbersOf(["CRANE"])).toEqual({ CRANE: 3 });
    chain.read.mockRejectedValue(new Error("rpc down"));
    vi.advanceTimersByTime(61_000);
    expect(await cardNumbersOf(["CRANE", "PLUMB"])).toEqual({ CRANE: 3 });
  });

  it("reads nothing where the game isn't deployed", async () => {
    chain.deployed = false;
    expect(await cardNumberOf("CRANE")).toBeNull();
    expect(await cardNumbersOf(["CRANE"])).toEqual({});
    expect(chain.read).not.toHaveBeenCalled();
  });

  it("answers a caller in a hurry within a second and a half, and has the number for the next one", async () => {
    // a share picture is fetched by a crawler that won't wait for a slow scan of the chain
    let land: (map: Record<string, number>) => void = () => {};
    chain.read.mockReturnValue(new Promise((resolve) => (land = resolve)));
    const soon = cardNumberSoon("CRANE");
    await vi.advanceTimersByTimeAsync(NUMBER_WAIT_MS + 10);
    expect(await soon).toBeNull();
    land({ CRANE: 3 }); // the read carries on and lands
    await vi.advanceTimersByTimeAsync(1);
    expect(await cardNumberSoon("CRANE")).toBe(3);
    expect(chain.read).toHaveBeenCalledTimes(1);
  });

  it("gives a caller in a hurry nothing, and no error, when the read fails", async () => {
    chain.read.mockRejectedValue(new Error("rpc down"));
    expect(await cardNumberSoon("CRANE")).toBeNull();
  });

  it("leaves out the words that have no number", async () => {
    expect(await cardNumbersOf(["CRANE", "PLUMB", "VIVID"])).toEqual({ CRANE: 3, VIVID: 1 });
  });
});

describe("/api/words/numbers", () => {
  const ask = (q: string) => GET(new Request(`https://lexigotchi.test/api/words/numbers${q}`));

  it("answers the numbers of the words asked for, in either case, and nothing else", async () => {
    const res = await ask("?words=crane,VIVID,plumb");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, live: true, numbers: { CRANE: 3, VIVID: 1 } });
    expect(res.headers.get("cache-control")).toMatch(/max-age=60/);
  });

  it("refuses anything that isn't a short list of dictionary words", async () => {
    for (const q of ["", "?words=", "?words=CRANE,NOTAWORDX", "?words=<script>", `?words=${Array.from({ length: 201 }, () => "CRANE").map((w, i) => `${w}${i}`).join(",")}`]) {
      expect((await ask(q)).status, q).toBe(400);
    }
    expect(chain.read).not.toHaveBeenCalled();
  });

  it("says so where the game isn't deployed (the practice game numbers its own words)", async () => {
    chain.deployed = false;
    expect(await (await ask("?words=CRANE")).json()).toEqual({ ok: true, live: false, numbers: {} });
  });
});
