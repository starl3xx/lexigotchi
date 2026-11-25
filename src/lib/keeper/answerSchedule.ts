/**
 * Where the keeper's jackpot answers come from, and the check that runs before every reveal.
 *
 * Two sources, in order:
 *   1. ANSWER_CHAIN_SEED (+ ANSWER_CHAIN_DAYS, default 730): the seeded schedule, rebuilt in memory
 *      (src/lib/answerChain.ts). This is what a hosted, scheduled keeper uses: a 64-hex secret fits
 *      a hosting secret where the 200+ KB file does not.
 *   2. ANSWER_CHAIN_FILE: a generated schedule file. Defaults to the throwaway Sepolia rehearsal
 *      file, which no longer matches the Sepolia chain: since 2026-11-25 it commits to a SEEDED list
 *      (contracts/answer-chain.sepolia-seed.secret.json; Vercel ANSWER_CHAIN_SEED), and linkToReveal
 *      refuses a mismatched schedule before sending anything.
 *
 * NEVER log a word, a salt, or the seed: whoever holds a future word wins that jackpot.
 */
import { readFileSync } from "node:fs";
import { buildAnswerChain, seededSchedule, type ChainLink } from "@/lib/answerChain";

export const REHEARSAL_FILE = "contracts/answer-chain.sepolia-rehearsal.secret.json";

export interface AnswerSchedule {
  links: ChainLink[];
  source: "seed" | "file";
}

export function loadAnswerSchedule(
  env: Record<string, string | undefined> = process.env,
  readFile: (path: string) => string = (p) => readFileSync(p, "utf8"),
): AnswerSchedule {
  const seed = env.ANSWER_CHAIN_SEED?.trim();
  if (seed) {
    // Empty counts as unset: a copied .env.example has `ANSWER_CHAIN_DAYS=` with nothing after it.
    const daysRaw = env.ANSWER_CHAIN_DAYS?.trim();
    const days = daysRaw ? Number(daysRaw) : 730;
    return { links: buildAnswerChain(seededSchedule(seed, days)).links, source: "seed" };
  }
  const file = env.ANSWER_CHAIN_FILE ?? REHEARSAL_FILE;
  const parsed = JSON.parse(readFile(file)) as { schedule: ChainLink[] };
  return { links: parsed.schedule, source: "file" };
}

/**
 * Today's link, checked against the chain BEFORE anything is sent. `revealedDay` counts reveals so
 * far, so the next link is at that index. Its `commit` must equal the contract's `currentCommit`;
 * if not, the schedule is the wrong one (wrong seed or day count, a re-vendored dictionary, or the
 * wrong file), and a reveal could only revert. The error never contains the word or salt.
 */
export function linkToReveal(links: readonly ChainLink[], revealedDay: number, currentCommit: string): ChainLink {
  const link = links[revealedDay];
  if (!link) throw new Error(`Schedule exhausted at reveal #${revealedDay} — rotate the chain (setHead).`);
  if (link.commit.toLowerCase() !== currentCommit.toLowerCase()) {
    throw new Error(
      `The answer schedule does not match the chain (reveal #${revealedDay + 1}): wrong seed or ` +
        `ANSWER_CHAIN_DAYS, a re-vendored dictionary, or the wrong file. Nothing was sent.`,
    );
  }
  return link;
}
