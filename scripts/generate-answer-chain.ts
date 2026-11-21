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
 *   npm run answerchain:generate -- --new-seed       # seeded: a 64-hex secret re-derives it all
 *   npm run answerchain:generate -- --seed <hex>     # rebuild a seeded chain's backup file
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
import { WORDS } from "../src/lib/dictionary";

// The chain format, builder, verifier, and the seeded schedule live in src/lib/answerChain.ts so the
// keeper and the scheduled job share them. Re-exported here for existing callers and tests.
export {
  TERMINAL,
  buildAnswerChain,
  commitFor,
  seededSchedule,
  verifyAnswerChain,
  type BuiltChain,
  type ChainEntry,
  type ChainLink,
  type Hex32,
} from "../src/lib/answerChain";
import { buildAnswerChain, seededSchedule, verifyAnswerChain, type ChainEntry, type Hex32 } from "../src/lib/answerChain";

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
  // Seeded mode: the whole schedule from one 32-byte secret (src/lib/answerChain.ts). --new-seed
  // makes one; --seed <hex> rebuilds from an existing one (e.g. to re-create the backup file).
  const newSeed = process.argv.includes("--new-seed");
  const seedArg = arg("seed");
  if ((newSeed || seedArg) && wordsFile) throw new Error("--words can't be combined with a seed");
  const seed = newSeed ? randomBytes(32).toString("hex") : seedArg;

  if (!out.endsWith(".secret.json")) {
    throw new Error(`--out must end in .secret.json (the gitignore guard): ${out}`);
  }
  if (existsSync(out) && !force) {
    throw new Error(`${out} already exists — a live chain's schedule must never be overwritten. ` +
      `Pass --force only if this chain has NOT been committed on-chain.`);
  }

  const entries = seed
    ? seededSchedule(seed, days)
    : wordsFile
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
    // Present only for a seeded chain: the seed re-derives this whole file, so it IS the secret.
    ...(seed ? { scheme: "seeded-v1", seed: seed.replace(/^0x/i, "").toLowerCase() } : {}),
    schedule: built.links,
  };
  writeFileSync(out, JSON.stringify(payload, null, 2) + "\n", { mode: 0o600 });
  chmodSync(out, 0o600); // writeFileSync's mode applies only at creation — enforce on --force overwrite too

  console.log(`✓ ${out}  (${built.links.length} days, self-verified)`);
  console.log(`  ANSWERCHAIN_HEAD=${built.head}`);
  if (seed) {
    console.log(`  ANSWER_CHAIN_DAYS=${built.links.length}`);
    console.log(`  ANSWER_CHAIN_SEED is in the file ("seed"). It is the keeper's only copy of the schedule:`);
    console.log(`  set it as a SECRET in the keeper's host, write it on paper, and never paste it in chat.`);
  }
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
