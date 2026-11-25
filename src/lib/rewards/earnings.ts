/**
 * What a player's words have earned (mindlessmonk, 2026-11-25: "If you have a 5/5 uppercase staked
 * and earning $word is there a place to see how much has been earned so far?").
 *
 * Every earning word gets one share a day (the yield stream, epoch = UTC day) and a theme-bounty
 * share when its week pays (the bounty stream). Each share is a reward leaf the keeper stored before
 * opening its epoch, and since decisions.md #16 the keeper also pays every share out the same
 * morning (the `payout` job), so "earned" mostly means "already in the wallet". A share not paid
 * yet is `waiting`.
 *
 * "Earned for you" counts only leaves paying the player's own wallets: a word's earlier shares may
 * have paid a previous holder. Pure, so the sums are tested (tests/earnings.test.ts).
 */

import { DEFAULT_PARAMS } from "@/lib/params";

export type RewardStream = "yield" | "bounty";

/** One stored share whose epoch the chain opened with that same root (keeper/claimables liveLeaves). */
export interface LeafStatus {
  stream: RewardStream;
  epochId: string;
  tokenId: string;
  account: string;
  /** $WORD wei. */
  amount: bigint;
  /** The chain says it has been paid out (hasClaimed). */
  paid: boolean;
  /**
   * Its epoch has nothing left to pay (claimed == funded) although this share wasn't paid: the
   * owner recovered the remainder after the claim window (MerkleEpochs.recoverUnclaimed). It can
   * never be paid, so it counts nowhere.
   */
  dead?: boolean;
}

export interface WordEarnings {
  tokenId: string;
  /** Everything this word has earned for the player (paid and waiting), yield only. */
  total: bigint;
  /** Earned but not in a wallet yet. */
  waiting: bigint;
  /** Earned on the latest payout day (0 if it earned nothing that day). */
  latest: bigint;
  /** How many payout days it has earned on. */
  days: number;
}

export interface EarningsSummary {
  /** The latest UTC day the chain opened a yield payout for, or null when none is known. */
  latestDay: number | null;
  /** Per word, yield only, biggest total first. */
  words: WordEarnings[];
  /** All yield earned, and what of it the latest payout day brought. */
  yieldTotal: bigint;
  yieldLatest: bigint;
  /** All bounty shares earned. */
  bountyTotal: bigint;
  /** Both streams: earned, and earned but not paid yet. */
  total: bigint;
  waiting: bigint;
  /**
   * What the latest payout day brought, both streams: its yield, plus a bounty week that settled
   * that same morning (Bugbot on #177: the day a bounty pays, "today" must include it).
   */
  latest: bigint;
}

/**
 * The UTC day a bounty week pays: the keeper settles week P on the first day of week P + 1
 * (keeper/jobs.ts bountyPeriodToSettle), and on no other day.
 */
export function bountyPayDay(period: number, periodDays: number = DEFAULT_PARAMS.bounty.periodDays): number {
  return (period + 1) * periodDays;
}

export function summarizeEarnings(
  leaves: readonly LeafStatus[],
  latestDay: number | null,
  periodDays: number = DEFAULT_PARAMS.bounty.periodDays,
): EarningsSummary {
  const byWord = new Map<string, WordEarnings>();
  let yieldTotal = 0n, yieldLatest = 0n, bountyTotal = 0n, bountyLatest = 0n, waiting = 0n;
  const latest = latestDay === null ? null : String(latestDay);
  for (const l of leaves) {
    if (l.dead) continue;
    if (!l.paid) waiting += l.amount;
    if (l.stream === "bounty") {
      bountyTotal += l.amount;
      if (latestDay !== null && bountyPayDay(Number(l.epochId), periodDays) === latestDay) bountyLatest += l.amount;
      continue;
    }
    yieldTotal += l.amount;
    const w = byWord.get(l.tokenId) ?? { tokenId: l.tokenId, total: 0n, waiting: 0n, latest: 0n, days: 0 };
    w.total += l.amount;
    w.days += 1;
    if (!l.paid) w.waiting += l.amount;
    if (l.epochId === latest) {
      w.latest += l.amount;
      yieldLatest += l.amount;
    }
    byWord.set(l.tokenId, w);
  }
  const words = [...byWord.values()].sort((a, b) => (b.total > a.total ? 1 : b.total < a.total ? -1 : a.tokenId.localeCompare(b.tokenId)));
  return {
    latestDay,
    words,
    yieldTotal,
    yieldLatest,
    bountyTotal,
    total: yieldTotal + bountyTotal,
    waiting,
    latest: yieldLatest + bountyLatest,
  };
}

/** The summary as JSON: every amount a decimal wei string (bigint doesn't serialize). */
export interface EarningsJson {
  latestDay: number | null;
  words: { tokenId: string; total: string; waiting: string; latest: string; days: number }[];
  yieldTotal: string;
  yieldLatest: string;
  bountyTotal: string;
  total: string;
  waiting: string;
  latest: string;
}

export function earningsJson(s: EarningsSummary): EarningsJson {
  return {
    latestDay: s.latestDay,
    words: s.words.map((w) => ({ tokenId: w.tokenId, total: String(w.total), waiting: String(w.waiting), latest: String(w.latest), days: w.days })),
    yieldTotal: String(s.yieldTotal),
    yieldLatest: String(s.yieldLatest),
    bountyTotal: String(s.bountyTotal),
    total: String(s.total),
    waiting: String(s.waiting),
    latest: String(s.latest),
  };
}

/**
 * The latest yield day the chain has opened, from `epochs(day).open` for the last few UTC days
 * (newest first). The keeper opens today's at 00:05 UTC, so before then the latest is yesterday.
 */
export function latestOpenDay(days: readonly number[], open: readonly boolean[]): number | null {
  let best: number | null = null;
  days.forEach((d, i) => {
    if (open[i] && (best === null || d > best)) best = d;
  });
  return best;
}
