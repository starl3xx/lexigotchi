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
 *
 * Its number comes from every word's claims (`madeOrder`, served as `/api/world`'s `numbers`): the
 * order words were first made.
 */
import { TIER_COUNTS, scrabbleValue, type Tier } from "./economy";
import { WORD_COUNT } from "./dictionary";
import { tokenIdHexOf } from "./onchain/tokenId";
import { stageName } from "./ascension";
import { dailyEarnEstimate } from "./wordCost";
import { yieldWeight } from "./keeper/shares";

/**
 * The card's number, "#0001": the word's place in the order words were first made, so #0001 is the
 * first word anyone ever spelled (starl3xx, 2026-11-25: "numbered based on their creation… not
 * alphabet or rarity or anything"). Four digits hold every word (WORD_COUNT is under 10,000).
 * Unknown (the world still loading) is a dash, never a guess.
 */
export function cardNumber(n: number | null | undefined): string {
  return n ? `#${String(n).padStart(Math.max(4, String(WORD_COUNT).length), "0")}` : "#–";
}

/**
 * The same number as the card's front letters it on its ribbon: "No. 0001". (Written out, never
 * the "№" sign: the serif's shipped Latin file and a device's fallback serif may lack it.) Null while the number is unknown: the ribbon leaves it out,
 * it never shows a dash or a guess.
 */
export function cardNo(n: number | null | undefined): string | null {
  return n ? `No. ${cardDigits(n)}` : null;
}

/** The number's digits alone, "0001" (the back sets "No." small beside them), or null while unknown. */
export function cardDigits(n: number | null | undefined): string | null {
  return n ? cardNumber(n).slice(1) : null;
}

/** One `Claimed` event: the word, and where it sits in the chain. */
export interface ClaimAt {
  word: string;
  block: bigint;
  index: number;
}

/**
 * Every word's card number, from every `Claimed` event: numbered in the order each word was FIRST
 * claimed (block, then the event's place in it). A word dissolved and spelled again keeps its first
 * number, as it keeps its first finder, so a number never changes once given and no two words share one.
 */
export function madeOrder(claims: readonly ClaimAt[]): Record<string, number> {
  const sorted = [...claims].sort((a, b) => (a.block === b.block ? a.index - b.index : a.block < b.block ? -1 : 1));
  const out: Record<string, number> = {};
  let next = 1;
  for (const c of sorted) {
    const w = c.word.toUpperCase();
    if (!(w in out)) out[w] = next++;
  }
  return out;
}

/**
 * The practice game's numbers: no chain and nobody else, so the player made every word there (its
 * cards say "Found by you"), numbered by when each came to them, the oldest first.
 */
export function practiceNumbers(words: readonly { word: string; since?: number }[]): Record<string, number> {
  const sorted = [...words].sort((a, b) => (a.since ?? 0) - (b.since ?? 0) || a.word.localeCompare(b.word));
  return Object.fromEntries(sorted.map((w, i) => [w.word.toUpperCase(), i + 1]));
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

/** The word's shape for an earnings estimate (an OwnedWord fits). */
export interface EarnShape {
  word: string;
  upper: readonly boolean[];
  staked: boolean;
  daysUnfed: number;
  prestigeLevel: number;
}

/**
 * About what the word earns a day staked and fed (the back's "Earns staked"), from today's pot and
 * the weight of the words sharing it: null for a word not yet UPPERCASE. A staked word is already
 * in that weight (at its current weight, halved if peckish), so it comes out first: estimating it
 * as a newcomer would count it twice (Bugbot on #211).
 */
export function earnsStaked(w: EarnShape, today: { pot: number; weight: number }): number | null {
  const counted = yieldWeight({ word: w.word, staked: w.staked, upperAll: w.upper.every(Boolean), daysUnfed: w.daysUnfed, prestigeLevel: w.prestigeLevel });
  return dailyEarnEstimate(w, { pot: today.pot, weight: Math.max(0, today.weight - counted) });
}
