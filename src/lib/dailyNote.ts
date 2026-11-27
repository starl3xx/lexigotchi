/**
 * The note that today's free letter was claimed, kept per wallet and network in the browser.
 *
 * The chain read that follows a send can lag, so the note counts as "claimed" on its own for a
 * short while (the trust window is its caller's). It also carries WHICH letter, for the tile
 * beside "claimed", and since the daily letter comes by mail (decisions.md #49, part 3) that is
 * the envelope's to say: the letter goes on the note only when its envelope is torn.
 *
 * So the note names its envelope (`mail`, the piece's number). Kept in the note, not in memory:
 * a daily envelope can wait through a reload, and tearing it later must still show the letter
 * (Bugbot on #276). Pure, so each rule is a test.
 */
export interface DailySeen {
  /** The chain day it was claimed on. */
  day: number;
  /** The lowercase letter (0–25) it gave: null until its envelope is torn. */
  idx: number | null;
  /** When the claim went out (ms), for the trust window. */
  at: number;
  /** The number, in the mail, of the envelope that holds this letter, once the chain has said it. */
  mail?: number;
}

/** The chain day of a block time (seconds): the day the contract counts a daily under. */
export const dayOf = (timestamp: number | bigint): number => Math.floor(Number(timestamp) / 86_400);

/**
 * Does today's note still wait for its letter? Then its envelope has not been torn, and it must
 * be somewhere: in hand, kept as mail, an open commit, or (after a reload mid-flight, or a send
 * that landed with nobody watching) nowhere this browser knows, and it has to be found again.
 */
export function awaitsLetter(seen: DailySeen | null, today: number): seen is DailySeen {
  return !!seen && seen.day === today && seen.idx === null;
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
 * The note with its letter on, when envelope `mail` is torn: only the note that names that
 * envelope. It is never stamped again (`at` and `day` stay): tearing yesterday's envelope today
 * must not mark today's letter as claimed.
 */
export function withDailyLetter(seen: DailySeen | null, mail: number, idx: number): DailySeen | null {
  return seen && seen.mail === mail ? { ...seen, idx } : seen;
}
