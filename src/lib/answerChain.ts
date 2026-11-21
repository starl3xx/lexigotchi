/**
 * The AnswerChain's off-chain half: building, verifying, and (from a seed) re-deriving the
 * pre-committed daily jackpot schedule that `AnswerChain.sol` checks one link per day.
 *
 *   head = keccak256(abi.encode(word_1, salt_1, H_2))
 *   H_i  = keccak256(abi.encode(word_i, salt_i, H_{i+1}))
 *   H_N  = keccak256(abi.encode(word_N, salt_N, TERMINAL))
 *
 * The TERMINAL is bytes32(0) ON PURPOSE: `setHead` only allows re-commit (rotation) once
 * `currentCommit == 0`, i.e. after the chain is exhausted; any other terminal would brick rotation.
 *
 * Two ways to make a schedule, one chain format:
 *   - `sampleSchedule` (scripts/generate-answer-chain.ts): fresh crypto randomness per word and salt.
 *     The custody object is the whole 200+ KB file.
 *   - `seededSchedule` (here): every word and salt derived from ONE 32-byte secret by HMAC-SHA256.
 *     The custody object is 64 hex characters, small enough for a hosting secret and for paper,
 *     so a scheduled keeper can rebuild the chain in memory each run. Same security as random, as
 *     long as the seed stays secret: HMAC-SHA256 under an unknown 256-bit key is a PRF.
 * A seeded schedule is a shuffle of a word pool, so it shuffles a FROZEN one (`ANSWER_POOL_V1`,
 * src/lib/answerPool.ts), never the live dictionary: re-vendoring the dictionary later must not move
 * a single future answer. The keeper still checks every derived link against the onchain
 * `currentCommit` before revealing, so a wrong seed or day count stops the run instead of
 * submitting a reveal that can't verify.
 */
import { createHmac } from "node:crypto";
import { AbiParameters, Hash } from "ox";
import { isWord } from "./dictionary";
import { ANSWER_POOL_V1 } from "./answerPool";

export type Hex32 = `0x${string}`;

export interface ChainEntry {
  word: string; // UPPERCASE dictionary word (5 letters A–Z)
  salt: Hex32; // 32 bytes
}

export interface ChainLink extends ChainEntry {
  day: number; // 1-based reveal index (AnswerChain.revealedDay after this reveal)
  next: Hex32; // the `next` argument of reveal(word, salt, next)
  commit: Hex32; // what currentCommit must equal BEFORE this reveal (day 1's commit == head)
}

export interface BuiltChain {
  head: Hex32;
  terminal: Hex32;
  links: ChainLink[];
}

/** bytes32(0) — required so `setHead` rotation works once the chain is exhausted (see header). */
export const TERMINAL: Hex32 = `0x${"00".repeat(32)}`;

const REVEAL_PARAMS = AbiParameters.from(["string", "bytes32", "bytes32"]);

/** Mirrors `AnswerChain.reveal`'s check: `keccak256(abi.encode(word, salt, next))`. */
export function commitFor(word: string, salt: Hex32, next: Hex32): Hex32 {
  return Hash.keccak256(AbiParameters.encode(REVEAL_PARAMS, [word, salt, next]));
}

function assertAnswerWord(word: string, day: number): void {
  if (!/^[A-Z]{5}$/.test(word)) {
    throw new Error(`day ${day}: "${word}" must be 5 UPPERCASE letters A–Z (the on-chain convention)`);
  }
  if (!isWord(word)) {
    throw new Error(
      `day ${day}: "${word}" is not in the canonical dictionary — it could never be claimed, ` +
        `making that day a guaranteed rollover`,
    );
  }
}

/** Build the reverse hash-chain for `entries` (day 1 first). Validates every word. */
export function buildAnswerChain(entries: readonly ChainEntry[]): BuiltChain {
  if (entries.length === 0) throw new Error("empty schedule");
  const links: ChainLink[] = new Array(entries.length);
  let next: Hex32 = TERMINAL;
  for (let i = entries.length - 1; i >= 0; i--) {
    const { word, salt } = entries[i];
    assertAnswerWord(word, i + 1);
    const commit = commitFor(word, salt, next);
    links[i] = { day: i + 1, word, salt, next, commit };
    next = commit;
  }
  return { head: links[0].commit, terminal: TERMINAL, links };
}

/** Walk the chain forward exactly as the contract would; throws if any link fails to verify. */
export function verifyAnswerChain(built: BuiltChain): void {
  let current = built.head;
  for (const link of built.links) {
    if (link.commit !== current) throw new Error(`day ${link.day}: commit does not chain`);
    if (commitFor(link.word, link.salt, link.next) !== current) {
      throw new Error(`day ${link.day}: reveal would fail BadReveal`);
    }
    current = link.next;
  }
  if (current !== built.terminal) throw new Error("chain does not end at the terminal");
}

/** A 32-byte seed as 64 hex characters (an optional 0x is accepted). */
export function parseSeed(seed: string): Buffer {
  const hex = seed.trim().replace(/^0x/i, "");
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) throw new Error("the answer-chain seed must be 32 bytes as 64 hex characters");
  return Buffer.from(hex, "hex");
}

function prf(seed: Buffer, label: string): Buffer {
  return createHmac("sha256", seed).update(label).digest();
}

/** A uniform integer in [0, n) from the seed, by rejection sampling (no modulo bias). */
function uniformInt(seed: Buffer, label: string, n: number): number {
  const RANGE = 2 ** 48;
  const limit = RANGE - (RANGE % n);
  for (let attempt = 0; ; attempt++) {
    const r = prf(seed, `${label}:${attempt}`).readUIntBE(0, 6);
    if (r < limit) return r % n;
  }
}

/**
 * The seeded schedule: `days` distinct dictionary words (a partial Fisher–Yates shuffle driven by
 * the seed) and a salt per day, all re-derivable from the seed alone. Labels are versioned so a
 * future change of scheme can never silently reinterpret an existing seed.
 */
export function seededSchedule(seed: string, days: number, words: readonly string[] = ANSWER_POOL_V1): ChainEntry[] {
  if (!Number.isInteger(days) || days < 1 || days > words.length) {
    throw new Error(`days must be 1..${words.length} (distinct dictionary words, no repeats)`);
  }
  const key = parseSeed(seed);
  const pool = [...words];
  const entries: ChainEntry[] = [];
  for (let i = 0; i < days; i++) {
    const j = i + uniformInt(key, `lexigotchi/answer-chain/v1/pick/${i}`, pool.length - i);
    [pool[i], pool[j]] = [pool[j], pool[i]];
    entries.push({ word: pool[i], salt: `0x${prf(key, `lexigotchi/answer-chain/v1/salt/${i}`).toString("hex")}` });
  }
  return entries;
}
