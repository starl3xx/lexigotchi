/**
 * The player's earnings as the screens read them: whole $WORD, keyed by word (lib/rewards/earnings.ts
 * computes them on the server for the chain game; the practice store keeps its own).
 *
 * Earnings are paid automatically (decisions.md #16): each morning at 00:05 UTC the keeper posts
 * every earning word's share and pays it straight to the wallet that holds the word. So "earned"
 * is money already in a wallet; `waiting` is the rare share not paid yet (the payout failed or is
 * running late), which the player can collect themselves.
 *
 * Pure (no React), so the wording rules are tested (tests/earnings-view.test.ts).
 */
import type { EarningsJson } from "@/lib/rewards/earnings";
import { TIER_WEIGHT } from "@/lib/economy";
import { DEFAULT_PARAMS } from "@/lib/params";
import { hungerFactor } from "@/lib/keeper/shares";
import type { Hunger, OwnedWord } from "./state";

export interface WordEarned {
  /** Everything this word has earned for the player. */
  total: number;
  /** What it earned at the latest payout (0 if nothing that day). */
  latest: number;
  /** Earned but not paid out yet. */
  waiting: number;
}

export interface PlayerEarnings {
  /** When the latest payout happened (ms), or null when there hasn't been one. */
  latestAt: number | null;
  /** Yield per word, keyed by the word (uppercase). Words no longer held aren't here. */
  byWord: Record<string, WordEarned>;
  /** All earned (yield and bounty), what the latest payout brought (its yield and a bounty week settled that morning), and what isn’t paid out yet. */
  total: number;
  latest: number;
  waiting: number;
  /** All bounty shares earned. */
  bounty: number;
}

/** The keeper pays at about 00:05 UTC on its day (vercel.json cron). */
const PAYOUT_MINUTE_MS = 5 * 60_000;

const wei = (s: string) => Number(BigInt(s) / 10n ** 12n) / 1e6;

/** The server's summary, with token ids turned back into the player's words. */
export function earningsFromJson(j: EarningsJson, wordOf: (tokenId: string) => string | undefined): PlayerEarnings {
  const byWord: Record<string, WordEarned> = {};
  for (const w of j.words) {
    const word = wordOf(w.tokenId);
    if (word) byWord[word] = { total: wei(w.total), latest: wei(w.latest), waiting: wei(w.waiting) };
  }
  return {
    latestAt: j.latestDay === null ? null : j.latestDay * 86_400_000 + PAYOUT_MINUTE_MS,
    byWord,
    total: wei(j.total),
    latest: wei(j.latest),
    waiting: wei(j.waiting),
    bounty: wei(j.bountyTotal),
  };
}

/**
 * When a payout happened, in the player's own calendar: "today", "yesterday", or "on Mon, Nov 23".
 * 00:05 UTC is the evening before in the Americas, so the local date is the one that reads right.
 */
export function payoutWhen(at: number, now: number = Date.now()): string {
  const day = (t: number) => {
    const d = new Date(t);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  };
  const diff = Math.round((day(now) - day(at)) / 86_400_000);
  if (diff <= 0) return "today";
  if (diff === 1) return "yesterday";
  return `on ${new Date(at).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}`;
}

/** "at today’s payout", "at yesterday’s payout", or "at the payout on Sun, Nov 22" (from payoutWhen). */
export function payoutPhrase(when: string): string {
  if (when === "today") return "at today’s payout";
  if (when === "yesterday") return "at yesterday’s payout";
  return `at the payout ${when}`;
}

/**
 * The daily payout time (00:05 UTC) in the player's own clock, e.g. "6:05 PM". Today's 00:05 UTC,
 * not a fixed date's: a winter date would be an hour off all summer wherever clocks change.
 */
export function payoutTimeLocal(now: number = Date.now()): string {
  const d = new Date(now);
  d.setUTCHours(0, 5, 0, 0);
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

/**
 * Where a word stands on earning, and the one thing that would change it:
 * - "earning": all UPPERCASE, staked, fed: a full share every day.
 * - "half": peckish, half a share until fed.
 * - "paused": hungry, no share until fed.
 * - "unstaked": all UPPERCASE but not staked.
 * - "raise": not all UPPERCASE yet (`left` letters to go; `staked`, so its line never asks to stake it again).
 */
export type EarningStatus = { kind: "earning" } | { kind: "half" } | { kind: "paused" } | { kind: "unstaked" } | { kind: "raise"; left: number; staked: boolean };

export function earningStatus(word: Pick<OwnedWord, "upper" | "staked">, h: Hunger): EarningStatus {
  const left = word.upper.filter((u) => !u).length;
  if (left > 0) return { kind: "raise", left, staked: word.staked };
  if (!word.staked) return { kind: "unstaked" };
  if (h === "hungry") return { kind: "paused" };
  if (h === "peckish") return { kind: "half" };
  return { kind: "earning" };
}

/**
 * The earnings line's words (EarningsLine), or null when it has nothing to say: no earnings yet
 * and no word that could earn (Next steps covers how to start). `amount` is the part shown bold.
 */
export function earningsLineText(
  e: PlayerEarnings,
  o: { canEarn: boolean; practice: boolean; payoutTime: string; fmt: (n: number) => string; now?: number },
): { lead: string; amount?: string; rest: string } | null {
  if (e.total <= 0) {
    if (!o.canEarn) return null;
    return o.practice
      ? { lead: "Your words get their first earnings when you skip to the next day.", rest: "" }
      : { lead: `Your words get their first earnings at ${o.payoutTime}.`, rest: "" };
  }
  const when = e.latestAt ? payoutWhen(e.latestAt, o.now) : null;
  const all = ` · ${o.fmt(e.total)} in all`;
  if (when && e.latest > 0) return { lead: "Your words earned ", amount: `+${o.fmt(e.latest)}`, rest: ` $WORD ${when}${all}` };
  return { lead: `Nothing earned ${when ?? "lately"}`, rest: all };
}

// ── practice mode ────────────────────────────────────────────────────────────────────────────

/**
 * Practice's own earnings: what the practice store keeps between days. `at` is when the latest
 * payout happened (ms, set by the skip that paid it, so it stays put between renders).
 */
export interface PracticeEarned {
  at: number | null;
  byWord: Record<string, { total: number; latest: number }>;
}

/**
 * A practice day's share per weight unit. Practice has no pool to split, so a fixed share stands in:
 * a Common word earns this a day, a Legendary 8×, as the keeper weighs them (keeper/shares.ts).
 */
export const PRACTICE_SHARE = 20_000;

/**
 * What practice pays each word at the end of a day, as the keeper would: all UPPERCASE and staked,
 * weighted by tier × hunger (peckish half, hungry nothing) × prestige. Uses the hunger the day
 * ended with, before the new day adds one.
 */
export function practicePayout(words: readonly Pick<OwnedWord, "word" | "tier" | "upper" | "staked" | "daysUnfed" | "prestigeLevel" | "mine">[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const w of words) {
    if (!w.mine || !w.staked || !w.upper.every(Boolean)) continue;
    const amount = Math.round(
      PRACTICE_SHARE * TIER_WEIGHT[w.tier] * hungerFactor(w.daysUnfed, DEFAULT_PARAMS) * DEFAULT_PARAMS.prestige.yieldMultPerLevel ** w.prestigeLevel,
    );
    if (amount > 0) out[w.word] = amount;
  }
  return out;
}

/** Add a day's payout to practice's record: each word's total grows, `latest` is that day's. */
export function addPracticeDay(prev: PracticeEarned | undefined, at: number, paid: Record<string, number>): PracticeEarned {
  const byWord: PracticeEarned["byWord"] = {};
  for (const [w, e] of Object.entries(prev?.byWord ?? {})) byWord[w] = { total: e.total, latest: 0 };
  for (const [w, amount] of Object.entries(paid)) byWord[w] = { total: (byWord[w]?.total ?? 0) + amount, latest: amount };
  return { at, byWord };
}

/** Practice's record as the screens read it. Practice pays at once, so nothing ever waits. */
export function practiceEarnings(e: PracticeEarned | undefined): PlayerEarnings {
  const byWord: Record<string, WordEarned> = {};
  let total = 0, latest = 0;
  for (const [w, x] of Object.entries(e?.byWord ?? {})) {
    byWord[w] = { total: x.total, latest: x.latest, waiting: 0 };
    total += x.total;
    latest += x.latest;
  }
  return { latestAt: e?.at ?? null, byWord, total, latest, waiting: 0, bounty: 0 };
}

/** One plain sentence for a word's status, in the player's voice. */
export function earningLine(word: string, s: EarningStatus): string {
  switch (s.kind) {
    case "earning":
      return `${word} earns a full share of $WORD every day.`;
    case "half":
      return `${word} is peckish, so it earns half until you feed it.`;
    case "paused":
      return `${word} is hungry, so it earns nothing until you feed it.`;
    case "unstaked":
      return `Stake ${word} and it earns $WORD every day.`;
    case "raise":
      return s.staked
        ? `Raise ${s.left} more letter${s.left === 1 ? "" : "s"} to UPPERCASE, and ${word} earns $WORD every day.`
        : `Raise ${s.left} more letter${s.left === 1 ? "" : "s"} to UPPERCASE and stake ${word} to earn $WORD every day.`;
  }
}
