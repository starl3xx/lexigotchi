/**
 * What the back of a word's card says (components/cards/CardBack), worked out from the word and its
 * history. Pure, so the server, the card, and the tests agree.
 *
 * Two facts come from the word's onchain history (`/api/words/story`):
 * - **Found by**: the first player ever to claim it. A word dissolved and spelled again keeps its
 *   first finder (starl3xx, 2026-11-25: "backs should keep first finder").
 * - **Yours since**: the day it reached the player's profile. A move between the player's own
 *   wallets keeps the date; staking moves the token to the Staking contract and back, which isn't a
 *   change of hands, so the story leaves those transfers out.
 */
import { TIER_COUNTS, scrabbleValue, type Tier } from "./economy";
import { WORDS, WORD_COUNT } from "./dictionary";
import { tokenIdHexOf } from "./onchain/tokenId";
import { stageName } from "./ascension";

/** How many words there are, for "No. 2,930 of 4,584". */
export const DICTIONARY_SIZE = WORD_COUNT;

const NUMBER_OF = new Map(WORDS.map((w, i) => [w, i + 1]));
/** The word's place in the dictionary, A to Z (1-based), or 0 for a word that isn't in it. */
export function dictionaryNumber(word: string): number {
  return NUMBER_OF.get(word.toUpperCase()) ?? 0;
}

/** How many words share its tier: "one of 46 Mythic words". */
export function tierCount(tier: Tier): number {
  return TIER_COUNTS[tier];
}

/** The word's case in words: lowercase, UPPERCASE, or Mixed with how many are raised. */
export function caseLabel(upper: readonly boolean[]): string {
  const n = upper.filter(Boolean).length;
  if (n === 0) return "lowercase";
  if (n === upper.length) return "UPPERCASE";
  return `Mixed · ${n} of ${upper.length} raised`;
}

/** Its stage on the word ladder: not ascended, Gilded 1–4, or Holographic. */
export function ascensionLabel(level: number): string {
  return level > 0 ? stageName(level) : "Not ascended";
}

/** Its letters' points added up (the numbers in the tiles' corners). */
export function wordPoints(word: string): number {
  return [...word].reduce((a, c) => a + scrabbleValue(c), 0);
}

/** Its onchain id, shortened: 0xabcd…ef01. */
export function shortTokenId(word: string): string {
  const h = tokenIdHexOf(word.toUpperCase());
  return `${h.slice(0, 6)}…${h.slice(-4)}`;
}

/** One change of hands (the story leaves out staking's moves), `at` in unix seconds. */
export interface Custody {
  from: string;
  to: string;
  at: number;
}

/** A claim of the word: who claimed it, and when (unix seconds). */
export interface ClaimRecord {
  owner: string;
  at: number;
}

/** A word's story onchain, as `/api/words/story` serves it: its claims and its changes of hands, oldest first. */
export interface WordStory {
  claims: ClaimRecord[];
  transfers: Custody[];
}

/**
 * When the word reached the player's profile (unix seconds), or null when it isn't theirs. Walks
 * the changes of hands in order: arriving from outside the profile (a claim's mint, a purchase)
 * starts the clock; a move between the profile's own wallets keeps it; leaving (a sale, a dissolve)
 * stops it. `wallets` are the profile's wallets, lowercase.
 */
export function yoursSince(transfers: readonly Custody[], wallets: ReadonlySet<string>): number | null {
  let since: number | null = null;
  let inside = false;
  for (const t of transfers) {
    const now = wallets.has(t.to.toLowerCase());
    if (now && !inside) since = t.at;
    if (!now) since = null;
    inside = now;
  }
  return inside ? since : null;
}

/** Who first found the word: the player, someone else (their address), or not known yet. */
export type FoundBy = { kind: "you" } | { kind: "other"; address: string } | { kind: "unknown" };

/** The first claim's owner, against the profile's wallets (lowercase). No claims read: not known. */
export function foundBy(claims: readonly ClaimRecord[] | undefined, wallets: ReadonlySet<string>): FoundBy {
  const first = claims?.[0];
  if (!first) return { kind: "unknown" };
  const owner = first.owner.toLowerCase();
  return wallets.has(owner) ? { kind: "you" } : { kind: "other", address: owner };
}

/** A day the way the card writes it: 25 Nov 2026 (UTC, so it reads the same everywhere). */
export function cardDate(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}
