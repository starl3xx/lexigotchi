/**
 * Who gets notified, and why — the targeting layer.
 *
 * Pure functions over already-fetched state, deliberately: this is where a bug means either a
 * notification a player needed and never got, or one that went to the wrong person. Both are
 * invisible in production and neither is recoverable, so every rule here is decided in code that a
 * test can pin rather than inside a keeper pass that talks to four services at once.
 *
 * Targeting always yields an explicit FID list. It NEVER produces an empty list meaning "everyone" —
 * `sendNotification` refuses an empty audience for exactly that reason.
 */

import { DEFAULT_PARAMS, type Params } from "@/lib/params";
import type { KeeperWord } from "@/lib/keeper/shares";

const HOUR = 3600;
const DAY = 86_400;

/** Address → FID, built from the linked wallets of everyone who added the mini app. */
export type FidLookup = (address: string) => number | undefined;

export function fidLookupFrom(
  profiles: readonly { fid: number; linkedWallets: readonly string[] }[],
): FidLookup {
  const map = new Map<string, number>();
  for (const p of profiles) {
    for (const w of p.linkedWallets) map.set(w.toLowerCase(), p.fid);
  }
  return (address: string) => map.get(address.toLowerCase());
}

export interface HungerTarget {
  fid: number;
  /** How many of their staked words are inside the warning window. */
  words: number;
  /** Hours until the SOONEST of them goes hungry — the deadline that actually matters. */
  hoursLeft: number;
}

/**
 * Staked words about to cross from peckish into hungry.
 *
 * Three judgment calls, all deliberate:
 *
 *   ONLY STAKED WORDS. Hunger gates yield and jackpot eligibility, both of which require staking —
 *   an unstaked word's hunger costs its owner nothing, so warning about it is noise.
 *
 *   ONLY THE APPROACH, NEVER THE ARRIVAL. A word that is ALREADY hungry gets no push. It would
 *   qualify again every single day, which is how a useful warning turns into the thing that gets
 *   the app muted — and the state is plainly visible in-app anyway. We warn while there is still
 *   something the player can do about it.
 *
 *   THE SOONEST DEADLINE WINS. A player with five words spread across the window hears about the
 *   most urgent one, because that is the one whose clock they need to beat.
 */
export function hungerTargets(
  words: readonly KeeperWord[],
  fidOf: FidLookup,
  warnWithinHours = 24,
  p: Params = DEFAULT_PARAMS,
): HungerTarget[] {
  const hungryAt = p.care.hungryAfterDays * DAY;
  const byFid = new Map<number, { words: number; soonest: number }>();

  for (const w of words) {
    if (!w.staked) continue;
    const secondsLeft = hungryAt - w.secondsUnfed;
    // <= 0 is already hungry (no warning to give); beyond the window is not yet urgent.
    if (secondsLeft <= 0 || secondsLeft > warnWithinHours * HOUR) continue;
    const fid = fidOf(w.owner);
    if (fid === undefined) continue; // owner isn't a notifiable player — nothing to send
    const prev = byFid.get(fid);
    if (prev) {
      prev.words += 1;
      prev.soonest = Math.min(prev.soonest, secondsLeft);
    } else {
      byFid.set(fid, { words: 1, soonest: secondsLeft });
    }
  }

  return [...byFid.entries()]
    .map(([fid, v]) => ({
      fid,
      words: v.words,
      // Round DOWN so we never promise more time than the player has. Floor to 1h so the copy
      // never reads "in 0h", which sounds like it already happened.
      hoursLeft: Math.max(1, Math.floor(v.soonest / HOUR)),
    }))
    .sort((a, b) => a.fid - b.fid); // stable order — makes the pass reproducible in logs and tests
}

export interface DailyState {
  fid: number;
  /** Letters.dailyUsed(fid) — 0 means never pulled; otherwise the epoch-day + 1 of the last pull. */
  lastDailyDayPlusOne: number;
}

/**
 * Who to remind that their free daily letter reset.
 *
 * The highest-volume message we can send, so it carries the strictest gates:
 *
 *   NOT IF THEY ALREADY PULLED TODAY. Read from the chain, not from our DB — `dailyUsed` is the
 *   same mapping the mint checks, so this can't disagree with what the game would do.
 *
 *   NOT IF THEY HAVE DRIFTED AWAY. A daily ping to someone who last played two months ago is how
 *   an app teaches people to swipe it away. `activeWithinDays` bounds it to players with a recent
 *   pull; win-back is a different campaign with different copy, not this one.
 *
 *   NOT IF THEY HAVE NEVER PULLED (0). They added the app and never played — that is the
 *   onboarding funnel's problem, and a "your daily RESET" message is a lie to someone who has
 *   never used one.
 */
export function dailyTargets(
  states: readonly DailyState[],
  day: number,
  activeWithinDays = 7,
): number[] {
  const out: number[] = [];
  for (const s of states) {
    if (s.lastDailyDayPlusOne === 0) continue; // never pulled
    const lastDay = s.lastDailyDayPlusOne - 1;
    if (lastDay === day) continue; // already pulled today
    if (day - lastDay > activeWithinDays) continue; // drifted away
    out.push(s.fid);
  }
  return out.sort((a, b) => a - b);
}

/** The jackpot winner's FID, when the winner is someone we can actually reach. */
export function jackpotWinnerFid(winner: string | undefined, fidOf: FidLookup): number | undefined {
  return winner ? fidOf(winner) : undefined;
}
