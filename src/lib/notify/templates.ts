/**
 * Notification copy, in Lexigotchi's voice: the pet voice of the messaging guide (docs/messaging.md,
 * decisions.md #22). A reminder names the letter or word it's about, written in its case ("FUNKY is
 * peckish", "your q"), and a jackpot line always carries "staked and fed".
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
 *
 * A THIRD RULE, on `notificationId`. The client drops a repeated (id, FID) pair for 24h, which
 * makes a retried cron safe — but the same mechanism silently eats real notifications if the id is
 * coarser than the thing it describes. So the id has to match what the message IS:
 *
 *   NUDGES describe a STATE ("your words are hungry", "you have unclaimed rewards"). The state is
 *   still true an hour later, so one per day is the intent — day-keyed ids are the feature.
 *
 *   RECEIPTS describe an EVENT ("your Q listing filled"). Two fills are two different facts, and a
 *   dropped receipt means a player never learns a trade happened. These MUST key on something
 *   unique to the event — an order hash, a tx hash — never on the day.
 *
 * Getting this backwards is invisible in testing (the first one always arrives) and only shows up
 * as players quietly not being told things.
 */

import { LIMITS } from "./limits";
import { DEFAULT_PARAMS } from "@/lib/params";

/** The pity cap, as titles and bodies quote it ("85%"): a param, so a static string per build. */
const PITY_CAP = `${Math.round(DEFAULT_PARAMS.roll.pityCap * 100)}%`;

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
  "Someone’s feeling peckish",
  "Your words need a snack",
] as const;

/**
 * `word` is the one whose deadline is soonest (lib/notify/triggers), named the way the game shows
 * words; `words` counts every staked word inside the warning window. Every one of them is peckish:
 * the window (HUNGER_WARN_HOURS) sits inside the peckish stretch, which tests/notify.test.ts holds.
 */
export function hungerWarning(t: { word: string; words: number; hoursLeft: number }, day = epochDay()): Notification {
  const word = t.word.toUpperCase();
  const others = t.words - 1;
  return {
    title: rotate(HUNGER_TITLES, day),
    body:
      others <= 0
        ? `${word} is peckish. Feed it within ${t.hoursLeft}h, or it goes hungry and sits out the jackpot.`
        : `${word} and ${others} more ${others === 1 ? "word" : "words"} are peckish. Feed them within ${t.hoursLeft}h, or they go hungry and sit out the jackpot.`,
    notificationId: `hunger-${day}`,
  };
}

// ── Daily pull ────────────────────────────────────────────────────────────────────────
// Only ever sent to players who have NOT pulled today (see the cron). A daily ping to someone who
// already played is the single fastest way to get an app muted.
const DAILY_TITLES = [
  "Your free letter is here",
  "A fresh letter awaits",
  "Today’s letter is waiting",
  "Come meet today’s letter",
] as const;

export function dailyReady(day = epochDay()): Notification {
  return {
    title: rotate(DAILY_TITLES, day),
    body: "Your free letter is here, on the house. Come see who showed up.",
    notificationId: `daily-${day}`,
  };
}

// ── Jackpot ───────────────────────────────────────────────────────────────────────────
const WON_TITLES = ["You won the jackpot", "The pot is yours", "Your word came up"] as const;

/**
 * RECEIPT, but safely day-keyed: `Jackpot.resolve` reverts with `AlreadyResolvedToday` unless the
 * UTC epoch-day has advanced, so there is exactly one win per day by contract. The day IS the
 * event id here — that's a guarantee, not a coincidence, and it breaks if that guard ever goes.
 */
export function jackpotWon(word: string, amount: string, day = epochDay()): Notification {
  return {
    title: rotate(WON_TITLES, day),
    body: `${word.toUpperCase()} was today’s word, and you held it staked and fed. ${amount} just landed in your wallet.`,
    notificationId: `won-${day}`,
  };
}

// Broadcast — throttled to a threshold crossing, never fired on every rollover.
const ROLLOVER_TITLES = ["The pot keeps growing", "Nobody had it", "The jackpot rolls on"] as const;

export function jackpotRollover(amount: string, day = epochDay()): Notification {
  return {
    title: rotate(ROLLOVER_TITLES, day),
    body: `Nobody held today’s word staked and fed, so the pot rolled over. It’s up to ${amount} now.`,
    notificationId: `rollover-${day}`,
  };
}

// ── Earnings ──────────────────────────────────────────────────────────────────────────
// RECEIPT. Earnings are paid automatically each morning (decisions.md #16), so this tells a player
// what landed, never asks them to collect. One per payout day.
const PAID_TITLES = ["Payday for your words", "Your words got paid", "Fresh $WORD from your words"] as const;

export function earningsPaid(amount: string, day = epochDay()): Notification {
  return {
    title: rotate(PAID_TITLES, day),
    body: `Your words earned ${amount} at today’s payout, paid straight to the wallets that hold them.`,
    notificationId: `paid-${day}`,
  };
}

// ── Rolls ─────────────────────────────────────────────────────────────────────────────
const PITY_TITLES = [`Your next roll is ${PITY_CAP}`, "Best odds you’ll get", "Your luck is capped"] as const;

/**
 * NUDGE. One prod per letter per day is deliberate: the cap persists until you roll it. A roll raises
 * a lowercase letter, so the letter is named lowercase ("your q").
 */
export function pityCapped(letter: string, day = epochDay()): Notification {
  return {
    title: rotate(PITY_TITLES, day),
    body: `Enough near-misses on your ${letter.toLowerCase()}: its next roll sits at the ${PITY_CAP} cap. A miss never hurts it.`,
    notificationId: `pity-${letter.toLowerCase()}-${day}`,
  };
}

// ── Market ────────────────────────────────────────────────────────────────────────────
const SOLD_TITLES = ["Your letter sold", "Someone took your offer", "Swap filled"] as const;

/**
 * RECEIPT — keyed on the Seaport order hash, which is the canonical identity of a fill. Day-keying
 * this (the obvious-looking `filled-${letter}-${day}`) silently swallows the second sale of the
 * same letter on the same day, which is an ordinary thing for an active trader to do: the trade
 * settles on-chain, the $WORD arrives, and we simply never mention it.
 */
export function listingFilled(letter: string, orderHash: string, day = epochDay()): Notification {
  return {
    title: rotate(SOLD_TITLES, day),
    body: `Your ${letter} found a new home: the trade settled onchain. Check your bag.`,
    // Trimmed to fit the 128-char id budget; a 32-byte hash prefix is still collision-free here.
    notificationId: `filled-${orderHash.toLowerCase().replace(/^0x/, "").slice(0, 32)}`,
  };
}

/** Every template pool, for the length guardrail test and the admin console's preview. */
export const ALL_TITLE_POOLS: Record<string, readonly string[]> = {
  hunger: HUNGER_TITLES,
  daily: DAILY_TITLES,
  won: WON_TITLES,
  rollover: ROLLOVER_TITLES,
  paid: PAID_TITLES,
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
