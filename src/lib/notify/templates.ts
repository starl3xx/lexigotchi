/**
 * Notification copy, in Lexigotchi's voice: the pet voice of the messaging guide (docs/messaging.md,
 * decisions.md #24). A reminder names the letter or word it's about, written in its case ("FUNKY is
 * sleepy", "your q"), and a jackpot line always carries "staked and awake".
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
import { fmtWord } from "@/lib/wordAmount";
import { goUrl } from "@/lib/gameLinks";

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
  "Your words are getting sleepy",
  "Time to wake your words",
  "Someone’s getting sleepy",
  "Your words are nodding off",
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
        ? `${word} is sleepy. Wake it within ${t.hoursLeft}h, or it falls asleep and sits out the jackpot.`
        : `${word} and ${others} more ${others === 1 ? "word" : "words"} are sleepy. Wake them within ${t.hoursLeft}h, or they fall asleep and sit out the jackpot.`,
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
    body: `${word.toUpperCase()} was today’s word, and you held it staked and awake. ${amount} just landed in your wallet.`,
    notificationId: `won-${day}`,
  };
}

// Broadcast — throttled to a threshold crossing, never fired on every rollover.
const ROLLOVER_TITLES = ["The pot keeps growing", "Nobody had it", "The jackpot rolls on"] as const;

export function jackpotRollover(amount: string, day = epochDay()): Notification {
  return {
    title: rotate(ROLLOVER_TITLES, day),
    body: `Nobody held today’s word staked and awake, so the pot rolled over. It’s up to ${amount} now.`,
    notificationId: `rollover-${day}`,
  };
}

// ── Earnings ──────────────────────────────────────────────────────────────────────────
// RECEIPT. Earnings are paid automatically each morning (decisions.md #16), so this tells a player
// what their words earned, never asks them to collect. One per payout day. `rest`: the payout ran
// out of time with part of it still to pay (lib/notify/paid.ts), so it doesn't say all of it is paid.
const PAID_TITLES = ["Payday for your words", "Your words got paid", "Fresh $WORD from your words"] as const;

export function earningsPaid(amount: string, day = epochDay(), rest = false): Notification {
  return {
    title: rotate(PAID_TITLES, day),
    // Not "today's payout": a day no run had reached is told of with the next one.
    body: rest
      ? `Your words earned ${amount}. Part is paid, and the rest goes out with the next payout.`
      : `Your words earned ${amount}. It’s paid, straight to the wallets that hold them.`,
    notificationId: `paid-${day}`,
  };
}

// ── The weekly bounty ─────────────────────────────────────────────────────────────────
// RECEIPT. A week's bounty is shared between the words that fit its theme, so a player is told of
// THEIR share, never "the bounty is yours". One per week (the period is the event).
const BOUNTY_TITLES = ["A share of the bounty is yours", "Your words fit the theme", "Bounty day for your words"] as const;

export function bountyPaid(amount: string, theme: string, period: number, day = epochDay(), rest = false): Notification {
  return {
    title: rotate(BOUNTY_TITLES, day),
    body: `Your words fit the week’s theme, ${theme}. Their share of the bounty is ${amount}${rest ? ": part is paid, the rest follows." : ", and it’s in your wallet."}`,
    notificationId: `bounty-${period}`,
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
const SOLD_LETTER_TITLES = ["Your letter sold", "Someone bought your letter", "Sold on the Market"] as const;
const SOLD_WORD_TITLES = ["Your word sold", "Someone bought your word", "Sold on the Market"] as const;
const SOLD_MANY_TITLES = ["Sold on the Market", "Your listings sold", "A good day at your stall"] as const;

/** One recorded fill, as the seller is told of it. */
export interface SoldItem {
  kind: "word" | "letter";
  /** The word (UPPERCASE), or the letter in its case ("q", "Q"). */
  name: string;
  /** Letters in this fill (1 for a word). */
  qty: number;
  /** What the buyer paid, whole $WORD. */
  amount: number;
  /** What the seller keeps of it (the sale less the Market's fee), whole $WORD, when it is known. */
  share?: number;
  /** The fill's own identity: its transaction and its place in it. */
  txHash: string;
  logIndex: number;
}

const wordAmount = (n: number) => `${fmtWord(n)} $WORD`;

/**
 * RECEIPT: what a seller sold, one message for everything a catch-up found for them (a buyer can
 * take several listings in a minute, and a row of pushes for it is how a channel gets muted).
 *
 * Keyed on the FILL (its transaction and log index), never on the order or the day. A letter order
 * fills in parts (decisions.md #30): its second part is another sale under the same order hash, and
 * the client drops a repeated id for 24 h, so an order-keyed id would swallow it. The seller keeps
 * 90%, so the body says what it sold for and that their share has arrived, never "X is yours".
 */
export function marketSold(items: readonly SoldItem[], day = epochDay()): Notification | null {
  if (items.length === 0) return null;
  const first = items[0];
  const notificationId = `sold-${first.txHash.toLowerCase().replace(/^0x/, "").slice(0, 32)}-${first.logIndex}`;
  const share = "Your share is in your wallet.";
  if (items.length > 1) {
    const total = items.reduce((a, i) => a + i.amount, 0);
    return { title: rotate(SOLD_MANY_TITLES, day), body: `${items.length} of your listings sold, for ${wordAmount(total)} in all. ${share}`, notificationId };
  }
  if (first.kind === "word") {
    return { title: rotate(SOLD_WORD_TITLES, day), body: `${first.name.toUpperCase()} found a new home, for ${wordAmount(first.amount)}. ${share}`, notificationId };
  }
  return {
    title: rotate(SOLD_LETTER_TITLES, day),
    body:
      first.qty === 1
        ? `Your ${first.name} found a new home, for ${wordAmount(first.amount)}. ${share}`
        : `${first.qty} of your ${first.name} found new homes, for ${wordAmount(first.amount)}. ${share}`,
    notificationId,
  };
}

/**
 * The same sale as an email's ledger (lib/notify/email.ts `reminderEmail` facts): what sold, what
 * the buyer paid, and the seller's share when it is known for every item.
 */
export function soldFacts(items: readonly SoldItem[]): [string, string][] {
  if (items.length === 0) return [];
  const one = items.length === 1 ? items[0] : null;
  const what = one ? (one.kind === "word" ? one.name.toUpperCase() : one.qty === 1 ? one.name : `${one.qty} × ${one.name}`) : `${items.length} listings`;
  const facts: [string, string][] = [["Sold", what], ["For", wordAmount(items.reduce((a, i) => a + i.amount, 0))]];
  if (items.every((i) => i.share !== undefined)) facts.push(["Your share", wordAmount(items.reduce((a, i) => a + (i.share ?? 0), 0))]);
  return facts;
}

// ── A letter that finishes a word ─────────────────────────────────────────────────────
// NUDGE, and one a player asked for. Day-keyed, as every nudge is; what keeps the same letter and
// word to once a week is the sender's mark (lib/notify/deals.ts), not this id.
const DEAL_TITLES = ["One letter from a new word", "A letter you need is for sale", "The Market has your letter"] as const;

export function dealAlert(d: { letter: string; word: string; more: number; from: number }, day = epochDay()): Notification {
  const l = d.letter.toLowerCase();
  // "An x", "A q": the article a letter's NAME takes when said aloud (lib/wordNeed `article`).
  const a = "aefhilmnorsx".includes(l) ? "An" : "A";
  const also = d.more > 0 ? `, and ${d.more} more` : "";
  return {
    title: rotate(DEAL_TITLES, day),
    body: `${a} ${l} is for sale on the Market, from ${wordAmount(d.from)}. It finishes ${d.word.toUpperCase()}, a word nobody owns${also}.`,
    notificationId: `deal-${l}-${d.word.toLowerCase()}-${day}`,
  };
}

// ── The weekly digest ─────────────────────────────────────────────────────────────────
/** A player's week, as the digest's facts (lib/notify/digest.ts). */
export interface WeekFacts {
  /** What their words were paid this week (earnings and a bounty share), whole $WORD. */
  earned: number;
  /**
   * What they sold on the Market this week: how many sales (a letter listing bought in two parts is
   * two), and what the buyers paid, the amount a sale's own message calls "For" (`soldFacts`).
   */
  sold: { count: number; amount: number };
  /** Their staked words that are hungry now, and peckish now (the soonest first). */
  hungry: readonly string[];
  peckish: readonly string[];
}

const some = (words: readonly string[]) => (words.length === 1 ? words[0] : `${words[0]} and ${words.length - 1} more`);

/**
 * The weekly email, for a player who chose it in place of the daily emails. Null when the week had
 * nothing in it: an email that says "nothing happened" is the one that gets a player to unsubscribe.
 * It leads with the words, as every message does: what needs care comes first.
 */
export function weeklyDigest(w: WeekFacts, period: number): { note: Notification; facts: [string, string][] } | null {
  const facts: [string, string][] = [];
  if (w.hungry.length > 0) facts.push(["Asleep now", some(w.hungry)]);
  if (w.peckish.length > 0) facts.push(["Sleepy now", some(w.peckish)]);
  if (w.earned > 0) facts.push(["Your words earned", wordAmount(w.earned)]);
  // The count goes in the name: a ledger's value stays short, so its row of dots has room on a phone.
  if (w.sold.count > 0) facts.push([`${w.sold.count} ${w.sold.count === 1 ? "sale" : "sales"} on the Market`, wordAmount(w.sold.amount)]);
  if (facts.length === 0) return null;
  const body =
    w.hungry.length > 0
      ? `${some(w.hungry)} ${w.hungry.length === 1 ? "is" : "are"} asleep: a word that is asleep earns nothing and sits out the jackpot until it’s woken. Here is the rest of your week.`
      : "Here is how your words did this week.";
  return { note: { title: "Your week in Lexigotchi", body, notificationId: `week-${period}` }, facts };
}

// ── Turning reminders on ──────────────────────────────────────────────────────────────
/**
 * The one push a browser gets for opting in: proof, to the player and to us, that the whole path
 * works (permission, the service worker, the push service, the keys). Sent once, to that browser
 * only, when it first subscribes (api/push/subscribe).
 *
 * SHORT (`REMINDERS_ON_MAX`): its job is to show how a reminder looks, and a banner on a Mac shows
 * about three short lines under the site's name. The first real one listed every kind and was cut
 * off mid-sentence ("…and when…": starl3xx's screenshot, 2026-11-26). The list also went stale
 * each time a kind was added; the profile is where the kinds are.
 */
export const REMINDERS_ON_MAX = 80;

export function remindersOn(): Notification {
  return {
    title: "Reminders are on",
    body: "This is how a reminder looks. Your profile chooses which ones you get.",
    notificationId: "reminders-on",
  };
}

// ── Reserved word sets ────────────────────────────────────────────────────────────────
// RECEIPTS of a set's three moments (decisions.md, "Reserved word sets"), each keyed by the set and
// the moment: a set is revealed once, unlocks once, and its first day ends once. The titles are
// fixed (the 32-character cap is provable); the body carries the set's name, which is at most 60
// characters (lib/sets/rules.ts NAME_MAX), and every body fits the cap with a name that long.
// A tap opens the Dictionary at its Sets section (lib/gameLinks.ts), on every channel.
const SET_REVEALED_TITLES = ["A new set is revealed"] as const;
const SET_UNLOCKED_TITLES = ["A new set just unlocked"] as const;
const SET_OPEN_TITLES = ["A set is open to everyone"] as const;

/** A set is revealed: its name and words show, and it counts down to its unlock. */
export function setRevealed(set: { id: number; name: string }): Notification {
  return {
    title: SET_REVEALED_TITLES[0],
    body: `${set.name} is revealed. See its words in the Dictionary.`,
    targetUrl: goUrl("sets"),
    notificationId: `set-revealed-${set.id}`,
  };
}

/** A set unlocked. `firstDay`: the one-word rule applies today (the limit, when it isn't one). */
export function setUnlocked(set: { id: number; name: string }, firstDay: { limit: number } | null): Notification {
  const rule = firstDay ? (firstDay.limit <= 1 ? " First day: one word per player." : ` First day: ${firstDay.limit} words per player.`) : " Its words are open to claim.";
  return {
    title: SET_UNLOCKED_TITLES[0],
    body: `${set.name} is unlocked.${rule}`,
    targetUrl: goUrl("sets"),
    notificationId: `set-unlocked-${set.id}`,
  };
}

/** A set's first day ended: every word that's left is open to all. */
export function setOpen(set: { id: number; name: string }): Notification {
  return {
    title: SET_OPEN_TITLES[0],
    body: `${set.name} is open to everyone now. Claim any word that’s left.`,
    targetUrl: goUrl("sets"),
    notificationId: `set-open-${set.id}`,
  };
}

/** Every template pool, for the length guardrail test and the admin console's preview. */
export const ALL_TITLE_POOLS: Record<string, readonly string[]> = {
  hunger: HUNGER_TITLES,
  daily: DAILY_TITLES,
  won: WON_TITLES,
  rollover: ROLLOVER_TITLES,
  paid: PAID_TITLES,
  bounty: BOUNTY_TITLES,
  deal: DEAL_TITLES,
  digest: ["Your week in Lexigotchi"],
  pity: PITY_TITLES,
  soldLetter: SOLD_LETTER_TITLES,
  soldWord: SOLD_WORD_TITLES,
  soldMany: SOLD_MANY_TITLES,
  remindersOn: [remindersOn().title],
  setRevealed: SET_REVEALED_TITLES,
  setUnlocked: SET_UNLOCKED_TITLES,
  setOpen: SET_OPEN_TITLES,
};

/** True when a notification is within every published limit before clamping saves it. */
export function withinLimits(n: Notification): boolean {
  return (
    n.title.length <= LIMITS.title &&
    n.body.length <= LIMITS.body &&
    (n.notificationId ?? "").length <= LIMITS.notificationId
  );
}
