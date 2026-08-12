import { describe, it, expect, vi, beforeAll } from "vitest";
import { decodeFunctionData, maxUint256 } from "viem";

// The action builders resolve real addresses, which only exist on the Sepolia registry — mainnet is
// still all-null and addressOf() throws by design. Stub before importing; vitest isolates the module
// registry per file, so this doesn't leak into the mainnet-safety assertions in addresses.test.ts.
vi.stubEnv("NEXT_PUBLIC_CHAIN_ID", "84532");

let A: typeof import("@/lib/onchain/actions");
let abis: typeof import("@/lib/onchain/abis");
beforeAll(async () => {
  A = await import("@/lib/onchain/actions");
  abis = await import("@/lib/onchain/abis");
});

const LETTERS = "0xdf7bB55D701d16d772Fad43f53eE4560De2De263".toLowerCase();
const WORDS = "0xD820ffEf97f223C5a1BFe6d1FD4096ab78cfc441".toLowerCase();
const STAKING = "0x5Ad5B9cCBe7860CfbBA1a59ed690C35C7C45Af7c".toLowerCase();
const TOKEN = "0x4abE1BC87fc508aF1A9D2Ac31E5AC1Af2a1122Ea".toLowerCase();
const PLAYER = "0x51E29Ba3Ff9ebdb5e6d32f6AB52F2FD3b21Ae1E3" as const;
// A merkle proof element is bytes32 — a short hex value is an encoding error, not a valid stub.
const PROOF = "0x42d44c493d4fd7d63fddcc7a777379f861156a1271a30341a31b628cd8bb692f" as const;

const wei = (n: bigint) => n * 10n ** 18n;

const params = () => ({
  wei: {
    pack: wei(4_242_861n),
    daily: 0n,
    roll: wei(1_060_715n),
    claim: wei(2_121_431n),
    snack: wei(84_857n),
    prestigeFee: wei(1_060_715n),
    prestigeSnackCost: wei(84_857n),
  },
  word: { pack: 0, daily: 0, roll: 0, claim: 0, snack: 0, prestigeFee: 0, prestigeSnackCost: 0 },
  maxPrestigeLevel: 4,
  peckishAfterSeconds: 86400,
  hungryAfterSeconds: 259200,
  freeDailySnack: true,
  freePackOpen: true,
}) as unknown as import("@/lib/onchain/reads").GameParams;

const barePlayer = () => ({
  balanceWei: 0n,
  balance: 0,
  allowance: { letters: 0n, words: 0n, staking: 0n, rolls: 0n, prestige: 0n },
  operator: { lettersToWords: false, wordsToStaking: false },
  letters: Array.from({ length: 52 }, () => 0),
}) as import("@/lib/onchain/reads").PlayerState;

const approvedPlayer = () => ({
  ...barePlayer(),
  allowance: { letters: maxUint256, words: maxUint256, staking: maxUint256, rolls: maxUint256, prestige: maxUint256 },
  operator: { lettersToWords: true, wordsToStaking: true },
});

describe("free paths need no approvals", () => {
  it("free pack is a single call", () => {
    const calls = A.commitFreePackCalls({ fid: 1n, nonce: 1n, deadline: 2n, signature: "0x00" });
    expect(calls).toHaveLength(1);
    expect(calls[0].to.toLowerCase()).toBe(LETTERS);
  });

  it("free daily is a single call", () => {
    expect(A.commitFreeDailyCalls({ fid: 1n, deadline: 2n, signature: "0x00" })).toHaveLength(1);
  });
});

describe("claim composes operator + allowance + claim, in that order", () => {
  it("emits all three for a fresh player", () => {
    const calls = A.claimCalls("CRANE", [PROOF], false, params(), barePlayer());
    expect(calls).toHaveLength(3);
    expect(calls[0].to.toLowerCase()).toBe(LETTERS); // setApprovalForAll on the 1155
    expect(calls[1].to.toLowerCase()).toBe(TOKEN); // $WORD allowance
    expect(calls[2].to.toLowerCase()).toBe(WORDS); // the claim itself
  });

  it("drops both approvals once they exist", () => {
    const calls = A.claimCalls("CRANE", [PROOF], false, params(), approvedPlayer());
    expect(calls).toHaveLength(1);
    expect(calls[0].to.toLowerCase()).toBe(WORDS);
  });

  // The contract requires 'A'..'Z'; the merkle leaf and tokenId are over the same uppercase string.
  it("uppercases the word regardless of input casing", () => {
    const calls = A.claimCalls("crane", [PROOF], false, params(), approvedPlayer());
    const decoded = decodeFunctionData({ abi: abis.wordsAbi, data: calls[0].data! });
    expect(decoded.args?.[0]).toBe("CRANE");
  });

  it("approves $WORD to WORDS, not to the fee router", () => {
    const calls = A.claimCalls("CRANE", [PROOF], false, params(), barePlayer());
    const decoded = decodeFunctionData({ abi: abis.erc20Abi, data: calls[1].data! });
    expect((decoded.args?.[0] as string).toLowerCase()).toBe(WORDS);
  });
});

describe("staking", () => {
  it("stake includes the 721 operator approval when missing", () => {
    const calls = A.stakeCalls(1n, barePlayer());
    expect(calls).toHaveLength(2);
    expect(calls[0].to.toLowerCase()).toBe(WORDS);
    expect(calls[1].to.toLowerCase()).toBe(STAKING);
  });

  it("unstake needs nothing", () => {
    expect(A.unstakeCalls(1n)).toHaveLength(1);
  });

  it("the free daily feed needs no allowance", () => {
    expect(A.feedCalls(1n, params(), barePlayer(), true)).toHaveLength(1);
  });

  it("a paid feed does", () => {
    expect(A.feedCalls(1n, params(), barePlayer(), false)).toHaveLength(2);
  });

  it("feedMany sizes the approval for n-1 when the free feed is available", () => {
    const calls = A.feedManyCalls([1n, 2n, 3n], params(), barePlayer(), true);
    const decoded = decodeFunctionData({ abi: abis.erc20Abi, data: calls[0].data! });
    // maxUint256 by strategy, but the call must exist at all — n-1 = 2 paid snacks > 0.
    expect(decoded.functionName).toBe("approve");
    expect(A.feedManyCalls([1n], params(), barePlayer(), true)).toHaveLength(1); // 0 paid → no approval
  });
});

describe("prestige approves the SUM of both collects", () => {
  // commitPrestige pulls fee then snack in one tx; a fee-sized allowance reverts on the second.
  it("approves at least fee + snackCost", () => {
    const p = params();
    const calls = A.commitPrestigeCalls(1n, p, { ...barePlayer(), allowance: { ...barePlayer().allowance, prestige: p.wei.prestigeFee } });
    // The fee alone is NOT enough, so an approval must still be emitted.
    expect(calls).toHaveLength(2);
  });

  it("skips the approval only when it covers fee + snackCost together", () => {
    const p = params();
    const enough = p.wei.prestigeFee + p.wei.prestigeSnackCost;
    const calls = A.commitPrestigeCalls(1n, p, { ...barePlayer(), allowance: { ...barePlayer().allowance, prestige: enough } });
    expect(calls).toHaveLength(1);
  });
});

describe("faucet is testnet-only", () => {
  it("builds a mint call on Sepolia", () => {
    const calls = A.faucetCalls(PLAYER, 1_000_000);
    expect(calls).toHaveLength(1);
    expect(calls[0].to.toLowerCase()).toBe(TOKEN);
    const decoded = decodeFunctionData({ abi: abis.erc20Abi, data: calls[0].data! });
    expect(decoded.functionName).toBe("mint");
    expect(decoded.args?.[1]).toBe(1_000_000n * 10n ** 18n);
  });
});
