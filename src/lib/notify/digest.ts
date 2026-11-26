/**
 * The weekly email digest (decisions.md #47, part 5; starl3xx, 2026-11-26: "a weekly email digest
 * in place of daily emails"). A player who chooses it (email cadence "weekly", lib/notify/kinds.ts)
 * stops getting the emails that can come every day (the daily letter, payday, the deal alert) and
 * gets one email a week in their place. A word about to go hungry, a jackpot win, a sale, and a
 * bounty share still come as they happen: the first two can't wait a week.
 *
 * What it says is the player's week: what their words EARNED (that week's days and that week's
 * bounty, counted as the Earnings sheet counts: a share is earned once its epoch opens, paid or
 * still on its way, and a dead share counts nowhere), what they sold, and which staked words need a
 * snack now. A week with nothing in it sends nothing.
 *
 * Email only, to an account with a confirmed address and email on (so an unsubscribe stops it too),
 * once per week under a send-once mark. It runs in the keeper's `notify` job on the first day of a
 * week, the day the week before it is settled, AFTER the `payout` job has paid that week's last
 * shares (the canonical job order, lib/keeper/jobList.ts), and again the day after for a run that
 * failed. A line the player turned off as a reminder (hunger, a sale) stays out of their digest.
 *
 * The deal alert has no line here: a letter that was for sale some days ago is not news. A weekly
 * player who keeps the alert on still gets it by push.
 */
import { weeklyDigest, type Notification, type WeekFacts } from "./templates";

const WEI = 10n ** 18n;
const DAY = 86_400;
const lower = (a: string) => a.toLowerCase();

/** One share, as lib/rewards/load `loadShares` gives it. */
export interface DigestShare {
  stream: "yield" | "bounty";
  epochId: string;
  amount: string;
  /** Its epoch has nothing left to pay though this share wasn't paid: it never will be, and counts nowhere. */
  dead?: boolean;
}

/**
 * What a week's words earned: the yield of its days and its own bounty, whole $WORD down. Paid or
 * waiting, as the Earnings sheet counts (lib/rewards/earnings.ts): the payout has a time budget,
 * and a share it reaches a day late was still earned that week. Counting only paid shares would
 * leave such a share out of every digest.
 */
export function weekEarned(shares: readonly DigestShare[], period: number, periodDays: number): number {
  const first = period * periodDays;
  let wei = 0n;
  for (const s of shares) {
    if (s.dead) continue;
    const id = Number(s.epochId);
    if (s.stream === "yield" ? id >= first && id < first + periodDays : id === period) wei += BigInt(s.amount);
  }
  return Number(wei / WEI);
}

/** A staked word's care, as the keeper's scan gives it. */
export interface DigestWord {
  word: string;
  owner: string;
  staked: boolean;
  secondsUnfed: number;
}

/** The player's staked words that are hungry, and peckish, now: the longest unfed first. */
export function wordsNeedingCare(words: readonly DigestWord[], wallets: readonly string[], care: { peckishAfterDays: number; hungryAfterDays: number }): Pick<WeekFacts, "hungry" | "peckish"> {
  const mine = new Set(wallets.map(lower));
  const staked = words.filter((w) => w.staked && mine.has(lower(w.owner))).sort((a, b) => b.secondsUnfed - a.secondsUnfed || a.word.localeCompare(b.word));
  return {
    hungry: staked.filter((w) => w.secondsUnfed >= care.hungryAfterDays * DAY).map((w) => w.word),
    peckish: staked.filter((w) => w.secondsUnfed >= care.peckishAfterDays * DAY && w.secondsUnfed < care.hungryAfterDays * DAY).map((w) => w.word),
  };
}

export interface DigestDeps {
  /** The accounts that chose the weekly digest. */
  accounts: readonly string[];
  walletsOf: (account: string) => string[];
  /** The confirmed, opted-in address of each of these accounts. */
  recipients: (accounts: readonly string[]) => Promise<{ address: string; email: string }[]>;
  /** The week of one player. */
  weekOf: (account: string, wallets: readonly string[]) => Promise<WeekFacts>;
  claim: (account: string, mark: string) => Promise<"claimed" | "taken" | "unavailable">;
  release: (account: string, mark: string) => Promise<void>;
  send: (to: string, account: string, note: Notification, facts: [string, string][], id: string) => Promise<boolean>;
}

/**
 * Send the week's digests. One player's failure is its own. `dry` reads and counts, and neither
 * marks nor sends.
 */
export async function sendDigests(deps: DigestDeps, period: number, opts: { dry?: boolean; log?: (line: string) => void } = {}): Promise<{ sent: number; empty: number; skipped: number }> {
  const log = opts.log ?? (() => {});
  const out = { sent: 0, empty: 0, skipped: 0 };
  const accounts = [...new Set(deps.accounts.map(lower))];
  if (accounts.length === 0) return out;
  const emailOf = new Map((await deps.recipients(accounts)).map((r) => [lower(r.address), r.email]));
  for (const account of accounts) {
    const to = emailOf.get(account);
    if (!to) continue; // no confirmed address, or email turned off: nothing is owed
    try {
      const digest = weeklyDigest(await deps.weekOf(account, deps.walletsOf(account)), period);
      if (!digest) {
        out.empty++;
        continue;
      }
      const mark = digest.note.notificationId!;
      if (opts.dry) {
        log(`  [dry] would email ${account.slice(0, 10)}: ${digest.facts.map(([n, v]) => `${n} ${v}`).join("; ")}`);
        continue;
      }
      if ((await deps.claim(account, mark)) !== "claimed") {
        out.skipped++;
        continue;
      }
      if (await deps.send(to, account, digest.note, digest.facts, `digest-${account}-${mark}`).catch(() => false)) out.sent++;
      else await deps.release(account, mark);
    } catch (err) {
      log(`digest: one player's digest failed: ${String((err as Error)?.message ?? err).slice(0, 120)}`);
    }
  }
  return out;
}
