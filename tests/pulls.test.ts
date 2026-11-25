import { describe, expect, it } from "vitest";
import { decodeFunctionData, erc20Abi } from "viem";
import { lettersAbi } from "@/lib/onchain/abis";
import { grantCalls, lettersForWord, planPulls, planShort, pullCalls, type PullSource } from "@/lib/onchain/pulls";

// Made-up addresses: never anyone's real wallet or a deployed contract.
const ME = "0x1111111111111111111111111111111111111111";
const F = "0x2222222222222222222222222222222222222222";
const G = "0x3333333333333333333333333333333333333333";
const LETTERS = "0x4444444444444444444444444444444444444444";
const WORDS = "0x5555555555555555555555555555555555555555";
const TOKEN = "0x6666666666666666666666666666666666666666";
const zero = () => Array.from({ length: 52 }, () => 0);
const has = (pairs: Record<number, number>) => Object.assign(zero(), pairs) as number[];
const src = (wallet: `0x${string}`, p: Partial<PullSource>): PullSource => ({
  wallet,
  letters: zero(),
  word: 0n,
  lettersApproved: true,
  wordAllowance: 0n,
  ...p,
});
const C = 2, R = 17, A = 0, N = 13, E = 4;

describe("lettersForWord", () => {
  it("counts each letter, lowercase or UPPERCASE ids", () => {
    expect(lettersForWord("CRANE", false)).toEqual(has({ [C]: 1, [R]: 1, [A]: 1, [N]: 1, [E]: 1 }));
    expect(lettersForWord("ALLOY", true)[26 + 11]).toBe(2);
  });
});

describe("planPulls", () => {
  const need = { letters: lettersForWord("CRANE", false) };

  it("uses the acting wallet's own letters first and pulls only what's missing", () => {
    const plan = planPulls({ letters: has({ [C]: 1, [R]: 1, [A]: 1 }), word: 0n }, need, [src(F, { letters: has({ [N]: 3, [E]: 2 }) })]);
    expect(plan.pulls).toEqual([{ from: F, ids: [BigInt(E), BigInt(N)], amounts: [1n, 1n], word: 0n }]);
    expect(planShort(plan)).toBe(false);
  });

  it("tries sources in order (the game wallet first) and splits across them", () => {
    const plan = planPulls({ letters: zero(), word: 0n }, need, [
      src(F, { letters: has({ [C]: 1, [R]: 1 }) }),
      src(G, { letters: has({ [A]: 1, [N]: 1, [E]: 1, [C]: 5 }) }),
    ]);
    expect(plan.pulls.map((p) => [p.from, p.ids.map(Number)])).toEqual([
      [F, [C, R]],
      [G, [A, E, N]],
    ]);
  });

  it("never pulls from a wallet that didn't approve, a letter with an open roll, or one promised in a swap offer", () => {
    const plan = planPulls({ letters: zero(), word: 0n }, need, [
      src(F, { letters: has({ [C]: 1, [R]: 1, [A]: 1, [N]: 1, [E]: 1 }), lettersApproved: false }),
      src(G, { letters: has({ [C]: 1, [R]: 1, [A]: 1, [N]: 1, [E]: 1 }), openRolls: new Set([R]), promised: has({ [A]: 1 }) }),
    ]);
    expect(plan.pulls).toEqual([{ from: G, ids: [BigInt(C), BigInt(E), BigInt(N)], amounts: [1n, 1n, 1n], word: 0n }]);
    expect(plan.short.letters[R]).toBe(1);
    expect(plan.short.letters[A]).toBe(1);
    expect(planShort(plan)).toBe(true);
  });

  it("pulls $WORD up to the balance and the allowance, whichever is smaller", () => {
    const plan = planPulls({ letters: zero(), word: 100n }, { word: 1000n }, [
      src(F, { word: 5000n, wordAllowance: 300n }),
      src(G, { word: 400n, wordAllowance: 10_000n }),
    ]);
    expect(plan.pulls.map((p) => [p.from, p.word])).toEqual([[F, 300n], [G, 400n]]);
    expect(plan.short.word).toBe(200n);
  });
});

describe("pullCalls and grantCalls", () => {
  const contracts = { letters: LETTERS, words: WORDS, token: TOKEN } as const;

  it("pulls with the acting wallet as the recipient: letters in one batch, $WORD with transferFrom", () => {
    const plan = planPulls({ letters: zero(), word: 0n }, { letters: has({ [C]: 2 }), word: 50n }, [
      src(F, { letters: has({ [C]: 2 }), word: 50n, wordAllowance: 50n }),
    ]);
    const calls = pullCalls(ME, plan, contracts);
    expect(calls.map((c) => c.to)).toEqual([LETTERS, TOKEN]);
    expect(decodeFunctionData({ abi: lettersAbi, data: calls[0].data! }).args).toEqual([F, ME, [BigInt(C)], [2n], "0x"]);
    const t = decodeFunctionData({ abi: erc20Abi, data: calls[1].data! });
    expect([t.functionName, ...(t.args as readonly unknown[])]).toEqual(["transferFrom", F, ME, 50n]);
  });

  it("refuses to pull from itself", () => {
    const plan = { pulls: [{ from: ME, ids: [1n], amounts: [1n], word: 0n }], short: { letters: zero(), word: 0n } } as const;
    expect(() => pullCalls(ME, plan as never, contracts)).toThrow();
  });

  it("grants letters, words, and a capped $WORD allowance; revoking sets all three back", () => {
    const grant = grantCalls(G, true, 777n, contracts);
    expect(grant.map((c) => c.to)).toEqual([LETTERS, WORDS, TOKEN]);
    const approve = decodeFunctionData({ abi: erc20Abi, data: grant[2].data! });
    expect([approve.functionName, ...(approve.args as readonly unknown[])]).toEqual(["approve", G, 777n]);
    const revoke = decodeFunctionData({ abi: erc20Abi, data: grantCalls(G, false, 777n, contracts)[2].data! });
    expect((revoke.args as readonly unknown[])[1]).toBe(0n);
  });
});
