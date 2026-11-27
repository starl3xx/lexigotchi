/**
 * Mail that has arrived and hasn't been torn open yet, kept in this browser (decisions.md #49).
 *
 * The server opens a pack the moment its commit lands, so "revealed" is no longer something the
 * player does. Tearing the envelope is. If the sheet is closed before that (or the page reloads),
 * the letters are already in the bag, and the chain has nothing left to say the envelope is unopened.
 * This list is where that lives: the letters a piece of mail held, and what the bag held before it,
 * so the envelope can still be torn open later and still say what is new.
 *
 * It is CEREMONY ONLY. Nothing may be gated on it: the letters are the chain's, and they are in the
 * bag whether or not this list exists. A storage error, a private window, or another device all
 * read as "no unopened mail", which is true enough: the letters are simply there.
 *
 * Keyed by chain, by the Letters contract (commit numbers start again on a redeploy), and by the
 * wallet the letters were minted to.
 */

export interface UnopenedMail {
  /** The piece's number in the mail: its commit id plus one (the contract counts from zero). */
  number: number;
  /** Each letter's alphabet index, in the order the reveal minted them. */
  letters: number[];
  /** The wallet's loose lowercase letters before this piece arrived, a to z: "new" is measured from here. */
  had: number[];
  /** When it arrived, in ms. */
  at: number;
}

/** No more than this many are kept: the oldest are dropped (their letters are in the bag all the same). */
export const MAILBOX_MAX = 12;

export const mailboxKey = (chainId: number, letters: string, wallet: string): string => `lexi-mail:${chainId}:${letters.toLowerCase()}:${wallet.toLowerCase()}`;

const isLetters = (v: unknown): v is number[] => Array.isArray(v) && v.length >= 1 && v.length <= 5 && v.every((i) => Number.isInteger(i) && i >= 0 && i <= 25);
const isBag = (v: unknown): v is number[] => Array.isArray(v) && v.length === 26 && v.every((n) => Number.isInteger(n) && n >= 0);

/** What a stored value holds, or nothing: anything that isn't a list of well-formed pieces is dropped. */
export function parseMailbox(raw: string | null | undefined): UnopenedMail[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const out: UnopenedMail[] = [];
  const seen = new Set<number>();
  for (const item of parsed) {
    const m = item as Partial<UnopenedMail> | null;
    if (!m || !Number.isInteger(m.number) || (m.number as number) < 1 || !isLetters(m.letters) || !isBag(m.had) || typeof m.at !== "number" || !Number.isFinite(m.at)) continue;
    if (seen.has(m.number as number)) continue;
    seen.add(m.number as number);
    out.push({ number: m.number as number, letters: [...m.letters], had: [...m.had], at: m.at });
  }
  return out.sort((a, b) => a.number - b.number).slice(-MAILBOX_MAX);
}

/** The list with `piece` in it (once: a piece is its number), oldest first, at most MAILBOX_MAX. */
export function withMail(list: readonly UnopenedMail[], piece: UnopenedMail): UnopenedMail[] {
  return [...list.filter((m) => m.number !== piece.number), piece].sort((a, b) => a.number - b.number).slice(-MAILBOX_MAX);
}

/** The list without the piece numbered `number`. */
export function withoutMail(list: readonly UnopenedMail[], number: number): UnopenedMail[] {
  return list.filter((m) => m.number !== number);
}

/** Read a wallet's unopened mail. Never throws: a browser that won't say is a browser with none. */
export function readMailbox(key: string): UnopenedMail[] {
  try {
    return parseMailbox(window.localStorage.getItem(key));
  } catch {
    return [];
  }
}

/** Write it. Never throws: if it can't be kept, the letters are in the bag all the same. */
export function writeMailbox(key: string, list: readonly UnopenedMail[]): void {
  try {
    if (list.length) window.localStorage.setItem(key, JSON.stringify(list));
    else window.localStorage.removeItem(key);
  } catch {
    /* nothing to do */
  }
}
