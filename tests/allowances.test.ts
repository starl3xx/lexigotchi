import { describe, it, expect } from "vitest";
import { decodeFunctionData, maxUint256 } from "viem";
import {
  erc20ApprovalCalls,
  operatorApprovalCalls,
  prestigeTotalNeeded,
  feedManyNeeded,
} from "@/lib/onchain/allowances";
import { erc20Abi, erc1155ApprovalAbi } from "@/lib/onchain/abis";

const TOKEN = "0x4abE1BC87fc508aF1A9D2Ac31E5AC1Af2a1122Ea" as const;
const LETTERS = "0xdf7bB55D701d16d772Fad43f53eE4560De2De263" as const;
const WORDS = "0xD820ffEf97f223C5a1BFe6d1FD4096ab78cfc441" as const;
const PACK = 4_242_861n * 10n ** 18n;

describe("erc20 approvals", () => {
  it("emits nothing when the allowance already covers the spend", () => {
    expect(erc20ApprovalCalls({ token: TOKEN, spender: LETTERS, current: PACK, needed: PACK })).toEqual([]);
    expect(erc20ApprovalCalls({ token: TOKEN, spender: LETTERS, current: maxUint256, needed: PACK })).toEqual([]);
  });

  // dailyPrice is 0 live; _collect short-circuits on amount > 0, so an approve would be pure friction.
  it("emits nothing for a zero-cost action even with zero allowance", () => {
    expect(erc20ApprovalCalls({ token: TOKEN, spender: LETTERS, current: 0n, needed: 0n })).toEqual([]);
  });

  it("emits an approve when short, targeting the token with the right spender", () => {
    const calls = erc20ApprovalCalls({ token: TOKEN, spender: LETTERS, current: 0n, needed: PACK });
    expect(calls).toHaveLength(1);
    expect(calls[0].to).toBe(TOKEN);
    const decoded = decodeFunctionData({ abi: erc20Abi, data: calls[0].data! });
    expect(decoded.functionName).toBe("approve");
    // Spender must be the COLLECTOR (Letters), never FeeRouter — FeeCollector.sol:29 does the pull.
    expect(decoded.args?.[0]).toBe(LETTERS);
    expect(decoded.args?.[1]).toBe(maxUint256);
  });

  it("honours the exact strategy when asked", () => {
    const calls = erc20ApprovalCalls({ token: TOKEN, spender: LETTERS, current: 0n, needed: PACK, strategy: "exact" });
    const decoded = decodeFunctionData({ abi: erc20Abi, data: calls[0].data! });
    expect(decoded.args?.[1]).toBe(PACK);
  });

  it("re-approves when the allowance is short by even one wei", () => {
    expect(erc20ApprovalCalls({ token: TOKEN, spender: LETTERS, current: PACK - 1n, needed: PACK })).toHaveLength(1);
  });
});

describe("operator approvals", () => {
  it("emits nothing when already approved", () => {
    expect(operatorApprovalCalls({ collection: LETTERS, operator: WORDS, approved: true })).toEqual([]);
  });

  it("emits setApprovalForAll — not a per-token approve — when not approved", () => {
    const calls = operatorApprovalCalls({ collection: LETTERS, operator: WORDS, approved: false });
    expect(calls).toHaveLength(1);
    expect(calls[0].to).toBe(LETTERS);
    const decoded = decodeFunctionData({ abi: erc1155ApprovalAbi, data: calls[0].data! });
    expect(decoded.functionName).toBe("setApprovalForAll");
    expect(decoded.args).toEqual([WORDS, true]);
  });
});

describe("prestige needs the SUM of both collects", () => {
  // Prestige.sol:83-84 pulls twice in one tx; approving the fee alone reverts on the second pull.
  it("adds the fee and the burned snack", () => {
    const fee = 1_060_715n * 10n ** 18n;
    const snack = 84_857n * 10n ** 18n;
    expect(prestigeTotalNeeded(fee, snack)).toBe(fee + snack);
    expect(prestigeTotalNeeded(fee, snack)).toBeGreaterThan(fee);
  });
});

describe("feedMany sizing accounts for the free daily snack", () => {
  const snack = 84_857n * 10n ** 18n;

  it("charges n-1 when the free feed is still available", () => {
    expect(feedManyNeeded(3, snack, true)).toBe(2n * snack);
    expect(feedManyNeeded(1, snack, true)).toBe(0n);
  });

  it("charges all n once the free feed is spent", () => {
    expect(feedManyNeeded(3, snack, false)).toBe(3n * snack);
    expect(feedManyNeeded(1, snack, false)).toBe(snack);
  });

  it("never goes negative on an empty batch", () => {
    expect(feedManyNeeded(0, snack, true)).toBe(0n);
    expect(feedManyNeeded(0, snack, false)).toBe(0n);
  });
});
