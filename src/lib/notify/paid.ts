/**
 * Tell players what the keeper's payout just paid them: their words' earnings ("payday", a kind a
 * player turns ON, because it comes every day a word earns) and their share of a week's bounty
 * (on unless turned off: once a week at most). decisions.md #47, part 3.
 *
 * **A day or a week is told ONCE, by the run that pays the first of it, and it states the whole
 * share.** The payout has a time budget, and a share it didn't reach waits for the next run, so a
 * run may pay only part of what a player is owed for a day (or a bounty week). A message's id is
 * that day or week, so there can be only one message for it: it says the player's whole share,
 * which the epoch's tree fixes (`toldShares`), and it says "paid" of all of it only when all of it
 * landed. When part still waits it says so: "part is paid, the rest follows". It is fed the
 * `RewardClaimed` events of the keeper's own transactions (keeper/jobs `payOut`), never the list of
 * shares it meant to pay, so "landed" is the chain's word.
 *
 * Two rules that were tried and dropped (Bugbot on #244): stating only what landed made a part
 * read as the whole, and the later run's message was dropped as a repeat; holding the message
 * until all of it landed never told a player who collected the rest themselves.
 *
 * **The limit of this rule.** "Told" is read from the chain: a set with a share already paid when a
 * run begins is taken as told. So a set is never told when its first payment was not seen by a run
 * that got as far as the message: a transaction that lands after the run stopped waiting for it and
 * after its last read, or a share somebody claimed before the keeper's first payment (`claim` is
 * permissionless). Both are rare and cost one courtesy message. Do not close them with another
 * reading of the chain: the answer for the whole family is a recorded "told" mark per player and
 * epoch (lib/db/reminderMarks), and it is not built.
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

/** One share of an epoch the payout is working through: every leaf of its tree. */
export interface EpochShare extends LandedShare {
  /** The chain said it was paid when this run began (an earlier run, or the player's own Collect). */
  paidBefore: boolean;
  /**
   * Unpaid when the run began, not among its events, and paid at its end: the player collected it
   * meanwhile, or a transaction the run gave up waiting for landed after all.
   */
  paidNow?: boolean;
}

/** A share a message tells of. `waits`: it is the player's, and it is not paid yet. */
export interface ToldShare extends LandedShare {
  waits?: boolean;
}

/**
 * One share's name, the same whoever writes it: the epoch as a number and the token id as an
 * integer, since the database keeps both as text and an event gives them as bigints.
 */
export const shareKey = (s: { stream: string; epochId: string | number | bigint; tokenId: string | bigint }): string =>
  `${s.stream}:${Number(s.epochId)}:${BigInt(s.tokenId)}`;

/**
 * The shares to tell players of: EVERY share of each (player, day or week) whose FIRST share was
 * paid during this run. None of it was paid when the run began and some of it is paid at its end,
 * so this is the one run that tells of it; a share of it that still waits is marked, and the
 * message says the rest follows. A set with a share paid before this run was told of then (or the
 * player collected it), and a set nothing of which was paid in this run is not news yet.
 */
export function toldShares(epoch: readonly EpochShare[], landed: readonly LandedShare[], accountOf: (address: string) => string): ToldShare[] {
  const landedNow = new Set(landed.map(shareKey));
  const sets = new Map<string, { shares: EpochShare[]; landed: boolean; begun: boolean }>();
  for (const s of epoch) {
    const key = `${lower(accountOf(s.account))}:${s.stream}:${s.epochId}`;
    let set = sets.get(key);
    if (!set) sets.set(key, (set = { shares: [], landed: false, begun: false }));
    set.shares.push(s);
    set.landed ||= !s.paidBefore && (landedNow.has(shareKey(s)) || Boolean(s.paidNow));
    set.begun ||= s.paidBefore;
  }
  return [...sets.values()]
    .filter((set) => set.landed && !set.begun)
    .flatMap((set) =>
      set.shares.map(({ stream, epochId, tokenId, account, amount, paidNow }) => {
        const share: ToldShare = { stream, epochId, tokenId, account, amount };
        return landedNow.has(shareKey(share)) || paidNow ? share : { ...share, waits: true };
      }),
    );
}

const WEI = 10n ** 18n;
const lower = (a: string) => a.toLowerCase();
const words = (n: number) => `${fmtWord(n)} $WORD`;

/**
 * The payday notes: per account, what its wallets' words earned in the days this run tells of.
 * Keyed on the newest day among them, so a run that also tells of an earlier day (one no run had
 * reached) is still that day's one message. Nothing for an account that earned under one whole $WORD.
 */
export function paydayNotes(shares: readonly ToldShare[], accountOf: (address: string) => string): PlayerNote[] {
  const by = new Map<string, { wallet: string; wei: bigint; day: number; waits: boolean }>();
  for (const s of shares) {
    if (s.stream !== "yield") continue;
    const account = lower(accountOf(s.account));
    const g = by.get(account) ?? { wallet: lower(s.account), wei: 0n, day: 0, waits: false };
    g.wei += s.amount;
    g.day = Math.max(g.day, s.epochId);
    g.waits ||= Boolean(s.waits);
    by.set(account, g);
  }
  return [...by].flatMap(([account, g]) => {
    const whole = Number(g.wei / WEI);
    if (whole < 1) return [];
    const facts: [string, string][] = [["Earned", words(whole)]];
    return [{ account, wallet: g.wallet, note: earningsPaid(words(whole), g.day, g.waits), facts }];
  });
}

/** The bounty notes: per account and week, its words' share, with the week's theme. */
export function bountyNotes(shares: readonly ToldShare[], accountOf: (address: string) => string): PlayerNote[] {
  const by = new Map<string, { account: string; wallet: string; wei: bigint; period: number; waits: boolean }>();
  for (const s of shares) {
    if (s.stream !== "bounty") continue;
    const account = lower(accountOf(s.account));
    const key = `${account}:${s.epochId}`;
    const g = by.get(key) ?? { account, wallet: lower(s.account), wei: 0n, period: s.epochId, waits: false };
    g.wei += s.amount;
    g.waits ||= Boolean(s.waits);
    by.set(key, g);
  }
  return [...by.values()].flatMap((g) => {
    const whole = Number(g.wei / WEI);
    if (whole < 1) return [];
    const theme = THEMES[themeForPeriod(g.period)];
    const facts: [string, string][] = [["Theme", theme.name], ["Your words’ share", words(whole)]];
    return [{ account: g.account, wallet: g.wallet, note: bountyPaid(words(whole), theme.short, g.period, undefined, g.waits), facts }];
  });
}

/**
 * Tell the players of the days and weeks this payout run BEGAN paying. `landed` is the run's own
 * events; `epoch` is every share of the epochs it worked through (`toldShares` says why both).
 * Never throws (notifyPlayers doesn't).
 */
export async function notifyPaid(
  landed: readonly LandedShare[],
  epoch: readonly EpochShare[],
  opts: { log?: (line: string) => void } = {},
): Promise<{ payday: TellResult | null; bounty: TellResult | null }> {
  if (landed.length === 0 && !epoch.some((s) => s.paidNow)) return { payday: null, bounty: null };
  // One after the other: a bounty week and a payday can be for the same player, and each is its own message.
  const payday = await notifyPlayers("payday", (accountOf) => paydayNotes(toldShares(epoch, landed, accountOf), accountOf), opts);
  const bounty = await notifyPlayers("bounty", (accountOf) => bountyNotes(toldShares(epoch, landed, accountOf), accountOf), opts);
  return { payday, bounty };
}
