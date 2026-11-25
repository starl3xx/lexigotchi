/**
 * The free-letter policy (decisions.md #21), as pure rules the free routes share: every verified
 * player (Farcaster, an X account older than 90 days, or a Coinbase-verified wallet) gets a free pack
 * of 5 and 10 free daily letters (at most one a chain day), once per profile; every free letter comes
 * out of one budget (30,000); and free grants stop when the dictionary is about 95% claimed.
 *
 * The ledger is the `free_claims` table (lib/db/freeClaims.ts, migration 0015): a letter counts from
 * the moment its voucher is signed, and goes back if the voucher expires unused. The routes decide
 * with these functions; the tests pin them (tests/free-letters.test.ts).
 */
import { DEFAULT_PARAMS, type Params } from "./params";

export type FreeKind = "daily" | "pack";

/** Letters one grant gives. */
export const FREE_LETTERS: Record<FreeKind, number> = { daily: 1, pack: 5 };

/** The free-letter budget: `FREE_LETTER_BUDGET` when it's a whole number ≥ 0, else params. */
export function freeLetterBudget(env: Record<string, string | undefined> = process.env, p: Params = DEFAULT_PARAMS): number {
  const raw = env.FREE_LETTER_BUDGET?.trim();
  const n = raw ? Number(raw) : NaN;
  return Number.isInteger(n) && n >= 0 ? n : p.freeLetters.budget;
}

/** Why free grants are stopped, or null. "dictionary" wins: it's the reason that never comes back. */
export type FreeStop = "dictionary" | "budget" | null;

/**
 * Would signing `letters` more free letters break a rule? `claimed` and `signed` are null when they
 * couldn't be read (a chain or database outage, or a database without migration 0015): that rule is
 * then skipped, like every other lookup in the free routes, rather than refusing everyone.
 * `letters` is 0 for a voucher the ledger already counts (the same player asking again).
 */
export function freeStop(
  o: { claimed: number | null; dictionary: number; signed: number | null; budget: number; letters: number },
  p: Params = DEFAULT_PARAMS,
): FreeStop {
  if (o.claimed !== null && o.dictionary > 0 && o.claimed / o.dictionary >= p.freeLetters.freeStopClaimedFraction) return "dictionary";
  if (o.signed !== null && o.letters > 0 && o.signed + o.letters > o.budget) return "budget";
  return null;
}

/** Free daily letters left for a profile that has taken `taken` (null = unknown, so not limited). */
export function dailiesLeft(taken: number | null, p: Params = DEFAULT_PARAMS): number | null {
  return taken === null ? null : Math.max(0, p.freeLetters.freeDailyLimit - taken);
}

/**
 * Did an expired voucher reach the chain? The pack: `freePackClaimed[key]` (permanent). A daily for
 * `period`: `dailyUsed[key]` holds the key's last daily day + 1. Equal means this day's letter was
 * taken. Later means the key took a later daily, which the route settles before signing it, so that
 * only happens through a path the ledger doesn't see (the paid daily): counted as used, the safe side
 * for the budget. Earlier or zero: never taken, so the letter goes back.
 */
export function usedOnchain(kind: FreeKind, period: number, onchain: boolean | number | bigint): boolean {
  if (kind === "pack") return Boolean(onchain);
  return Number(onchain) >= period + 1;
}

/** A daily grant, as the reminder reads it (lib/db/freeClaims.ts GrantRow). */
export interface Grant {
  account: string;
  kind: FreeKind;
  period: number;
  key: bigint;
  used: boolean | null;
}

/**
 * The profiles that have taken all `limit` free dailies, for the daily reminder, with every key they
 * took them under: Farcaster reminds by FID, so a profile that pulled under a Coinbase or X key is
 * matched by walking the FID's keys; browsers and email match the account or its keys (Bugbot on #199).
 */
export function finishedProfiles(grants: readonly Grant[], limit: number): { accounts: Set<string>; keys: Set<string> } {
  const days = new Map<string, Set<number>>();
  for (const g of grants) {
    if (g.kind !== "daily" || g.used === false) continue;
    if (!days.has(g.account)) days.set(g.account, new Set());
    days.get(g.account)!.add(g.period);
  }
  const accounts = new Set([...days].filter(([, d]) => d.size >= limit).map(([a]) => a));
  const keys = new Set(grants.filter((g) => g.kind === "daily" && accounts.has(g.account)).map((g) => g.key.toString()));
  return { accounts, keys };
}

/** The player-facing words for a stop, shared by the routes' callers. */
export const FREE_STOP_COPY: Record<Exclude<FreeStop, null>, string> = {
  dictionary: "The dictionary is nearly full, so free letters have ended. Packs are still for sale, and the Market has words for sale.",
  budget: "All the free letters have been given out. Packs are still for sale.",
};
