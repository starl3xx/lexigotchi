import { describe, expect, it } from "vitest";
import {
  TERMINAL,
  buildAnswerChain,
  commitFor,
  sampleSchedule,
  verifyAnswerChain,
  type ChainEntry,
  type Hex32,
} from "../scripts/generate-answer-chain";
import { WORD_COUNT, isWord } from "../src/lib/dictionary";

/**
 * Cross-language vector: the same fixture + head constant live in
 * `contracts/test/AnswerChainVector.t.sol`, where Solidity recomputes the chain with
 * `keccak256(abi.encode(word, salt, next))` and walks `AnswerChain.reveal`. If either side's
 * encoding drifts, one of the two suites breaks.
 */
const SALT = (b: string): Hex32 => `0x${b.repeat(32)}` as Hex32;
const FIXTURE: ChainEntry[] = [
  { word: "CRANE", salt: SALT("11") },
  { word: "MOTEL", salt: SALT("22") },
  { word: "GRAPE", salt: SALT("33") },
];
const SOLIDITY_HEAD = "0x5cd5f4880aaa97e2ccb1a0f6b5718f8de7b4a0faa8c30a68831b56737fb7bafd";

describe("answer-chain generator", () => {
  it("reproduces the Solidity-verified head for the shared fixture", () => {
    expect(buildAnswerChain(FIXTURE).head).toBe(SOLIDITY_HEAD);
  });

  it("links every day: commit = keccak(abi.encode(word, salt, next)), ending at the zero terminal", () => {
    const built = buildAnswerChain(FIXTURE);
    for (const link of built.links) {
      expect(link.commit).toBe(commitFor(link.word, link.salt, link.next));
    }
    for (let i = 0; i < built.links.length - 1; i++) {
      expect(built.links[i].next).toBe(built.links[i + 1].commit);
    }
    // TERMINAL must be bytes32(0): AnswerChain.setHead only allows rotation once currentCommit == 0.
    expect(built.links.at(-1)!.next).toBe(TERMINAL);
    expect(TERMINAL).toBe(`0x${"00".repeat(32)}`);
    expect(() => verifyAnswerChain(built)).not.toThrow();
  });

  it("self-verification catches a tampered schedule", () => {
    const built = buildAnswerChain(FIXTURE);
    const tampered = {
      ...built,
      links: built.links.map((l, i) => (i === 1 ? { ...l, word: "BLAZE" } : l)),
    };
    expect(() => verifyAnswerChain(tampered)).toThrow(/day 2/);
  });

  it("rejects non-dictionary and non-UPPERCASE answers (unclaimable ⇒ guaranteed rollover)", () => {
    expect(() => buildAnswerChain([{ word: "ZZZZZ", salt: SALT("aa") }])).toThrow(/dictionary/);
    expect(() => buildAnswerChain([{ word: "crane", salt: SALT("aa") }])).toThrow(/UPPERCASE/);
    expect(() => buildAnswerChain([])).toThrow(/empty/);
  });

  it("samples distinct dictionary words with unique 32-byte salts", () => {
    const days = 50;
    const entries = sampleSchedule(days);
    expect(entries).toHaveLength(days);
    expect(new Set(entries.map((e) => e.word)).size).toBe(days);
    expect(new Set(entries.map((e) => e.salt)).size).toBe(days);
    for (const e of entries) {
      expect(isWord(e.word)).toBe(true);
      expect(e.salt).toMatch(/^0x[0-9a-f]{64}$/);
    }
    expect(() => sampleSchedule(WORD_COUNT + 1)).toThrow(/1\.\./);
  });
});
