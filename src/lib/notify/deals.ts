/**
 * The deal alert: "A q is for sale on the Market. It finishes QUICK, a word nobody owns." For a
 * player who turned it ON (decisions.md #47, part 4). The Market shows the same thing to a player
 * who opens it ("For you": lib/market/deals.ts `pickDeals`); this tells one who didn't.
 *
 * It has to be TRUE when it arrives, so it is worked out the way the Market works it out:
 *   - **One wallet's letters.** A claim takes its five letters from one wallet, so a word is "one
 *     letter short" only for a wallet that holds the other four. Each wallet of the account is
 *     tried by itself as the wallet that would claim; their letters are never added up.
 *   - **Never a letter the player already holds** in another of their wallets: that is a move, not
 *     a purchase, and the Market doesn't offer it either.
 *   - **The same word the Market names:** `oneLetterShort` (lib/market/deals.ts) does both of the
 *     above, rarest word first, so the alert and the Market's "For you" never disagree.
 *   - **Only a word nobody owns,** from the keeper's scan of every claimed word.
 *   - **Only a letter that can be bought now, from someone else:** the checked book
 *     (lib/market/letterBoard `readLetterBook`: what each listing can fill at this moment), either
 *     case of the letter (a claim may mix cases), never one of the player's own listings.
 *
 * And it must not nag: one alert a day at most, and the same letter and word once a WEEK at most.
 * Both are marks in `reminder_marks`, so both hold across keeper runs: the player's day
 * (`DEAL_DAILY_SECONDS`) and the deal's rolling week (`DEAL_AGAIN_SECONDS`). The alert is the best
 * deal the player hasn't been told of this week (the rarest word, then the lowest ask), so a deal
 * already told never hides a new one. With no mark table nothing is sent.
 *
 * A mark is taken BEFORE the send (two passes must not both send) and **given back when the alert
 * reached nobody** (`tellDeals`): a player no channel reaches today, a send that failed, choices
 * that couldn't be read. Otherwise an alert that never went out would stand as told for a week
 * (Bugbot on #248). Runs in the keeper's `notify` job, once a day, only for players who opted in.
 */
import { wordTier } from "@/lib/economy";
import { TIER_RANK, lowestOtherAsk, oneLetterShort } from "@/lib/market/deals";
import type { LetterBook } from "@/lib/market/types";
import { ALPHABET } from "@/lib/economy";
import { dealAlert } from "./templates";
import type { PlayerNote } from "./players";
import { fmtWord } from "@/lib/wordAmount";

export interface DealPick {
  /** The wallet that holds the other four letters: the one that can claim the word. */
  wallet: string;
  /** The letter to buy, a to z. */
  letter: string;
  /** The rarest word it finishes for that wallet, and how many more it finishes. */
  word: string;
  more: number;
  /** The lowest ask for the letter from another player, whole $WORD. */
  from: number;
}

/**
 * How long before the same letter and word may be told again. Just under a week: the keeper runs
 * once a day at about the same minute, and a mark a few seconds younger than seven days must not
 * push the next alert to the eighth.
 */
export const DEAL_AGAIN_SECONDS = 6.5 * 86_400;

/**
 * How long after an alert before the same player may get another: under a day, so tomorrow's run
 * (a day later, give or take a minute) alerts, and a second run today does not.
 */
export const DEAL_DAILY_SECONDS = 20 * 3_600;

/**
 * One player's deals, best first: one per letter (the rarest word it finishes; the wallet that can
 * claim it). `wallets` are the account's wallets with their 52 letter counts (0-25 lowercase, 26-51
 * UPPERCASE); `isMine` says a listing is one of the player's own.
 */
export function rankedDeals(
  wallets: readonly { wallet: string; letters: readonly number[] }[],
  unclaimed: readonly string[],
  book: Readonly<Record<number, LetterBook>>,
  isMine: (maker: string) => boolean,
): DealPick[] {
  // Best first: the rarer word, then the lower ask, then a fixed order so two runs agree.
  const byBest = (a: DealPick, b: DealPick) =>
    TIER_RANK[wordTier(b.word)] - TIER_RANK[wordTier(a.word)] || a.from - b.from || a.word.localeCompare(b.word) || a.wallet.localeCompare(b.wallet);
  const bag = (letters: readonly number[]) => ({ lower: letters.slice(0, 26), upper: letters.slice(26, 52) });
  // every wallet of the player, added up: a letter held anywhere is a move, never one to buy
  const all = bag(Array.from({ length: 52 }, (_, i) => wallets.reduce((a, w) => a + (w.letters[i] ?? 0), 0)));
  const byLetter = new Map<string, DealPick>();
  for (const w of wallets) {
    const short = oneLetterShort(bag(w.letters), all, unclaimed);
    for (const [i, words] of short) {
      // either case of the letter finishes the word
      const asks = [lowestOtherAsk(book, i, isMine), lowestOtherAsk(book, i + 26, isMine)].filter((n): n is number => n !== undefined);
      if (asks.length === 0 || words.length === 0) continue;
      const pick: DealPick = { wallet: w.wallet.toLowerCase(), letter: ALPHABET[i].toLowerCase(), word: words[0], more: words.length - 1, from: Math.min(...asks) };
      const had = byLetter.get(pick.letter);
      if (!had || byBest(pick, had) < 0) byLetter.set(pick.letter, pick);
    }
  }
  return [...byLetter.values()].sort(byBest);
}

/** The best deal for one player, or null. */
export function bestDeal(...args: Parameters<typeof rankedDeals>): DealPick | null {
  return rankedDeals(...args)[0] ?? null;
}

/** The deal's throttle mark: this letter and this word. */
export const dealMark = (pick: Pick<DealPick, "letter" | "word">) => `${pick.letter}:${pick.word}`;

/** A deal's message, with the mark that keeps it to once a week. */
export interface DealNote extends PlayerNote {
  mark: string;
}

/** The message for a pick. */
export function dealNote(account: string, pick: DealPick, day: number): DealNote {
  return {
    account: account.toLowerCase(),
    wallet: pick.wallet,
    note: dealAlert(pick, day),
    facts: [["Letter", pick.letter], ["From", `${fmtWord(pick.from)} $WORD`], ["Finishes", pick.word]],
    mark: dealMark(pick),
  };
}

export interface DealDeps {
  /** The accounts that turned the alert on. */
  accounts: readonly string[];
  walletsOf: (account: string) => string[];
  accountOf: (address: string) => string;
  /** Each wallet's 52 letter counts (lib/onchain/reads `readWalletBalances`). */
  lettersOf: (wallets: readonly string[]) => Promise<Record<string, readonly number[]>>;
  /** Every dictionary word nobody owns. */
  unclaimed: readonly string[];
  book: Readonly<Record<number, LetterBook>>;
  /** The two throttles (lib/db/reminderMarks). "unavailable" (no table, a failed write) ends the pass. */
  marks: DealMarks;
}

type MarkClaim = "claimed" | "taken" | "unavailable";

export interface DealMarks {
  /** The player's one alert a day. "taken": alerted in the last `DEAL_DAILY_SECONDS`. */
  claimDay: (account: string) => Promise<MarkClaim>;
  releaseDay: (account: string) => Promise<void>;
  /** This letter and word. "taken": told in the last `DEAL_AGAIN_SECONDS`. */
  claimDeal: (account: string, mark: string) => Promise<MarkClaim>;
  releaseDeal: (account: string, mark: string) => Promise<void>;
}

/**
 * Today's notes: for each opted-in player not alerted today, the best deal they weren't told of
 * this week. Each note's two marks are held when it returns; `tellDeals` gives them back for an
 * alert that reaches nobody. `dry` picks without marking (a keeper dry run must not use up a
 * player's alert).
 */
export async function dealNotes(deps: DealDeps, day: number, opts: { dry?: boolean } = {}): Promise<DealNote[]> {
  const accounts = [...new Set(deps.accounts.map((a) => a.toLowerCase()))];
  if (accounts.length === 0) return [];
  const letters = await deps.lettersOf(accounts.flatMap((a) => deps.walletsOf(a)));
  const notes: DealNote[] = [];
  players: for (const account of accounts) {
    const wallets = deps.walletsOf(account).flatMap((w) => (letters[w.toLowerCase()] ? [{ wallet: w, letters: letters[w.toLowerCase()] }] : []));
    const ranked = rankedDeals(wallets, deps.unclaimed, deps.book, (maker) => deps.accountOf(maker).toLowerCase() === account);
    if (ranked.length === 0) continue;
    if (opts.dry) {
      notes.push(dealNote(account, ranked[0], day));
      continue;
    }
    const today = await deps.marks.claimDay(account);
    // No mark table, or a failed write: an alert that can't be throttled isn't sent. What was
    // marked before this still goes out.
    if (today === "unavailable") break;
    if (today === "taken") continue; // alerted today already, by an earlier run
    // Best first, and the first one not told this week is today's. At most 26 tries: one per letter.
    for (const pick of ranked) {
      const claim = await deps.marks.claimDeal(account, dealMark(pick));
      if (claim === "taken") continue; // told this week already: the next best
      if (claim === "unavailable") {
        await deps.marks.releaseDay(account);
        break players;
      }
      notes.push(dealNote(account, pick, day));
      continue players;
    }
    // every deal was told this week: today is not used up
    await deps.marks.releaseDay(account);
  }
  return notes;
}

/**
 * Pick, tell, and settle the marks: `tell` sends the notes and answers with the accounts a message
 * went out to (on any channel). A note that reached nobody gives both its marks back, so the next
 * run can tell it. Never throws for a failed send.
 */
export async function tellDeals(
  deps: DealDeps & { tell: (notes: readonly DealNote[]) => Promise<ReadonlySet<string>> },
  day: number,
  opts: { dry?: boolean } = {},
): Promise<{ notes: DealNote[]; told: number }> {
  const notes = await dealNotes(deps, day, opts);
  if (opts.dry || notes.length === 0) return { notes, told: 0 };
  let reached: ReadonlySet<string> = new Set();
  try {
    reached = await deps.tell(notes);
  } catch {
    // nobody was reached: every mark goes back below
  }
  for (const n of notes) {
    if (reached.has(n.account)) continue;
    await deps.marks.releaseDeal(n.account, n.mark);
    await deps.marks.releaseDay(n.account);
  }
  return { notes, told: notes.filter((n) => reached.has(n.account)).length };
}
