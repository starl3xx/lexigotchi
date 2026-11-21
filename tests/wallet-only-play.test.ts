/**
 * A wallet with no Farcaster account can play the whole paid loop (decisions.md #9): buy a pack,
 * roll a letter, ascend a word. Two things used to stop it on the chain store: no paid-pack action
 * at all (the only pack was the free campaign voucher), and reveal routes that 401'd without a
 * Farcaster session.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { decodeFunctionData, maxUint256, recoverMessageAddress, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import sepolia from "../config/deployments.base-sepolia.json";

// Real addresses exist only on the Sepolia registry; mainnet is all-null and addressOf() throws.
vi.stubEnv("NEXT_PUBLIC_CHAIN_ID", "84532");

const SIGNER_KEY = generatePrivateKey();
vi.stubEnv("SIGNER_PRIVATE_KEY", SIGNER_KEY);
vi.stubEnv("SIGNER_DRAW_SECRET", "test-secret-not-a-real-one");

// No Farcaster session, ever, in this file.
vi.mock("@/lib/auth/quickAuth", () => ({ getAuthedFid: async () => null }));
const allow = vi.fn(async (..._args: unknown[]) => true);
vi.mock("@/lib/ratelimit", () => ({ allow: (...a: unknown[]) => allow(...a) }));

const PLAYER = "0x51E29Ba3Ff9ebdb5e6d32f6AB52F2FD3b21Ae1E3" as const;
const LETTERS = sepolia.contracts.letters.toLowerCase(); // from the registry: survives a redeploy
const TOKEN = sepolia.wordToken.toLowerCase();

let commitTuple: readonly unknown[] = [];
vi.mock("@/lib/onchain/reads", async (orig) => ({
  ...(await orig<typeof import("@/lib/onchain/reads")>()),
  getPublicClient: () => ({ readContract: async () => commitTuple }),
}));

let A: typeof import("@/lib/onchain/actions");
let abis: typeof import("@/lib/onchain/abis");
beforeAll(async () => {
  A = await import("@/lib/onchain/actions");
  abis = await import("@/lib/onchain/abis");
});
beforeEach(() => allow.mockClear());

const wei = (n: bigint) => n * 10n ** 18n;
const params = () =>
  ({ wei: { pack: wei(4_242_861n), daily: 0n, roll: 0n, claim: 0n, snack: 0n, prestigeFee: 0n, prestigeSnackCost: 0n } }) as unknown as import("@/lib/onchain/reads").GameParams;
const player = (lettersAllowance: bigint) =>
  ({
    balanceWei: 0n,
    balance: 0,
    allowance: { letters: lettersAllowance, words: 0n, staking: 0n, rolls: 0n, prestige: 0n },
    operator: { lettersToWords: false, wordsToStaking: false },
    letters: Array.from({ length: 52 }, () => 0),
  }) as import("@/lib/onchain/reads").PlayerState;

describe("a paid pack", () => {
  it("approves $WORD to Letters, then commits", () => {
    const calls = A.commitPackCalls(params(), player(0n));
    expect(calls.map((c) => c.to.toLowerCase())).toEqual([TOKEN, LETTERS]);
    const approve = decodeFunctionData({ abi: abis.erc20Abi, data: calls[0].data! });
    expect(approve.functionName).toBe("approve");
    // The collector is Letters, never the FeeRouter: approving the router would revert the commit.
    expect((approve.args![0] as string).toLowerCase()).toBe(LETTERS);
    expect(decodeFunctionData({ abi: abis.lettersAbi, data: calls[1].data! }).functionName).toBe("commitPack");
  });

  it("skips the approval when the allowance already covers it", () => {
    const calls = A.commitPackCalls(params(), player(maxUint256));
    expect(calls).toHaveLength(1);
    expect(decodeFunctionData({ abi: abis.lettersAbi, data: calls[0].data! }).functionName).toBe("commitPack");
  });
});

describe("prices come from the store that charges them", () => {
  const word = { pack: 4_000_000, daily: 0, roll: 1_000_000, claim: 2_000_000, snack: 80_000, prestigeFee: 1_100_000, prestigeSnackCost: 90_000 };

  it("the chain store reads the contract's price for every item", async () => {
    const { chainPrice } = await import("@/components/game/state");
    expect(chainPrice(word, "pack")).toBe(4_000_000);
    expect(chainPrice(word, "roll")).toBe(1_000_000);
    expect(chainPrice(word, "claim")).toBe(2_000_000);
    expect(chainPrice(word, "snack")).toBe(80_000);
    expect(chainPrice(word, "prestige")).toBe(1_100_000);
    // Ascension burns Prestige's own snack cost, not Staking's snack price.
    expect(chainPrice(word, "prestigeSnack")).toBe(90_000);
  });

  it("the mock store keeps its own table", async () => {
    const { MOCK_PRICE, COST } = await import("@/components/game/state");
    expect(MOCK_PRICE.pack).toBe(COST.pack);
    expect(MOCK_PRICE.prestigeSnack).toBe(COST.snack);
  });
});

const post = (path: string, body: unknown) =>
  new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.7" },
    body: JSON.stringify(body),
  });

describe("the reveal routes serve a wallet with no Farcaster session", () => {
  it("roll: signs the outcome for the commit's stored owner, rate-limited by IP", async () => {
    // Rolls.commits: (owner, letterIndex, tokenId?, pos?, revealed, pityAtCommit, ...)
    commitTuple = [PLAYER, 4, 0, 0, false, 2, 0n];
    const { POST } = await import("@/app/api/roll/reveal/route");
    const res = await POST(post("/api/roll/reveal", { commitId: "7" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(typeof body.reveal.success).toBe("boolean");
    expect(body.reveal.signature).toMatch(/^0x[0-9a-f]{130}$/);
    expect(allow).toHaveBeenCalledWith("record-add", "203.0.113.7");
  });

  it("roll: the same commit always gets the same answer (no re-asking until it wins)", async () => {
    commitTuple = [PLAYER, 4, 0, 0, false, 0, 0n];
    const { POST } = await import("@/app/api/roll/reveal/route");
    const answers = new Set<boolean>();
    for (let i = 0; i < 5; i++) answers.add((await (await POST(post("/api/roll/reveal", { commitId: "9" }))).json()).reveal.success);
    expect(answers.size).toBe(1);
  });

  it("roll: an already-revealed commit is refused, signed-in or not", async () => {
    commitTuple = [PLAYER, 4, 0, 0, true, 0, 0n];
    const { POST } = await import("@/app/api/roll/reveal/route");
    expect((await POST(post("/api/roll/reveal", { commitId: "7" }))).status).toBe(409);
  });

  it("ascension: signs for the stored owner with no session", async () => {
    // Prestige.commits: (tokenId, owner, revealed, pityAtCommit)
    commitTuple = [123n, PLAYER, false, 1];
    const { POST } = await import("@/app/api/prestige/reveal/route");
    const res = await POST(post("/api/prestige/reveal", { commitId: "3" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.reveal.signature).toMatch(/^0x[0-9a-f]{130}$/);
  });

  it("the signature comes from the configured signer key", async () => {
    commitTuple = [PLAYER, 4, 0, 0, false, 0, 0n];
    const { POST } = await import("@/app/api/roll/reveal/route");
    const { rollsRevealDigest } = await import("@/lib/onchain/digests");
    const { addressOf } = await import("@/lib/onchain/addresses");
    const body = await (await POST(post("/api/roll/reveal", { commitId: "11" }))).json();
    const digest = rollsRevealDigest({
      rolls: addressOf("rolls"),
      commitId: 11n,
      owner: PLAYER,
      letterIndex: 4,
      success: body.reveal.success,
    });
    const signer = await recoverMessageAddress({ message: { raw: digest }, signature: body.reveal.signature as Hex });
    expect(signer).toBe(privateKeyToAccount(SIGNER_KEY).address);
  });
});
