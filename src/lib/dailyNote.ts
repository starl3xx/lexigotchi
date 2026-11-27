/**
 * The note that today's free letter was claimed, kept per wallet and network in the browser.
 *
 * The chain read that follows a send can lag, so the note counts as "claimed" on its own for a
 * short while (the trust window is its caller's). It also carries WHICH letter, for the tile
 * beside "claimed": the letter the send was made with goes on the note at the send.
 *
 * Since the daily letter comes by mail (decisions.md #49, part 3), saying which letter is the
 * envelope's. That is a DISPLAY rule, not a storage one: the tile is hidden while a sealed
 * one-letter envelope stands in this browser (`dailySealed`), and shows otherwise. So an envelope
 * lost to a reload costs the ceremony only, never the tile: there is no "note with no letter that
 * must find its envelope" to keep true (that rule was tried first, in memory and then stored and
 * then searched for, and took five rounds of fixes: Bugbot on #276).
 *
 * The note may name its envelope (`mail`, the piece's number), so that the tear of THAT envelope
 * writes the letter the chain minted over the one the send was made with. Pure, so each rule is a
 * test.
 */
export interface DailySeen {
  /** The chain day it was claimed on. */
  day: number;
  /** The lowercase letter (0–25) it gave, when this browser knows it. */
  idx: number | null;
  /** When the claim went out (ms), for the trust window. */
  at: number;
  /** The number, in the mail, of the envelope that holds this letter, once the chain has said it. */
  mail?: number;
}

/** What a stored value holds, or null: a bad value is no note, and the chain read still works. */
export function parseDailySeen(raw: string | null | undefined): DailySeen | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<DailySeen> | null;
    if (!v || typeof v.day !== "number" || typeof v.at !== "number") return null;
    const seen: DailySeen = { day: v.day, idx: typeof v.idx === "number" ? v.idx : null, at: v.at };
    if (typeof v.mail === "number" && Number.isInteger(v.mail) && v.mail > 0) seen.mail = v.mail;
    return seen;
  } catch {
    return null;
  }
}

/** The note for `day`, now naming the envelope its letter is in. Any other note is left as it is. */
export function withDailyMail(seen: DailySeen | null, day: number, mail: number): DailySeen | null {
  return seen && seen.day === day ? { ...seen, mail } : seen;
}

/**
 * The note with the letter the chain minted, when envelope `mail` is torn: only the note that
 * names that envelope. It is never stamped again (`at` and `day` stay): tearing yesterday's
 * envelope today must not mark today's letter as claimed.
 */
export function withDailyLetter(seen: DailySeen | null, mail: number, idx: number): DailySeen | null {
  return seen && seen.mail === mail ? { ...seen, idx } : seen;
}

/** The steps at which a piece in hand is a sealed envelope: on its way, or waiting to be torn. */
const SEALED_PHASES: readonly string[] = ["wallet", "paid", "found", "ready"];

/**
 * Is today's letter sealed in an envelope that stands in this browser? Then the tile beside
 * "claimed" is hidden, so the envelope can say the letter. It stands:
 * - in hand, untorn, on its way or waiting to be torn. NOT one stuck on "waiting" or "finishing":
 *   nothing may ever come of it, and the tile would stay hidden for the whole sitting;
 * - kept as mail here, never torn;
 * - as a one-letter commit of this wallet's that the server still has to open (the card shows it).
 * When the note names its envelope (`mail`), only THAT envelope counts, wherever it stands: an
 * older daily letter still unopened, in hand, kept, or stranded as a commit, does not hide today's
 * (Bugbot on #276). While the note names none, any one-letter envelope counts: it can't be told
 * apart.
 */
export function dailySealed(at: {
  hand: { count: number; torn: boolean; phase: string; number: number | null } | null;
  kept: readonly { number: number; letters: readonly number[] }[];
  /** Each with its number in the mail (its commit id plus one). */
  open: readonly { count: number; mine: boolean; number: number }[];
  mail: number | undefined;
}): boolean {
  const named = (number: number | null) => at.mail === undefined || number === null || number === at.mail;
  const { hand } = at;
  if (hand && hand.count === 1 && !hand.torn && SEALED_PHASES.includes(hand.phase) && named(hand.number)) return true;
  if (at.kept.some((k) => k.letters.length === 1 && named(k.number))) return true;
  return at.open.some((c) => c.count === 1 && c.mine && named(c.number));
}
