/**
 * The server finishes ascension attempts (decisions.md #14 named it as a later case):
 * /api/prestige/reveal with `{ relay: true }` sends the reveal from the relayer key, so the player
 * confirms one transaction per attempt. Pinned here: which answer carries a signature (only
 * "nothing was broadcast"), that a relayed answer says what the CHAIN did and never the signed
 * outcome, and that a client from before the relay, or a server with no relayer key, keeps the
 * wallet path exactly as it was.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { generatePrivateKey } from "viem/accounts";

vi.stubEnv("NEXT_PUBLIC_CHAIN_ID", "84532");
vi.stubEnv("SIGNER_PRIVATE_KEY", generatePrivateKey());
vi.stubEnv("SIGNER_DRAW_SECRET", "test-secret-not-a-real-one");

vi.mock("@/lib/auth/quickAuth", () => ({ getAuthedFid: async () => null }));
vi.mock("@/lib/ratelimit", () => ({ allow: async () => true }));

const STAKER = "0x51E29Ba3Ff9ebdb5e6d32f6AB52F2FD3b21Ae1E3" as const;
const HASH = `0x${"cd".repeat(32)}` as const;
const TOKEN = 123456789n;

// Prestige.commits: (tokenId, owner, revealed, pityAtCommit, level)
let commitTuple: readonly unknown[] = [];
let readFails = false;
vi.mock("@/lib/onchain/reads", async (orig) => ({
  ...(await orig<typeof import("@/lib/onchain/reads")>()),
  getPublicClient: () => ({
    readContract: async () => {
      if (readFails) throw new Error("out of range");
      return commitTuple;
    },
  }),
}));

let configured = true;
type Relay = import("@/lib/onchain/relayer").PrestigeRelay;
const relayPrestigeReveal = vi.fn(async (..._a: unknown[]): Promise<Relay> => ({ kind: "unavailable", reason: "send_failed" }));
const relayRollReveal = vi.fn();
vi.mock("@/lib/onchain/relayer", () => ({
  RELAY_WAIT_MS: 20_000,
  relayerConfigured: () => configured,
  relayPrestigeReveal: (...a: unknown[]) => relayPrestigeReveal(...a),
  relayRollReveal: (...a: unknown[]) => relayRollReveal(...a),
}));

const post = (body: unknown) =>
  new Request("http://localhost/api/prestige/reveal", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.7" },
    body: JSON.stringify(body),
  });
const call = async (body: unknown) => {
  const route = await import("@/app/api/prestige/reveal/route");
  const res = await route.POST(post(body));
  return { status: res.status, body: await res.json(), route };
};

beforeEach(() => {
  configured = true;
  readFails = false;
  relayPrestigeReveal.mockClear();
  relayRollReveal.mockClear();
  // an open attempt at stage 1 (trying for Gilded 2), two misses in
  commitTuple = [TOKEN, STAKER, false, 2, 1];
});

describe("/api/prestige/reveal with relay", () => {
  it("mined, a hit: answers with the stage the chain reached and a clean pity, and no signature", async () => {
    relayPrestigeReveal.mockResolvedValueOnce({ kind: "mined", txHash: HASH, success: true, level: 2, pity: 0 });
    const { body } = await call({ commitId: "7", relay: true });
    expect(relayPrestigeReveal).toHaveBeenCalledTimes(1);
    expect(body.reveal).toMatchObject({ relayed: "mined", success: true, stage: 2, pity: 0, txHash: HASH });
    expect(body.reveal.signature).toBeUndefined();
  });

  it("mined, a miss: the word's stage and its pity as the reveal left them", async () => {
    relayPrestigeReveal.mockResolvedValueOnce({ kind: "mined", txHash: HASH, success: false, level: 1, pity: 3 });
    const { body } = await call({ commitId: "7", relay: true });
    expect(body.reveal).toMatchObject({ relayed: "mined", success: false, stage: 1, pity: 3 });
    expect(body.reveal.signature).toBeUndefined();
  });

  it("the chain's outcome wins over the signed one (a signed success that no longer counts is no hit)", async () => {
    // Whatever this route drew and signed, the answer is the relayer's reading of the mined reveal:
    // "failed", with the pity UNCHANGED (2, as at the commit), is what Prestige emits for it.
    relayPrestigeReveal.mockResolvedValueOnce({ kind: "mined", txHash: HASH, success: false, level: 1, pity: 2 });
    const { body } = await call({ commitId: "7", relay: true });
    expect(body.reveal.success).toBe(false);
    expect(body.reveal.pity).toBe(2);
  });

  it("mined, but the level after a miss couldn't be read: stage is null, never a guess", async () => {
    relayPrestigeReveal.mockResolvedValueOnce({ kind: "mined", txHash: HASH, success: false, level: null, pity: 3 });
    const { body } = await call({ commitId: "7", relay: true });
    expect(body.reveal.relayed).toBe("mined");
    expect(body.reveal.stage).toBeNull();
  });

  it("keeps the commit's own facts beside the result: the game checks a resumed attempt is this word's", async () => {
    relayPrestigeReveal.mockResolvedValueOnce({ kind: "mined", txHash: HASH, success: true, level: 2, pity: 0 });
    const { body } = await call({ commitId: "7", relay: true });
    // `level` is the stage the attempt was PAID at; `stage` is where the word stands now
    expect(body.reveal).toMatchObject({ commitId: "7", tokenId: String(TOKEN), level: 1, pityAtCommit: 2, stage: 2 });
    expect(body.reveal.owner.toLowerCase()).toBe(STAKER.toLowerCase());
  });

  it("pending or reverted: broadcast, so NO signature (a wallet reveal would only revert) and no outcome claimed", async () => {
    for (const kind of ["pending", "reverted"] as const) {
      relayPrestigeReveal.mockResolvedValueOnce({ kind, txHash: HASH });
      const { body } = await call({ commitId: "7", relay: true });
      expect(body.reveal.relayed).toBe(kind);
      expect(body.reveal.signature).toBeUndefined();
      // not seen to land: the game reads the result from the chain, so none is handed over
      expect(body.reveal.success).toBeUndefined();
      expect(body.reveal.stage).toBeUndefined();
    }
  });

  it("unavailable (nothing broadcast): falls back to the signature, and the wallet sends it", async () => {
    relayPrestigeReveal.mockResolvedValueOnce({ kind: "unavailable", reason: "relayer_unfunded" });
    const { body } = await call({ commitId: "7", relay: true });
    expect(body.reveal.relayed).toBeUndefined();
    expect(body.reveal.signature).toMatch(/^0x[0-9a-f]{130}$/);
    expect(typeof body.reveal.success).toBe("boolean");
  });

  it("no relayer key: never tries, answers with the signature", async () => {
    configured = false;
    const { body } = await call({ commitId: "7", relay: true });
    expect(relayPrestigeReveal).not.toHaveBeenCalled();
    expect(body.reveal.signature).toMatch(/^0x[0-9a-f]{130}$/);
  });

  it("never sends a roll's reveal: an ascension is finished on Prestige", async () => {
    relayPrestigeReveal.mockResolvedValueOnce({ kind: "mined", txHash: HASH, success: true, level: 2, pity: 0 });
    await call({ commitId: "7", relay: true });
    expect(relayRollReveal).not.toHaveBeenCalled();
  });

  it("already revealed: “already” under relay, with no outcome claimed and nothing sent", async () => {
    commitTuple = [TOKEN, STAKER, true, 2, 1];
    const relayed = await call({ commitId: "7", relay: true });
    expect(relayed.status).toBe(200);
    expect(relayed.body.reveal).toMatchObject({ relayed: "already", level: 1 });
    // the signed outcome may not be what the chain applied, so it isn't offered as the result
    expect(relayed.body.reveal.success).toBeUndefined();
    expect(relayed.body.reveal.signature).toBeUndefined();
    expect(relayPrestigeReveal).not.toHaveBeenCalled();
  });
});

describe("/api/prestige/reveal without the relay flag (a client from before the relay)", () => {
  it("answers exactly as it always did: the signed outcome and the commit's facts", async () => {
    const { status, body } = await call({ commitId: "7" });
    expect(status).toBe(200);
    expect(relayPrestigeReveal).not.toHaveBeenCalled();
    expect(Object.keys(body.reveal).sort()).toEqual(["commitId", "level", "owner", "pityAtCommit", "probability", "signature", "success", "tokenId"]);
    expect(body.reveal.signature).toMatch(/^0x[0-9a-f]{130}$/);
    expect(body.reveal).toMatchObject({ commitId: "7", tokenId: String(TOKEN), level: 1, pityAtCommit: 2 });
  });

  it("an already-revealed commit is still a 409", async () => {
    commitTuple = [TOKEN, STAKER, true, 2, 1];
    const { status, body } = await call({ commitId: "7" });
    expect(status).toBe(409);
    expect(body).toEqual({ ok: false, error: "already_revealed" });
  });

  it("the outcome is fixed per commit: asking twice gives the same answer", async () => {
    const a = await call({ commitId: "7" });
    const b = await call({ commitId: "7" });
    expect(b.body.reveal.success).toBe(a.body.reveal.success);
    expect(b.body.reveal.signature).toBe(a.body.reveal.signature);
  });
});

describe("/api/prestige/reveal refuses before anything is sent", () => {
  it("a bad or unknown commit id never reaches the relayer", async () => {
    expect((await call({ commitId: "seven", relay: true })).status).toBe(400);
    readFails = true;
    expect((await call({ commitId: "999999", relay: true })).status).toBe(404);
    readFails = false;
    commitTuple = [0n, "0x0000000000000000000000000000000000000000", false, 0, 0];
    expect((await call({ commitId: "7", relay: true })).status).toBe(404);
    expect(relayPrestigeReveal).not.toHaveBeenCalled();
  });

  it("gives the relayed wait room: the function may run 30 s, past the relayer's 20 s wait for a block", async () => {
    const { route } = await call({ commitId: "7" });
    expect(route.maxDuration).toBeGreaterThanOrEqual(30);
  });
});
