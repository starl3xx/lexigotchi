/**
 * The mail's rules (decisions.md #49): what a piece of mail is, the order its letters come out in,
 * what each one is to the player, and what the sheet says at each step. Pure, so they are tested
 * (tests/mail-flow.test.ts) apart from a chain, a wallet, and a screen.
 *
 * The one promise: each thing the envelope shows is tied to a state of the purchase, and nothing is
 * shown before it is true. The stamp means the price is spent. The postmark means the commit is on
 * chain and has its number. The envelope can be torn only once the letters exist.
 */
import { LETTERS_BY_FREQUENCY } from "@/lib/economy";
import { article, distanceOf, finishingLetter } from "@/lib/wordNeed";

export type MailPhase =
  /** The wallet is open on the one confirmation. Nothing is sent, and nothing is promised. */
  | "wallet"
  /** The commit is sent: the price is spent from here on. The stamp goes on. */
  | "paid"
  /** The commit is on chain and has its number. The postmark lands, and somebody is inside. */
  | "found"
  /** The reveal is on chain: the letters exist. Only now can the envelope be torn. */
  | "ready"
  /** Paid, and nothing more can be done for it now. It waits, and can be opened later. */
  | "waiting"
  /** The reveal is broadcast and wasn't seen to land. The chain finishes it. */
  | "finishing";

/** One piece of mail, from the tap to the count. */
export interface Mail {
  /** Grows by one a piece: the sheet keys its stage on it, so a new purchase is a new envelope. */
  seq: number;
  count: 1 | 5;
  /** The free pack: nothing was paid for it. */
  free: boolean;
  phase: MailPhase;
  /** Its number in the mail (the commit id plus one), once the commit is on chain. */
  number: number | null;
  /** Its letters' alphabet indexes, once they exist. */
  letters: number[] | null;
  /** The wallet's loose lowercase letters before this piece, a to z: "new" is measured from here. */
  had: number[];
  /**
   * False when the letters were minted to another wallet of the player's (a pack rescued for a
   * linked wallet): they are "away", so nothing here may say "now you can spell".
   */
  mine: boolean;
  /** The player has torn the envelope open: it is no longer unopened mail. */
  torn: boolean;
  /** For `waiting` and `finishing`: what to say. */
  note?: string;
}

/**
 * The practice game has no chain to wait for. Its envelope still takes its marks in order, a beat
 * each, from the tap: the postmark, then the letters.
 */
export const PRACTICE_MAIL_MS = { found: 650, ready: 1500 } as const;

/** A piece's number in the mail: packs, free packs, and daily letters in one series, from 1. */
export const mailNumber = (commitId: bigint): number => Number(commitId) + 1;

/** "No. 4,512" */
export const mailNumberText = (n: number): string => `No. ${n.toLocaleString("en-US")}`;

/** The six rarest letters: the ones the Mint list and the letters themselves already mark. */
const RARE = new Set(LETTERS_BY_FREQUENCY.slice(-6).map((ch) => ch.toUpperCase().charCodeAt(0) - 65));
/** How rare a letter is among the 26: 0 for the commonest, 25 for the rarest. */
const rarity = (idx: number): number => LETTERS_BY_FREQUENCY.findIndex((ch) => ch.toUpperCase().charCodeAt(0) - 65 === idx);
/** Is this THE rarest letter in the game? */
export const isRarest = (idx: number): boolean => rarity(idx) === 25;

/** One letter out of a piece of mail, and what it is to the player. */
export interface Pull {
  /** alphabet index, 0 = a */
  idx: number;
  /** one of the six rarest letters */
  rare: boolean;
  /** the player held no loose lowercase copy of it before */
  isNew: boolean;
  /** the word this letter finishes, for a player who held the rest */
  finishes: string | null;
  /** the one worth waiting for: it comes last, slowly, and can't look */
  best: boolean;
}

/**
 * The letter that finished each newly spellable word, for the tag under it: letter → the first word
 * in `newWords` (their order is the caller's, rarest first) that the bag was exactly that one letter
 * short of before. The one rule for "this letter finishes this word" is lib/wordNeed
 * `finishingLetter`; a word that needed two of the pack's letters is finished by neither alone.
 */
export function finishers(newWords: readonly string[], beforeTotals: readonly number[]): Map<number, string> {
  const out = new Map<number, string>();
  for (const word of newWords) {
    const letter = finishingLetter(distanceOf(word, beforeTotals, null));
    if (letter >= 0 && !out.has(letter)) out.set(letter, word);
  }
  return out;
}

/**
 * The letters in the order they come out: the plain ones first, then one that finishes a word, then
 * a rare one, the rarest last. Letters of equal standing keep the order the chain minted them in.
 * A second copy of a letter in the same piece is never "new" and finishes nothing: the first did.
 */
export function revealOrder(letters: readonly number[], had: readonly number[], finishing: ReadonlyMap<number, string> = new Map()): Pull[] {
  const seen = new Set<number>();
  const pulls = letters.map((idx, at) => {
    const first = !seen.has(idx);
    seen.add(idx);
    const rare = RARE.has(idx);
    const finishes = first ? (finishing.get(idx) ?? null) : null;
    const weight = rare ? 2 + rarity(idx) / 100 : finishes ? 1 : 0;
    return { pull: { idx, rare, isNew: first && (had[idx] ?? 0) === 0, finishes, best: false }, weight, at };
  });
  pulls.sort((a, b) => a.weight - b.weight || a.at - b.at);
  const last = pulls[pulls.length - 1];
  // A piece with nothing rare and nothing finished has no "best": all its letters come out alike.
  if (last && last.weight > 0) last.pull.best = true;
  return pulls.map((p) => p.pull);
}

/** The small tag under a letter once the mail is counted, or none. */
export function tagOf(p: Pull): { text: string; kind: "word" | "rare" | "new" } | null {
  if (p.finishes) return { text: p.finishes, kind: "word" };
  if (p.rare) return { text: isRarest(p.idx) ? "rarest" : "rare", kind: "rare" };
  if (p.isNew) return { text: "new", kind: "new" };
  return null;
}

const ch = (idx: number): string => String.fromCharCode(97 + idx);
const an = (idx: number): string => (article(ch(idx)) === "an" ? "An" : "A");

/** What is said as the best letter leaves the envelope. A letter is written in its case: lowercase. */
export function bestLine(p: Pull): string {
  if (p.rare) return isRarest(p.idx) ? `${an(p.idx)} ${ch(p.idx)}! The rarest letter in the game.` : `${an(p.idx)} ${ch(p.idx)}! One of the rarest letters.`;
  if (p.finishes) return `${an(p.idx)} ${ch(p.idx)}: that finishes ${p.finishes}.`;
  return "";
}

/**
 * The line under the envelope. It says where the mail is, in the chain's own order, and never more
 * than is true: "Paid" only once the commit is sent, a number only once it is on chain.
 */
export function mailStatus(m: Pick<Mail, "phase" | "count" | "free" | "number" | "note">): string {
  const one = m.count === 1;
  switch (m.phase) {
    case "wallet":
      return "Confirm in your wallet.";
    case "paid":
      return m.free ? "It’s in the mail." : "Paid. It’s in the mail.";
    case "found":
      return `${m.number ? mailNumberText(m.number) : "It"} is yours. Minting your ${one ? "letter" : "letters"}…`;
    case "ready":
      return one ? "It’s here. Tear along the top." : "They’re here. Tear along the top.";
    case "waiting":
      return m.note ?? (m.free ? "Your pack is yours and safe onchain. It’ll be waiting for you on Today." : "Your pack is paid for and safe onchain. It’ll be waiting for you on Today.");
    case "finishing":
      return m.note ?? "Your pack is finishing onchain. It’ll show in a moment.";
  }
}

/** The headline once the mail is counted. */
export function countHead(pulls: readonly Pull[]): string {
  const best = pulls.find((p) => p.best && p.rare);
  if (best) return `${an(best.idx)} ${ch(best.idx)} came out.`;
  if (pulls.length === 1) return `It’s ${article(ch(pulls[0].idx))} ${ch(pulls[0].idx)}.`;
  return `${["", "One", "Two", "Three", "Four", "Five"][pulls.length] ?? pulls.length} lowercase letters.`;
}

/**
 * The line under the headline. `odds` is the best letter's chance in one pull and `packs` how many
 * packs hold one on average, both from the Mint's own numbers (lib/letterOdds); without them
 * nothing is claimed about how rare it is.
 */
export function countSub(pulls: readonly Pull[], rarity?: { odds: string; packs: number } | null): string {
  const best = pulls.find((p) => p.best && p.rare);
  if (best) {
    const what = isRarest(best.idx) ? "The rarest letter" : "One of the rarest letters";
    return rarity && Number.isFinite(rarity.packs) ? `${what}: ${rarity.odds} of pulls, about one pack in ${Math.max(2, Math.round(rarity.packs))}.` : `${what} in the game.`;
  }
  const fresh = pulls.find((p) => p.isNew && !p.finishes);
  const where = pulls.length === 1 ? "It’s in your bag." : "All in your bag.";
  return fresh ? `${where} The ${ch(fresh.idx)} is your first.` : where;
}

/**
 * How many pieces of mail a player tears open in one sitting before the short version plays: the
 * plain letters then come out together, and the best one still comes out alone. A tap on the
 * letters hurries any version.
 */
export const QUICK_AFTER = 3;

/** Envelopes torn open since the page loaded: a sitting. */
let tornThisSitting = 0;
/** Count one envelope torn, and say whether it plays the short version. */
export function nextTearIsQuick(): boolean {
  return tornThisSitting++ >= QUICK_AFTER;
}
/** A new sitting (tests). */
export function resetSitting(): void {
  tornThisSitting = 0;
}

/**
 * The bag as the chain has it once a piece is revealed: what the bag held before, plus the piece's
 * letters. The game's own read of the bag lags a reveal by seconds, and an envelope is usually
 * torn inside them, so the order letters come out in and their tags are worked out from this. It
 * never lowers a count the bag already shows. (The count's claim still waits for the bag itself.)
 */
export function bagWithMail(lower: readonly number[], had: readonly number[], letters: readonly number[]): number[] {
  const due = had.slice(0, 26);
  for (const i of letters) due[i] = (due[i] ?? 0) + 1;
  return Array.from({ length: 26 }, (_, i) => Math.max(lower[i] ?? 0, due[i] ?? 0));
}

/**
 * What the bag held before a new piece, when the read of the bag may still be behind the LAST
 * piece ("Rip another" comes seconds after a reveal): never less than what that piece left in it.
 * `owed` is the last piece's `bagWithMail`, kept only until the bag is seen to have caught up.
 * Erring high is safe: a letter counted that was since spent names nothing as new.
 */
export function hadWithOwed(lower: readonly number[], owed: readonly number[] | null): number[] {
  return Array.from({ length: 26 }, (_, i) => Math.max(lower[i] ?? 0, owed?.[i] ?? 0));
}
/** Has the bag caught up with what a revealed piece left in it? */
export const caughtUp = (lower: readonly number[], owed: readonly number[]): boolean => owed.every((n, i) => (lower[i] ?? 0) >= n);

/** When each letter peeks and comes out, in ms from the tear, and when the count shows. */
export interface Beat {
  /** which pull (an index into `revealOrder`'s list) */
  at: number;
  /** the envelope shakes: the best letter is coming */
  shake?: number;
  /** eyes over the torn edge (absent in the short version for a plain letter) */
  peek?: number;
  out: number;
}

export function revealBeats(pulls: readonly Pull[], quick: boolean): { beats: Beat[]; done: number } {
  let t = 260;
  const beats: Beat[] = [];
  pulls.forEach((p, at) => {
    const big = p.best || !!p.finishes;
    if (quick && !big) {
      beats.push({ at, out: t });
      t += 120;
      return;
    }
    const beat: Beat = { at, out: 0 };
    if (p.best && p.rare) {
      beat.shake = t;
      t += 560;
    }
    beat.peek = t;
    t += p.best && p.rare ? 1150 : big ? 720 : 360;
    beat.out = t;
    t += p.best && p.rare ? 1000 : big ? 700 : 400;
    beats.push(beat);
  });
  return { beats, done: t + 350 };
}
