/**
 * Generate the AnswerChain — the pre-committed daily jackpot-word schedule.
 *
 * Builds the reverse hash-chain `AnswerChain.sol` verifies on-chain:
 *   head = keccak256(abi.encode(word_1, salt_1, H_2))
 *   H_i  = keccak256(abi.encode(word_i, salt_i, H_{i+1}))
 *   H_N  = keccak256(abi.encode(word_N, salt_N, TERMINAL))
 * The TERMINAL is bytes32(0) ON PURPOSE: `setHead` only allows re-commit (rotation) once
 * `currentCommit == 0`, i.e. after the chain is exhausted — any other terminal would brick rotation.
 *
 * Words are drawn from the canonical dictionary (UPPERCASE, matching `Words.claim` / the on-chain
 * `tokenId = keccak256(bytes(word))`) with cryptographic randomness, no repeats. A non-dictionary
 * answer would be an unclaimable word — a guaranteed-rollover day — so membership is enforced.
 *
 *   npm run answerchain:generate                     # 730 days → contracts/answer-chain.secret.json
 *   npm run answerchain:generate -- --days 365
 *   npm run answerchain:generate -- --words my-schedule.txt --out other.secret.json --force
 *
 * The output file is the ENTIRE FUTURE ANSWER SCHEDULE — every (word, salt, next) preimage the
 * keeper reveals daily via `Jackpot.resolve`. It is a SECRET (leaking it makes every future jackpot
 * front-runnable) and it is IRREPLACEABLE (once the chain is live, `setHead` reverts `ChainLive`;
 * losing the file bricks jackpot resolution with no on-chain recovery). Back it up offline, never
 * commit it (`*.secret.json` is gitignored), and give the keeper runtime access to it.
 */
import { randomBytes, randomInt } from "node:crypto";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { AbiParameters, Hash } from "ox";
import { WORDS, isWord } from "../src/lib/dictionary";

export type Hex32 = `0x${string}`;

export interface ChainEntry {
  word: string; // UPPERCASE dictionary word (5 letters A–Z)
  salt: Hex32; // 32 random bytes
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

/** Crypto-random schedule: `days` distinct dictionary words (partial Fisher–Yates). */
export function sampleSchedule(days: number): ChainEntry[] {
  if (days < 1 || days > WORDS.length) {
    throw new Error(`--days must be 1..${WORDS.length} (distinct dictionary words, no repeats)`);
  }
  const pool = [...WORDS];
  const entries: ChainEntry[] = [];
  for (let i = 0; i < days; i++) {
    const j = i + randomInt(pool.length - i);
    [pool[i], pool[j]] = [pool[j], pool[i]];
    entries.push({ word: pool[i], salt: `0x${randomBytes(32).toString("hex")}` });
  }
  return entries;
}

function arg(name: string): string | undefined {
  const eq = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (eq) return eq.slice(`--${name}=`.length);
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function main(): void {
  const daysRaw = arg("days") ?? "730";
  const days = Number(daysRaw);
  if (!Number.isInteger(days)) throw new Error(`--days must be a whole number of days, got "${daysRaw}"`);
  const out = arg("out") ?? "contracts/answer-chain.secret.json";
  const wordsFile = arg("words");
  const force = process.argv.includes("--force");

  if (!out.endsWith(".secret.json")) {
    throw new Error(`--out must end in .secret.json (the gitignore guard): ${out}`);
  }
  if (existsSync(out) && !force) {
    throw new Error(`${out} already exists — a live chain's schedule must never be overwritten. ` +
      `Pass --force only if this chain has NOT been committed on-chain.`);
  }

  const entries = wordsFile
    ? readFileSync(wordsFile, "utf8")
        .split("\n")
        .map((w) => w.trim().toUpperCase())
        .filter(Boolean)
        .map((word) => ({ word, salt: `0x${randomBytes(32).toString("hex")}` as Hex32 }))
    : sampleSchedule(days);

  const built = buildAnswerChain(entries);
  verifyAnswerChain(built);

  const payload = {
    generatedBy: "scripts/generate-answer-chain.ts",
    generatedAt: new Date().toISOString(),
    days: built.links.length,
    head: built.head,
    terminal: built.terminal,
    schedule: built.links,
  };
  writeFileSync(out, JSON.stringify(payload, null, 2) + "\n", { mode: 0o600 });
  chmodSync(out, 0o600); // writeFileSync's mode applies only at creation — enforce on --force overwrite too

  console.log(`✓ ${out}  (${built.links.length} days, self-verified)`);
  console.log(`  ANSWERCHAIN_HEAD=${built.head}`);
  console.log(`  Publish the head for independent verification; the schedule file stays secret.`);
  console.log(`
  ⚠ CUSTODY: this file is the entire future jackpot answer schedule.
    - SECRET: leaking it makes every future jackpot front-runnable.
    - IRREPLACEABLE: once live, setHead reverts (ChainLive); losing it bricks resolution.
    Back it up offline NOW, and give the keeper service runtime access to it.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
