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

/**
 * The same lookup across linked wallets (lib/db/walletLinks.ts): a wallet with no notifiable FID of
 * its own reaches the first FID any wallet in its account has. So a browser wallet linked to a
 * Farcaster player's account is warned through that FID, and the browser pass's "Farcaster already
 * reached them" skip agrees with what the Farcaster pass actually sends.
 */
export function accountFidLookup(
  fidOf: FidLookup,
  links: { accountOf(address: string): string; walletsOf(account: string): string[] },
): FidLookup {
  return (address: string) => {
    const own = fidOf(address);
    if (own !== undefined) return own;
    for (const w of links.walletsOf(links.accountOf(address))) {
      const f = fidOf(w);
      if (f !== undefined) return f;
    }
    return undefined;
  };
}

/**
 * How far ahead of the hunger line to warn — and why it is NOT 24h.
 *
 * THE INVARIANT: this window must be strictly WIDER than the longest gap between keeper passes.
 * The keeper runs once a day, and warnings are only issued on the approach (an already-hungry word
 * is deliberately skipped — see hungerTargets). So with a 24h window and a 24h cadence, any pass
 * that lands even a minute late leaves a gap: a word sitting just outside the window on Monday's
 * pass is already hungry by Tuesday's, and is therefore never warned at all. The feature would fail
 * silently for precisely the words it exists to protect, and nothing would look wrong.
 *
 * 30h gives six hours of slack against cron jitter, a slow scan, or one skipped run. Widen it
 * further if the keeper ever moves to a less reliable schedule; never narrow it below the cadence.
 * A word inside the window across two passes simply gets two warnings on different days, which is
 * a feature — the second one is more urgent than the first.
 */
export const HUNGER_WARN_HOURS = 30;

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
  warnWithinHours = HUNGER_WARN_HOURS,
  p: Params = DEFAULT_PARAMS,
): HungerTarget[] {
  return [...groupHunger(words, fidOf, warnWithinHours, p).entries()]
    .map(([fid, v]) => ({ fid, ...v }))
    .sort((a, b) => a.fid - b.fid); // stable order — makes the pass reproducible in logs and tests
}

/**
 * The same rules as `hungerTargets`, keyed by the OWNER WALLET instead of an FID: the browser push
 * channel reaches wallets, because a web player may have no FID at all. Addresses are lowercase.
 * With `accountOf`, words group by the owner's ACCOUNT instead (linked wallets): one warning per
 * player, its `address` the account (its first wallet), which is also the key of its email row.
 */
export interface AddressHungerTarget {
  address: string;
  words: number;
  hoursLeft: number;
}

export function hungerTargetsByAddress(
  words: readonly KeeperWord[],
  warnWithinHours = HUNGER_WARN_HOURS,
  p: Params = DEFAULT_PARAMS,
  accountOf: (address: string) => string = (a) => a.toLowerCase(),
): AddressHungerTarget[] {
  return [...groupHunger(words, (owner) => accountOf(owner).toLowerCase(), warnWithinHours, p).entries()]
    .map(([address, v]) => ({ address, ...v }))
    .sort((a, b) => (a.address < b.address ? -1 : a.address > b.address ? 1 : 0));
}

/** The shared core: staked words inside the warning window, grouped by whoever `keyOf` names. */
function groupHunger<K>(
  words: readonly KeeperWord[],
  keyOf: (owner: string) => K | undefined,
  warnWithinHours: number,
  p: Params,
): Map<K, { words: number; hoursLeft: number }> {
  const hungryAt = p.care.hungryAfterDays * DAY;
  const byKey = new Map<K, { words: number; soonest: number }>();

  for (const w of words) {
    if (!w.staked) continue;
    const secondsLeft = hungryAt - w.secondsUnfed;
    // <= 0 is already hungry (no warning to give); beyond the window is not yet urgent.
    if (secondsLeft <= 0 || secondsLeft > warnWithinHours * HOUR) continue;
    const key = keyOf(w.owner);
    if (key === undefined) continue; // owner isn't reachable on this channel — nothing to send
    const prev = byKey.get(key);
    if (prev) {
      prev.words += 1;
      prev.soonest = Math.min(prev.soonest, secondsLeft);
    } else {
      byKey.set(key, { words: 1, soonest: secondsLeft });
    }
  }

  const out = new Map<K, { words: number; hoursLeft: number }>();
  for (const [key, v] of byKey) {
    // Round DOWN so we never promise more time than the player has. Floor to 1h so the copy
    // never reads "in 0h", which sounds like it already happened.
    out.set(key, { words: v.words, hoursLeft: Math.max(1, Math.floor(v.soonest / HOUR)) });
  }
  return out;
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
  return states
    .filter((s) => isDailyDue(s.lastDailyDayPlusOne, day, activeWithinDays))
    .map((s) => s.fid)
    .sort((a, b) => a - b);
}

/** The per-slot rule behind `dailyTargets`, shared with the browser push channel. */
export function isDailyDue(lastDailyDayPlusOne: number, day: number, activeWithinDays = 7): boolean {
  if (lastDailyDayPlusOne === 0) return false; // never pulled
  const lastDay = lastDailyDayPlusOne - 1;
  if (lastDay === day) return false; // already pulled today
  return day - lastDay <= activeWithinDays; // else drifted away
}

/** The jackpot winner's FID, when the winner is someone we can actually reach. */
export function jackpotWinnerFid(winner: string | undefined, fidOf: FidLookup): number | undefined {
  return winner ? fidOf(winner) : undefined;
}

// ---------------------------------------------------------------------------
// Browser push audiences. One rule throughout: a player Farcaster already reaches for a message
// does not get it twice. Everything else about WHO qualifies is the same rule as the FID path.
// ---------------------------------------------------------------------------

/** The stored subscription fields the audience rules read. */
export interface PushSub {
  address: string; // lowercase
  fid: number | null;
}

/**
 * Hunger warnings for browser subscribers. An address the Farcaster pass already warns (its owner
 * is a notifiable FID's linked wallet, i.e. `fidOf` resolves it) is skipped.
 */
export function webPushHungerTargets(
  byAddress: readonly AddressHungerTarget[],
  subs: readonly PushSub[],
  fidOf: FidLookup,
  accountOf: (address: string) => string = (a) => a.toLowerCase(),
): AddressHungerTarget[] {
  // A browser subscribed on any wallet of the account receives the account's warning.
  const subscribed = new Set(subs.map((s) => accountOf(s.address).toLowerCase()));
  return byAddress.filter((t) => subscribed.has(t.address) && fidOf(t.address) === undefined);
}

/** The jackpot winner's browsers, when Farcaster can't reach the winner. */
export function webPushWinnerSubs<T extends PushSub>(
  winner: string | undefined,
  subs: readonly T[],
  fidOf: FidLookup,
  accountOf: (address: string) => string = (a) => a.toLowerCase(),
): T[] {
  if (!winner || fidOf(winner) !== undefined) return [];
  // Every browser of the winner's account: they may have subscribed on another linked wallet.
  const w = accountOf(winner).toLowerCase();
  return subs.filter((s) => accountOf(s.address).toLowerCase() === w);
}
