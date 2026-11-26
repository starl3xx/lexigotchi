/**
 * Tell players what the keeper's payout just paid them: their words' earnings ("payday", a kind a
 * player turns ON, because it comes every day a word earns) and their share of a week's bounty
 * (on unless turned off: once a week at most). decisions.md #47, part 3.
 *
 * **Only what LANDED, and only once it has ALL landed.** The payout has a time budget, and a share
 * it didn't reach waits for the next run. So this is fed the `RewardClaimed` events of the keeper's
 * own transactions (keeper/jobs `payOut`), never the list of shares it meant to pay. And a player
 * is told of a day (or a bounty week) only by the run that FINISHES paying it, with the whole
 * amount (`settledShares`): a message's id is the day or the week, so a first message about part of
 * it would state a part as the whole, and the rest could never be said (Bugbot on #244). A message
 * says "paid" because all of it is.
 *
 * One message per player per kind for a run: every wallet of an account is one player (the notes
 * are grouped by account), and the amounts are whole $WORD rounded DOWN.
 */
import { fmtWord } from "@/lib/wordAmount";
import { THEMES, themeForPeriod } from "@/lib/themes";
import { bountyPaid, earningsPaid } from "./templates";
import { notifyPlayers, type PlayerNote, type TellResult } from "./players";

/** One share the keeper's payout paid, from its `RewardClaimed` event. */
export interface LandedShare {
  stream: "yield" | "bounty";
  /** The yield's UTC day, or the bounty's week (period). */
  epochId: number;
  /** The word it was paid for, as a decimal string. */
  tokenId: string;
  /** The wallet it paid. */
  account: string;
  /** $WORD wei. */
  amount: bigint;
}

/** One share of an epoch the payout is working through: every leaf of its tree, paid already or not. */
export interface EpochShare extends LandedShare {
  /** The chain said it was paid before this run could pay it (an earlier run, or the player's own Collect). */
  paidBefore: boolean;
}

const shareKey = (s: Pick<LandedShare, "stream" | "epochId" | "tokenId">) => `${s.stream}:${s.epochId}:${s.tokenId}`;

/**
 * The shares to tell players of: EVERY share of each (player, day or week) that this run finished
 * paying. A set this run paid only part of is held back whole, and the run that pays its last share
 * tells of all of it, the shares paid earlier too. A set with nothing landed in this run is not
 * news (it was told of, or the player collected it themselves).
 */
export function settledShares(epoch: readonly EpochShare[], landed: readonly LandedShare[], accountOf: (address: string) => string): LandedShare[] {
  const landedNow = new Set(landed.map(shareKey));
  const sets = new Map<string, { shares: EpochShare[]; landed: boolean; waiting: boolean }>();
  for (const s of epoch) {
    const key = `${lower(accountOf(s.account))}:${s.stream}:${s.epochId}`;
    let set = sets.get(key);
    if (!set) sets.set(key, (set = { shares: [], landed: false, waiting: false }));
    const now = !s.paidBefore && landedNow.has(shareKey(s));
    set.shares.push(s);
    set.landed ||= now;
    set.waiting ||= !s.paidBefore && !now;
  }
  return [...sets.values()]
    .filter((set) => set.landed && !set.waiting)
    .flatMap((set) => set.shares.map(({ stream, epochId, tokenId, account, amount }) => ({ stream, epochId, tokenId, account, amount })));
}

const WEI = 10n ** 18n;
const lower = (a: string) => a.toLowerCase();
const words = (n: number) => `${fmtWord(n)} $WORD`;

/**
 * The payday notes: per account, everything its wallets' words were paid in this run. Keyed on the
 * newest day among them, so a run that also pays an earlier day's leftovers is still that day's one
 * message. Nothing for an account paid under one whole $WORD.
 */
export function paydayNotes(landed: readonly LandedShare[], accountOf: (address: string) => string): PlayerNote[] {
  const by = new Map<string, { wallet: string; wei: bigint; day: number }>();
  for (const s of landed) {
    if (s.stream !== "yield") continue;
    const account = lower(accountOf(s.account));
    const g = by.get(account) ?? { wallet: lower(s.account), wei: 0n, day: 0 };
    g.wei += s.amount;
    g.day = Math.max(g.day, s.epochId);
    by.set(account, g);
  }
  return [...by].flatMap(([account, g]) => {
    const whole = Number(g.wei / WEI);
    if (whole < 1) return [];
    const facts: [string, string][] = [["Earned", words(whole)]];
    return [{ account, wallet: g.wallet, note: earningsPaid(words(whole), g.day), facts }];
  });
}

/** The bounty notes: per account and week, its words' share, with the week's theme. */
export function bountyNotes(landed: readonly LandedShare[], accountOf: (address: string) => string): PlayerNote[] {
  const by = new Map<string, { account: string; wallet: string; wei: bigint; period: number }>();
  for (const s of landed) {
    if (s.stream !== "bounty") continue;
    const account = lower(accountOf(s.account));
    const key = `${account}:${s.epochId}`;
    const g = by.get(key) ?? { account, wallet: lower(s.account), wei: 0n, period: s.epochId };
    g.wei += s.amount;
    by.set(key, g);
  }
  return [...by.values()].flatMap((g) => {
    const whole = Number(g.wei / WEI);
    if (whole < 1) return [];
    const theme = THEMES[themeForPeriod(g.period)];
    const facts: [string, string][] = [["Theme", theme.name], ["Your words’ share", words(whole)]];
    return [{ account: g.account, wallet: g.wallet, note: bountyPaid(words(whole), theme.short, g.period), facts }];
  });
}

/**
 * Tell the players of what this payout run FINISHED paying. `landed` is the run's own events;
 * `epoch` is every share of the epochs it worked through (`settledShares` says why both).
 * Never throws (notifyPlayers doesn't).
 */
export async function notifyPaid(
  landed: readonly LandedShare[],
  epoch: readonly EpochShare[],
  opts: { log?: (line: string) => void } = {},
): Promise<{ payday: TellResult | null; bounty: TellResult | null }> {
  if (landed.length === 0) return { payday: null, bounty: null };
  // One after the other: a bounty week and a payday can be for the same player, and each is its own message.
  const payday = await notifyPlayers("payday", (accountOf) => paydayNotes(settledShares(epoch, landed, accountOf), accountOf), opts);
  const bounty = await notifyPlayers("bounty", (accountOf) => bountyNotes(settledShares(epoch, landed, accountOf), accountOf), opts);
  return { payday, bounty };
}
