/**
 * Notification copy, in Lexigotchi's voice.
 *
 * TWO RULES, both learned from reading LHAW's production notifier:
 *
 * 1. TITLES NEVER INTERPOLATE. Every title here is a static string, so its 32-character budget is
 *    provable by inspection and cannot be blown by data. LHAW's `🔵 ${jackpot} up for grabs`
 *    measures exactly 32 UTF-16 units at today's pot and overflows the day the pot gains a digit —
 *    a bug that ships silently, because nobody writes a test for a string that fits *today*.
 *    Variable content goes in the body, which has four times the room and is still clamped.
 *
 * 2. VARIANTS ROTATE BY DAY, NOT AT RANDOM. Random picking lets a player draw the same line three
 *    days running, which is exactly when a daily notification starts reading like a robot. Indexing
 *    on the epoch-day guarantees the rotation actually rotates, and makes the copy testable.
 *
 * Every string is clamped again at send time (`clamp` in ./send) — these rules make the clamp a
 * backstop rather than the thing standing between us and a truncated push.
 */

import { LIMITS } from "./send";

export interface Notification {
  title: string;
  body: string;
  targetUrl?: string;
  notificationId?: string;
}

/** UTC epoch-day — the same clock the contracts and the countdown speak. */
export function epochDay(now: Date = new Date()): number {
  return Math.floor(now.getTime() / 86_400_000);
}

/** Deterministic rotation: same day → same variant, consecutive days → different variants. */
function rotate<T>(variants: readonly T[], day: number): T {
  return variants[day % variants.length];
}

// ── Hunger: the one notification the game genuinely owes its players ──────────────────
// A hungry word earns nothing AND loses jackpot eligibility. Without a warning that's a tax on
// people who were asleep; with one, hunger becomes a mechanic you can actually play around.
const HUNGER_TITLES = [
  "Your words are getting hungry",
  "Feeding time",
  "Someone's feeling peckish",
  "Your words need a snack",
] as const;

export function hungerWarning(wordCount: number, hoursLeft: number, day = epochDay()): Notification {
  const s = wordCount === 1 ? "word" : "words";
  return {
    title: rotate(HUNGER_TITLES, day),
    body: `${wordCount} staked ${s} go hungry in ${hoursLeft}h — no yield, no jackpot. A snack fixes it.`,
    notificationId: `hunger-${day}`,
  };
}

// ── Daily pull ────────────────────────────────────────────────────────────────────────
// Only ever sent to players who have NOT pulled today (see the cron). A daily ping to someone who
// already played is the single fastest way to get an app muted.
const DAILY_TITLES = [
  "Your daily letter is ready",
  "A fresh letter awaits",
  "Today's letter is waiting",
  "Come collect your letter",
] as const;

export function dailyReady(day = epochDay()): Notification {
  return {
    title: rotate(DAILY_TITLES, day),
    body: "Your free daily pull just reset. One letter, on the house — go see what you drew.",
    notificationId: `daily-${day}`,
  };
}

// ── Jackpot ───────────────────────────────────────────────────────────────────────────
const WON_TITLES = ["You won the jackpot", "The pot is yours", "Your word came up"] as const;

export function jackpotWon(word: string, amount: string, day = epochDay()): Notification {
  return {
    title: rotate(WON_TITLES, day),
    body: `${word.toUpperCase()} was today's answer. ${amount} just landed in your bag.`,
    notificationId: `won-${day}`,
  };
}

// Broadcast — throttled to a threshold crossing, never fired on every rollover.
const ROLLOVER_TITLES = ["The pot keeps growing", "Nobody had it", "The jackpot rolls on"] as const;

export function jackpotRollover(amount: string, day = epochDay()): Notification {
  return {
    title: rotate(ROLLOVER_TITLES, day),
    body: `No one held today's word, so the pot rolled over. It's up to ${amount} now.`,
    notificationId: `rollover-${day}`,
  };
}

// ── Earnings ──────────────────────────────────────────────────────────────────────────
const CLAIM_TITLES = ["Your rewards are ready", "You have earnings to claim", "Time to collect"] as const;

export function claimReady(amount: string, day = epochDay()): Notification {
  return {
    title: rotate(CLAIM_TITLES, day),
    body: `${amount} in yield and bounties is sitting unclaimed. One tap moves it to your bag.`,
    notificationId: `claim-${day}`,
  };
}

// ── Rolls ─────────────────────────────────────────────────────────────────────────────
const PITY_TITLES = ["Your next roll is 85%", "Best odds you'll get", "Your luck is capped"] as const;

export function pityCapped(letter: string, day = epochDay()): Notification {
  return {
    title: rotate(PITY_TITLES, day),
    body: `Enough near-misses on ${letter.toUpperCase()} — your next roll sits at the 85% cap. Failure costs you nothing.`,
    notificationId: `pity-${letter.toLowerCase()}-${day}`,
  };
}

// ── Market ────────────────────────────────────────────────────────────────────────────
const SOLD_TITLES = ["Your letter sold", "Someone took your offer", "Swap filled"] as const;

export function listingFilled(letter: string, day = epochDay()): Notification {
  return {
    title: rotate(SOLD_TITLES, day),
    body: `Your ${letter.toUpperCase()} listing just filled. The trade settled on-chain — check your bag.`,
    notificationId: `filled-${letter.toLowerCase()}-${day}`,
  };
}

/** Every template pool, for the length guardrail test and the admin console's preview. */
export const ALL_TITLE_POOLS: Record<string, readonly string[]> = {
  hunger: HUNGER_TITLES,
  daily: DAILY_TITLES,
  won: WON_TITLES,
  rollover: ROLLOVER_TITLES,
  claim: CLAIM_TITLES,
  pity: PITY_TITLES,
  sold: SOLD_TITLES,
};

/** True when a notification is within every published limit before clamping saves it. */
export function withinLimits(n: Notification): boolean {
  return (
    n.title.length <= LIMITS.title &&
    n.body.length <= LIMITS.body &&
    (n.notificationId ?? "").length <= LIMITS.notificationId
  );
}
