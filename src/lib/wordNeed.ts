/**
 * What a player still needs to spell a word: the Dictionary's entries ("Needs a q") and its word
 * view ("You only need a q."). Pure, so the list, the sheet, and the tests agree (decisions.md #31).
 *
 * The line is a promise, so the rules are strict:
 * - **Only the connected wallet's letters spell.** `Words.claim` takes letters from the caller, so a
 *   letter in another of the player's wallets is `away` ("move it here"), never held and never
 *   missing. Spell counts the same way (`mineLower` / `mineUpper`).
 * - **Doubles are counted.** BLOOD with one o held needs one more o.
 * - **A held letter takes its UPPERCASE copy first,** as a claim does (`claimCase`), so an entry's
 *   tiles show the word as it would be claimed.
 * Whether the word is still unclaimed is the caller's to know (the world read): this only counts letters.
 */

const idx = (ch: string) => ch.toUpperCase().charCodeAt(0) - 65;

/** A letter of the word: in the connected wallet, in another of the player's wallets, or not held. */
export type LetterState = "here" | "away" | "missing";

/** Loose letters by case, 26 counts each (a = 0). */
export interface LetterBag {
  lower: readonly number[];
  upper: readonly number[];
}

export interface WordNeed {
  /** each letter of the word, in order */
  letters: LetterState[];
  /** the case each `here` letter would be claimed in (false elsewhere) */
  upper: boolean[];
  /** letters held nowhere, lowercase, in word order (a doubled letter appears twice) */
  missing: string[];
  /** letters held only in another of the player's wallets, lowercase, in word order */
  away: string[];
}

/**
 * The word against the player's letters. `here` is the connected wallet; `all` is every wallet of
 * the player (the union bag), so `all − here` is what sits elsewhere. Without `all`, nothing is away.
 */
export function wordNeed(word: string, here: LetterBag, all: LetterBag = here): WordNeed {
  const up = here.upper.slice();
  const low = here.lower.slice();
  // what the player's other wallets hold, in either case
  const else_ = all.lower.map((n, i) => Math.max(0, n + all.upper[i] - here.lower[i] - here.upper[i]));
  const letters: LetterState[] = [];
  const upper: boolean[] = [];
  const missing: string[] = [];
  const away: string[] = [];
  for (const ch of word) {
    const i = idx(ch);
    if (up[i] > 0) {
      up[i]--;
      letters.push("here");
      upper.push(true);
    } else if (low[i] > 0) {
      low[i]--;
      letters.push("here");
      upper.push(false);
    } else if (else_[i] > 0) {
      else_[i]--;
      letters.push("away");
      upper.push(false);
      away.push(ch.toLowerCase());
    } else {
      letters.push("missing");
      upper.push(false);
      missing.push(ch.toLowerCase());
    }
  }
  return { letters, upper, missing, away };
}

/** How far a word is, as two counts: letters held nowhere, and letters in another wallet. */
export interface Distance {
  missing: number;
  away: number;
  /** The last letter found missing (0-25), or -1 when none is: with exactly one missing, THE letter the word needs. */
  letter: number;
}

/** `wordNeed`'s counts alone, for the whole dictionary at once (the sort and the filters). */
export function distanceOf(word: string, hereTotal: readonly number[], elsewhere: readonly number[] | null): Distance {
  const left = hereTotal.slice();
  const other = elsewhere ? elsewhere.slice() : null;
  let missing = 0;
  let away = 0;
  let letter = -1;
  for (let k = 0; k < word.length; k++) {
    const i = word.charCodeAt(k) - 65;
    if (left[i] > 0) left[i]--;
    else if (other && other[i] > 0) {
      other[i]--;
      away++;
    } else {
      missing++;
      letter = i;
    }
  }
  return { missing, away, letter };
}

/**
 * The one letter (0-25) that finishes a word: it is ALL the word still needs, so nothing has to be
 * moved here either. -1 otherwise.
 *
 * "A q finishes QUINT" is a promise (the Market sells the letter on it), so there is one rule, read
 * here by the Market's picks (lib/market/deals `oneLetterShort`), the Dictionary's "Only needs"
 * filter (lib/dictionaryList), and the word view's "would also finish" (`finishedBy`): the number
 * in the Market's sentence is the number of cards its link lands on (decisions.md #32).
 */
export const finishingLetter = (d: Distance): number => (d.missing === 1 && d.away === 0 ? d.letter : -1);

/** Each letter's count in both cases together. */
export const bagTotals = (bag: LetterBag): number[] => bag.lower.map((n, i) => n + bag.upper[i]);

/** What the player's other wallets hold: `all − here`, never below zero. Null when they hold nothing more. */
export function elsewhereTotals(here: LetterBag, all: LetterBag): number[] | null {
  const out = bagTotals(all).map((n, i) => Math.max(0, n - here.lower[i] - here.upper[i]));
  return out.some((n) => n > 0) ? out : null;
}

/** "an h", "a q": the article a letter's NAME takes when said aloud (aitch, eff, ell, em, en, ar, ess, ex). */
export function article(letter: string): "a" | "an" {
  return "aefhilmnorsx".includes(letter.toLowerCase()) ? "an" : "a";
}

/** One distinct letter still needed: how many, and whether the player already has one. */
export interface NeedPart {
  letter: string;
  count: number;
  /**
   * The player already has this letter, here or in another of their wallets, so the word needs MORE
   * of it ("one more o"). One in another wallet still has to be moved, and `needNote` says so.
   */
  more: boolean;
}

export function needParts(need: WordNeed, word: string): NeedPart[] {
  const parts: NeedPart[] = [];
  for (const letter of need.missing) {
    const p = parts.find((x) => x.letter === letter);
    if (p) p.count++;
    else {
      const more = [...word].some((ch, k) => ch.toLowerCase() === letter && need.letters[k] !== "missing");
      parts.push({ letter, count: 1, more });
    }
  }
  return parts;
}

/** A piece of a line: words, or a letter to draw as a small tile. */
export type Token = string | { letter: string };

const one = (p: NeedPart): Token[] =>
  p.count === 1
    ? p.more
      ? ["one more ", { letter: p.letter }]
      : [`${article(p.letter)} `, { letter: p.letter }]
    : [`${p.count} ${p.more ? "more " : ""}`, { letter: p.letter }, "’s"];

/**
 * The line that says where the player stands, as tokens (the screen draws each letter as a tile).
 * `line` is an entry's short status ("Needs a q"); `lead` is the word view's first line
 * ("You only need a q."). Letters are written in lowercase: a mint is always lowercase.
 */
export function needTokens(need: WordNeed, word: string, form: "line" | "lead"): Token[] {
  const parts = needParts(need, word);
  const lead = form === "lead";
  if (parts.length === 0) {
    if (need.away.length === 0) return [lead ? "You have all five letters." : "You can spell it"];
    if (need.away.length === 1) {
      return lead
        ? ["Your ", { letter: need.away[0] }, " is in your other wallet. Move it here."]
        : ["Your ", { letter: need.away[0] }, " is in another wallet"];
    }
    return lead
      ? [`${need.away.length} of its letters are in your other wallet. Move them here.`]
      : [`${need.away.length} letters are in another wallet`];
  }
  if (parts.length === 1) {
    const p = parts[0];
    // "only" promises this letter is all it takes: never when another must be moved here too
    const only = p.count === 1 && !p.more && need.away.length === 0;
    return lead ? [only ? "You only need " : "You need ", ...one(p), "."] : ["Needs ", ...one(p)];
  }
  if (parts.length === 2 && parts.every((p) => p.count === 1)) {
    return lead
      ? ["You need ", ...one(parts[0]), " and ", ...one(parts[1]), "."]
      : ["Needs ", { letter: parts[0].letter }, " and ", { letter: parts[1].letter }];
  }
  const n = need.missing.length;
  return lead ? [`You need ${n} more letters.`] : [`Needs ${n} letters`];
}

/** A line's tokens as plain text (screen readers, tests). */
export const tokensText = (tokens: readonly Token[]): string => tokens.map((t) => (typeof t === "string" ? t : t.letter)).join("");

/** "BURQA", "BURQA and NIQAB", "BURQA, NIQAB, and 3 more": up to two names, then a count. */
export function nameList(words: readonly string[]): string {
  if (words.length === 0) return "";
  if (words.length === 1) return words[0];
  if (words.length === 2) return `${words[0]} and ${words[1]}`;
  return `${words[0]}, ${words[1]}, and ${words.length - 2} more`;
}

/** 1st, 2nd, 3rd, 4th, 11th, 23rd: a word's place among the rarest. */
export function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
}

/** "the u", "the u and the i", "the u, the i, the n, and the t": the letters a player holds, named. */
export function heldList(letters: readonly string[]): string {
  const named = letters.map((l) => `the ${l.toLowerCase()}`);
  if (named.length <= 1) return named.join("");
  if (named.length === 2) return `${named[0]} and ${named[1]}`;
  return `${named.slice(0, -1).join(", ")}, and ${named[named.length - 1]}`;
}

/**
 * The line under the word view's first line: what the player holds, what else the same letter
 * would finish (`also`, the caller's list), and any letter that must be moved here too. Empty when
 * the first line says it all (the word can be spelled, or only a move is needed).
 *
 * The move is always said when there is one: a word that needs a mint AND a move must never read
 * as though the mint were all it takes (Bugbot on #222).
 */
export function needNote(need: WordNeed, word: string, also: readonly string[] = []): string {
  const parts = needParts(need, word);
  if (parts.length === 0) return "";
  const held = [...word].filter((_, k) => need.letters[k] === "here").map((ch) => ch.toLowerCase());
  const moving = need.away.length > 0;
  const out: string[] = [];
  const p = parts[0];
  if (parts.length === 1 && p.count === 1 && !p.more && !moving) {
    // exactly one letter short, and nothing to move: name what's held, and what else it would finish
    out.push(`You hold ${heldList(held)}.`);
    if (also.length) out.push(`${article(p.letter) === "an" ? "An" : "A"} ${p.letter} would also finish ${nameList(also)}.`);
  } else if (held.length === 0) {
    out.push(moving ? "None of its letters are here yet." : "You hold none of its letters yet.");
  } else {
    out.push(`You hold ${held.length} of its five letters${moving ? " here" : ""}.`);
  }
  if (need.away.length === 1) out.push(`Your ${need.away[0]} is in your other wallet: move it here too.`);
  else if (need.away.length > 1) out.push(`${need.away.length} more are in your other wallet: move them here too.`);
  return out.join(" ");
}

/**
 * The words one more `letter` would finish: each needs that letter, once, and nothing else
 * (`finishingLetter`, so a letter waiting in another of the player's wallets finishes nothing: it
 * is a move). `skip` leaves out words that can't be spelled anyway (claimed ones, and the word
 * being looked at). Dictionary order; the caller sorts.
 */
export function finishedBy(letter: string, words: readonly string[], here: LetterBag, skip: (word: string) => boolean, all: LetterBag = here): string[] {
  const L = letter.toUpperCase();
  const want = idx(letter);
  const hereTotal = bagTotals(here);
  const elsewhere = elsewhereTotals(here, all);
  const out: string[] = [];
  for (const w of words) {
    if (!w.includes(L) || skip(w)) continue;
    if (finishingLetter(distanceOf(w, hereTotal, elsewhere)) === want) out.push(w);
  }
  return out;
}

/**
 * The Market's line for a letter that is all a word still needs: "A q finishes QUINT", or "One
 * more o finishes BLOOD" when the player already holds one (`more`). The Dictionary says "Needs a
 * q" and "Needs one more o" of the same words. `letter` is written as given, so an UPPERCASE
 * letter for sale reads in its case.
 */
export function finishTokens(letter: string, more: boolean, word: string): Token[] {
  return [more ? "One more " : article(letter) === "an" ? "An " : "A ", { letter }, ` finishes ${word}`];
}
