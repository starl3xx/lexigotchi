/**
 * The server opens packs (decisions.md #49): /api/mint/reveal with `{ relay: true }` sends
 * `Letters.reveal` from the relayer key, so a pack is one wallet confirmation and no wallet prompt
 * names the letters before the game shows them. Pinned here:
 * - without `relay: true` the route answers exactly as it did before (an old client bundle keeps
 *   working through a deploy);
 * - which answer carries a signature (only "nothing was broadcast");
 * - that a relayed answer names the letters the CHAIN minted, never the draw that was signed;
 * - that a broadcast reveal not seen to land names no letters at all.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { generatePrivateKey } from "viem/accounts";

vi.stubEnv("NEXT_PUBLIC_CHAIN_ID", "84532");
vi.stubEnv("SIGNER_PRIVATE_KEY", generatePrivateKey());
vi.stubEnv("SIGNER_DRAW_SECRET", "test-secret-not-a-real-one");

vi.mock("@/lib/auth/quickAuth", () => ({ getAuthedFid: async () => null }));
vi.mock("@/lib/ratelimit", () => ({ allow: async () => true }));
// No database here: the stored draw is its own subject (tests/sticky-draw.test.ts).
vi.mock("@/lib/onchain/stickyDraw", () => ({ stickyDraw: async (a: { draw: () => number[] }) => a.draw() }));

const BUYER = "0x0Fc0F78fc939606db65F5BBF2F3715262C0b2F6E" as const;
const HASH = `0x${"ef".repeat(32)}` as const;
/** What the chain minted in these tests: r, i, d, d, a. Never what the route itself would draw. */
const MINTED = [17, 8, 3, 3, 0];

// Letters.commits: (buyer, count, revealed)
let commitTuple: readonly unknown[] = [];
let readFails = false;
type LogQuery = { event: { name: string }; args: Record<string, unknown> };
const logQueries: LogQuery[] = [];
let revealedLogs: () => unknown[] = () => [];
vi.mock("@/lib/onchain/reads", async (orig) => ({
  ...(await orig<typeof import("@/lib/onchain/reads")>()),
  readLetterSupply: async () => ({ caps: Array(26).fill(1000), minted: Array(26).fill(0), available: Array(26).fill(1000) }),
  getPublicClient: () => ({
    readContract: async () => {
      if (readFails) throw new Error("out of range");
      return commitTuple;
    },
    getLogs: async (q: LogQuery) => {
      logQueries.push(q);
      return q.event.name === "Revealed" ? revealedLogs() : [];
    },
  }),
}));

let configured = true;
type Relay = import("@/lib/onchain/relayer").LettersRelay;
const relayLettersReveal = vi.fn(async (..._a: unknown[]): Promise<Relay> => ({ kind: "unavailable", reason: "send_failed" }));
vi.mock("@/lib/onchain/relayer", () => ({
  RELAY_WAIT_MS: 20_000,
  relayerConfigured: () => configured,
  relayLettersReveal: (...a: unknown[]) => relayLettersReveal(...a),
}));

const post = (body: unknown) =>
  new Request("http://localhost/api/mint/reveal", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.7" },
    body: JSON.stringify(body),
  });
const call = async (body: unknown) => {
  const route = await import("@/app/api/mint/reveal/route");
  const res = await route.POST(post(body));
  return { status: res.status, body: await res.json(), route };
};

/** A pull: one to five lowercase letters. */
const isPull = (v: unknown, count: number) => Array.isArray(v) && v.length === count && v.every((i) => Number.isInteger(i) && i >= 0 && i <= 25);

beforeEach(() => {
  configured = true;
  readFails = false;
  relayLettersReveal.mockClear();
  logQueries.length = 0;
  revealedLogs = () => [];
  commitTuple = [BUYER, 5, false];
});

describe("/api/mint/reveal without relay: exactly as before", () => {
  it("answers with the draw and its signature, and nothing else; the relayer is never asked", async () => {
    const { status, body } = await call({ commitId: "177" });
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    // the same four fields, in the same order, that every client before the relay read
    expect(Object.keys(body.reveal)).toEqual(["commitId", "buyer", "letterIndexes", "signature"]);
    expect(body.reveal.commitId).toBe("177");
    expect(body.reveal.buyer).toBe(BUYER);
    expect(isPull(body.reveal.letterIndexes, 5)).toBe(true);
    expect(body.reveal.signature).toMatch(/^0x[0-9a-f]{130}$/);
    expect(relayLettersReveal).not.toHaveBeenCalled();
  });

  it("the draw is fixed per commit: asking twice gives the same letters and the same signature", async () => {
    const a = await call({ commitId: "177" });
    const b = await call({ commitId: "177" });
    expect(b.body.reveal).toEqual(a.body.reveal);
  });

  it("an opened commit is still 409, a commit that doesn't exist 404, a bad id 400", async () => {
    commitTuple = [BUYER, 5, true];
    expect(await call({ commitId: "177" })).toMatchObject({ status: 409, body: { ok: false, error: "already_revealed" } });
    readFails = true;
    expect(await call({ commitId: "999999" })).toMatchObject({ status: 404, body: { ok: false, error: "unknown_commit" } });
    expect(await call({ commitId: "seven" })).toMatchObject({ status: 400, body: { ok: false, error: "bad_commit_id" } });
    expect(await call({ commitId: "seven", relay: true })).toMatchObject({ status: 400 });
    expect(relayLettersReveal).not.toHaveBeenCalled();
  });
});

describe("/api/mint/reveal with relay", () => {
  it("mined: answers with the letters the CHAIN minted, and no signature", async () => {
    relayLettersReveal.mockResolvedValueOnce({ kind: "mined", txHash: HASH, letterIndexes: MINTED });
    const { body } = await call({ commitId: "177", relay: true });
    expect(body.reveal).toEqual({ commitId: "177", buyer: BUYER, letterIndexes: MINTED, relayed: "mined", txHash: HASH });
    expect(body.reveal.signature).toBeUndefined();
  });

  it("sends the relayer this commit, the draw it signed, and that signature", async () => {
    relayLettersReveal.mockResolvedValueOnce({ kind: "mined", txHash: HASH, letterIndexes: MINTED });
    await call({ commitId: "177", relay: true });
    expect(relayLettersReveal).toHaveBeenCalledTimes(1);
    const [id, drawn, signature] = relayLettersReveal.mock.calls[0];
    expect(id).toBe(177n);
    expect(isPull(drawn, 5)).toBe(true);
    expect(signature).toMatch(/^0x[0-9a-f]{130}$/);
    // and it is the very draw the wallet path would have been handed
    const plain = await call({ commitId: "177" });
    expect(drawn).toEqual(plain.body.reveal.letterIndexes);
    expect(signature).toBe(plain.body.reveal.signature);
  });

  it("pending or reverted: broadcast, so NO letters and NO signature", async () => {
    for (const kind of ["pending", "reverted"] as const) {
      relayLettersReveal.mockResolvedValueOnce({ kind, txHash: HASH });
      const { body } = await call({ commitId: "177", relay: true });
      expect(body.reveal).toEqual({ commitId: "177", buyer: BUYER, relayed: kind, txHash: HASH });
    }
  });

  it("unavailable (nothing was broadcast): the signature, exactly as without relay, for the wallet to send", async () => {
    relayLettersReveal.mockResolvedValueOnce({ kind: "unavailable", reason: "relayer_unfunded" });
    const relayed = await call({ commitId: "177", relay: true });
    const plain = await call({ commitId: "177" });
    expect(relayed.body).toEqual(plain.body);
    expect(relayed.body.reveal.relayed).toBeUndefined();
  });

  it("with no relayer key the relayer is never asked, and the answer is the signature", async () => {
    configured = false;
    const { body } = await call({ commitId: "177", relay: true });
    expect(relayLettersReveal).not.toHaveBeenCalled();
    expect(Object.keys(body.reveal)).toEqual(["commitId", "buyer", "letterIndexes", "signature"]);
  });

  it("`relay` must be exactly true: a truthy string is not a request to send anything", async () => {
    const { body } = await call({ commitId: "177", relay: "true" });
    expect(relayLettersReveal).not.toHaveBeenCalled();
    expect(body.reveal.signature).toBeDefined();
  });

  it("a daily letter (one letter) is relayed the same way", async () => {
    commitTuple = [BUYER, 1, false];
    relayLettersReveal.mockResolvedValueOnce({ kind: "mined", txHash: HASH, letterIndexes: [16] });
    const { body } = await call({ commitId: "212", relay: true });
    expect(isPull(relayLettersReveal.mock.calls[0][1], 1)).toBe(true);
    expect(body.reveal).toMatchObject({ relayed: "mined", letterIndexes: [16] });
  });
});

describe("/api/mint/reveal with relay, for a pack opened already", () => {
  beforeEach(() => {
    commitTuple = [BUYER, 5, true];
  });

  it("answers “already” with the letters from the reveal's own event, and sends nothing", async () => {
    revealedLogs = () => [{ args: { commitId: 177n, buyer: BUYER, letterIds: MINTED.map(BigInt) } }];
    const { status, body } = await call({ commitId: "177", relay: true });
    expect(status).toBe(200);
    expect(body.reveal).toEqual({ commitId: "177", buyer: BUYER, letterIndexes: MINTED, relayed: "already" });
    expect(relayLettersReveal).not.toHaveBeenCalled();
    // one log lookup, by the indexed commit id, for the event the generated ABI names
    const asked = logQueries.filter((q) => q.event.name === "Revealed");
    expect(asked).toHaveLength(1);
    expect(asked[0].args).toEqual({ commitId: 177n });
  });

  it("never the draw: when the event can't be read, the answer names no letters", async () => {
    revealedLogs = () => [];
    expect((await call({ commitId: "177", relay: true })).body.reveal).toEqual({ commitId: "177", buyer: BUYER, relayed: "already" });
    revealedLogs = () => {
      throw new Error("query returned more than 10000 results");
    };
    expect((await call({ commitId: "177", relay: true })).body.reveal).toEqual({ commitId: "177", buyer: BUYER, relayed: "already" });
  });

  it("an id in the event that is not a lowercase letter is never passed on", async () => {
    revealedLogs = () => [{ args: { commitId: 177n, buyer: BUYER, letterIds: [26n, 1n, 2n, 3n, 4n] } }];
    expect((await call({ commitId: "177", relay: true })).body.reveal.letterIndexes).toBeUndefined();
  });
});

describe("the route's own settings", () => {
  it("allows the request to outlast the relayer's wait for a block", async () => {
    const { route } = await call({ commitId: "177" });
    expect((route as unknown as { maxDuration: number }).maxDuration).toBeGreaterThan(20);
  });
});
