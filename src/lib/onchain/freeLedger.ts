/**
 * The free routes' ledger steps (decisions.md #21), around lib/db/freeClaims.ts and the pure rules in
 * lib/freeLetters.ts: settle expired grants against the chain, then ask whether one more grant breaks
 * the budget or the dictionary stop. Server-only.
 */
import { freeLettersSigned, settleFreeClaims, type PendingGrant } from "@/lib/db/freeClaims";
import { freeLetterBudget, freeStop, usedOnchain, type FreeStop } from "@/lib/freeLetters";
import { addressOf } from "./addresses";
import { lettersAbi } from "./abis";
import { claimedWordCount } from "./claimedWords";
import { releasedWordCount } from "@/lib/sets/server";
import { getPublicClient } from "./reads";

/** Did each grant's key take its letters onchain? One multicall. */
export async function grantsUsedOnchain(rows: readonly PendingGrant[]): Promise<boolean[]> {
  const letters = addressOf("letters");
  const res = (await getPublicClient().multicall({
    allowFailure: false,
    contracts: rows.map((r) =>
      r.kind === "pack"
        ? { address: letters, abi: lettersAbi, functionName: "freePackClaimed" as const, args: [r.key] }
        : { address: letters, abi: lettersAbi, functionName: "dailyUsed" as const, args: [r.key] },
    ),
  })) as unknown as (boolean | number | bigint)[];
  return rows.map((r, i) => usedOnchain(r.kind, r.period, res[i]));
}

/**
 * Settle this profile's expired grants (so its count of 10 is right), then a bounded batch of anyone's
 * (so lapsed vouchers give their letters back to the budget). Never throws.
 */
export async function settleGrants(chainId: number, account: string): Promise<void> {
  await settleFreeClaims({ chainId, account, limit: 50, check: grantsUsedOnchain });
  await settleFreeClaims({ chainId, limit: 100, check: grantsUsedOnchain });
}

/**
 * Would `letters` more free letters break the budget or the dictionary stop? A database error
 * throws (the route refuses rather than overspend); an unreadable claimed count skips that rule.
 * Two requests at the very end of the budget can both pass: it can run over by a grant or two.
 */
export async function freeGrantStop(chainId: number, letters: number): Promise<FreeStop> {
  // "Of the dictionary" is of the words the game offers now: a word held back in a reserved set
  // can't be claimed, so it must not hold the stop off (decisions.md, "Reserved word sets").
  const [signed, claimed, dictionary] = await Promise.all([freeLettersSigned(chainId), claimedWordCount(), releasedWordCount()]);
  return freeStop({ claimed, dictionary, signed, budget: freeLetterBudget(), letters });
}

/** The routes' error codes for a stop. */
export const STOP_ERROR: Record<Exclude<FreeStop, null>, string> = { dictionary: "free_letters_closed", budget: "free_letters_gone" };
