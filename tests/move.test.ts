import { describe, expect, it } from "vitest";
import { decodeFunctionData } from "viem";
import { lettersAbi, wordsAbi } from "@/lib/onchain/abis";
import { lowercaseIndexesOf, moveCalls, movePlan, planIsEmpty } from "@/lib/onchain/move";
import { tokenIdOf } from "@/lib/onchain/tokenId";

// Made-up addresses: never anyone's real wallet or a deployed contract.
const FROM = "0x1111111111111111111111111111111111111111";
const TO = "0x2222222222222222222222222222222222222222";
const LETTERS = "0x3333333333333333333333333333333333333333";
const WORDS = "0x4444444444444444444444444444444444444444";
const contracts = { letters: LETTERS, words: WORDS } as const;

const counts = (pairs: Record<number, number>) => Array.from({ length: 52 }, (_, i) => pairs[i] ?? 0);
const word = (w: string, staked = false) => ({ word: w, tokenId: tokenIdOf(w), staked });

describe("movePlan", () => {
  it("skips zero balances, keeps ids and amounts lined up, and counts each case", () => {
    const p = movePlan(counts({ 0: 2, 4: 1, 30: 3 }), []);
    expect(p.ids).toEqual([0n, 4n, 30n]);
    expect(p.amounts).toEqual([2n, 1n, 3n]);
    expect([p.lower, p.upper]).toEqual([3, 3]);
    expect(lowercaseIndexesOf(p)).toEqual([0, 4]);
  });

  it("moves held words and leaves staked ones", () => {
    const p = movePlan(counts({}), [word("CRANE"), word("SLATE", true)]);
    expect(p.words.map((w) => w.word)).toEqual(["CRANE"]);
    expect(p.staked).toBe(1);
  });

  it("is empty when there is nothing to send", () => {
    expect(planIsEmpty(movePlan(counts({}), [word("SLATE", true)]))).toBe(true);
  });
});

describe("moveCalls", () => {
  it("one letter batch and one transfer per word, all from the holder to the destination", () => {
    const p = movePlan(counts({ 1: 1, 27: 2 }), [word("CRANE"), word("TRACE")]);
    const calls = moveCalls(FROM, TO, p, contracts);
    expect(calls.map((c) => c.to)).toEqual([LETTERS, WORDS, WORDS]);

    const batch = decodeFunctionData({ abi: lettersAbi, data: calls[0].data! });
    expect(batch.functionName).toBe("safeBatchTransferFrom");
    expect(batch.args).toEqual([FROM, TO, [1n, 27n], [1n, 2n], "0x"]);

    const first = decodeFunctionData({ abi: wordsAbi, data: calls[1].data! });
    expect(first.functionName).toBe("safeTransferFrom");
    expect(first.args).toEqual([FROM, TO, tokenIdOf("CRANE")]);
  });

  it("sends no letter batch when there are no letters", () => {
    const calls = moveCalls(FROM, TO, movePlan(counts({}), [word("CRANE")]), contracts);
    expect(calls.map((c) => c.to)).toEqual([WORDS]);
  });

  it("refuses to move a wallet to itself", () => {
    expect(() => moveCalls(FROM, FROM, movePlan(counts({ 0: 1 }), []), contracts)).toThrow();
  });
});
