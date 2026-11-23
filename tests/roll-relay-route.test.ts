/**
 * The server finishes rolls (decisions.md #14): /api/roll/reveal with `{ relay: true }` sends the
 * reveal from the relayer key, so the player's wallet never previews the result. Pinned here: which
 * answer carries a signature (only "nothing was broadcast"), and that an old client, or a server
 * with no relayer key, keeps the wallet path exactly as before.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { generatePrivateKey } from "viem/accounts";

vi.stubEnv("NEXT_PUBLIC_CHAIN_ID", "84532");
vi.stubEnv("SIGNER_PRIVATE_KEY", generatePrivateKey());
vi.stubEnv("SIGNER_DRAW_SECRET", "test-secret-not-a-real-one");

vi.mock("@/lib/auth/quickAuth", () => ({ getAuthedFid: async () => null }));
vi.mock("@/lib/ratelimit", () => ({ allow: async () => true }));

const PLAYER = "0x51E29Ba3Ff9ebdb5e6d32f6AB52F2FD3b21Ae1E3" as const;
const HASH = `0x${"ab".repeat(32)}` as const;

// Rolls.commits: (owner, letterIndex, kind, pos, revealed, pityAtCommit, tokenId)
let commitTuple: readonly unknown[] = [];
vi.mock("@/lib/onchain/reads", async (orig) => ({
  ...(await orig<typeof import("@/lib/onchain/reads")>()),
  getPublicClient: () => ({ readContract: async () => commitTuple }),
}));

let configured = true;
type Relay = import("@/lib/onchain/relayer").RollRelay;
const relayRollReveal = vi.fn(async (..._a: unknown[]): Promise<Relay> => ({ kind: "unavailable", reason: "send_failed" }));
vi.mock("@/lib/onchain/relayer", () => ({
  RELAY_WAIT_MS: 20_000,
  relayerConfigured: () => configured,
  relayRollReveal: (...a: unknown[]) => relayRollReveal(...a),
}));

const post = (body: unknown) =>
  new Request("http://localhost/api/roll/reveal", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.7" },
    body: JSON.stringify(body),
  });
const call = async (body: unknown) => {
  const { POST } = await import("@/app/api/roll/reveal/route");
  const res = await POST(post(body));
  return { status: res.status, body: await res.json() };
};

beforeEach(() => {
  configured = true;
  relayRollReveal.mockClear();
  commitTuple = [PLAYER, 4, 0, 0, false, 2, 0n];
});

describe("/api/roll/reveal with relay", () => {
  it("mined: answers with the outcome the chain applied and the exact pity, and no signature", async () => {
    relayRollReveal.mockResolvedValueOnce({ kind: "mined", txHash: HASH, success: false, pity: 3 });
    const { body } = await call({ commitId: "7", relay: true });
    expect(relayRollReveal).toHaveBeenCalledTimes(1);
    expect(body.reveal).toMatchObject({ relayed: "mined", success: false, pity: 3, letterIndex: 4, txHash: HASH });
    expect(body.reveal.owner.toLowerCase()).toBe(PLAYER.toLowerCase());
    expect(body.reveal.signature).toBeUndefined();
  });

  it("the chain's outcome wins over the signed one (a stale signed success is a no-op on chain)", async () => {
    relayRollReveal.mockResolvedValueOnce({ kind: "mined", txHash: HASH, success: false, pity: 2 });
    const { body } = await call({ commitId: "7", relay: true });
    expect(body.reveal.success).toBe(false);
    expect(body.reveal.pity).toBe(2);
  });

  it("pending or reverted: broadcast, so NO signature (a wallet reveal would only revert)", async () => {
    for (const kind of ["pending", "reverted"] as const) {
      relayRollReveal.mockResolvedValueOnce({ kind, txHash: HASH });
      const { body } = await call({ commitId: "7", relay: true });
      expect(body.reveal.relayed).toBe(kind);
      expect(body.reveal.signature).toBeUndefined();
    }
  });

  it("unavailable (nothing broadcast): falls back to the signature, and the wallet sends it", async () => {
    relayRollReveal.mockResolvedValueOnce({ kind: "unavailable", reason: "relayer_unfunded" });
    const { body } = await call({ commitId: "7", relay: true });
    expect(body.reveal.relayed).toBeUndefined();
    expect(body.reveal.signature).toMatch(/^0x[0-9a-f]{130}$/);
  });

  it("no relayer key: never tries, answers with the signature", async () => {
    configured = false;
    const { body } = await call({ commitId: "7", relay: true });
    expect(relayRollReveal).not.toHaveBeenCalled();
    expect(body.reveal.signature).toMatch(/^0x[0-9a-f]{130}$/);
  });

  it("an old client (no relay flag) keeps the wallet path exactly", async () => {
    const { body } = await call({ commitId: "7" });
    expect(relayRollReveal).not.toHaveBeenCalled();
    expect(body.reveal.signature).toMatch(/^0x[0-9a-f]{130}$/);
  });

  it("already revealed: the outcome under relay (a lost response is normal there), 409 without", async () => {
    commitTuple = [PLAYER, 4, 0, 0, true, 2, 0n];
    const relayed = await call({ commitId: "7", relay: true });
    expect(relayed.status).toBe(200);
    expect(relayed.body.reveal.relayed).toBe("already");
    expect(typeof relayed.body.reveal.success).toBe("boolean");
    expect(relayRollReveal).not.toHaveBeenCalled();
    expect((await call({ commitId: "7" })).status).toBe(409);
  });
});
