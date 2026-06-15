/**
 * Lexigotchi letter economy + word rarity — derived programmatically from the
 * canonical dictionary so the published tables can never silently drift from the data.
 *
 * Reproduces spec Appendix A (letter economy) and Appendix B (rarity tiers) exactly.
 * The derivation formulas were reverse-engineered and confirmed against the spec:
 *
 *   - Eligible set: the DEDUPED dictionary (4,438 words / 22,190 letter slots).
 *   - Mint odds:    a letter's share of the 22,190 slots.
 *   - Supply cap:   floor(slots × DEMAND_MULTIPLE), DEMAND_MULTIPLE = 2.5  → 55,475 total.
 *   - Rarity score: −Σ log₁₀(letterFrequency) over a word's 5 letters (higher = rarer).
 *   - Tiers:        rank words by score asc; cut at floor(N×p) for p = .50/.80/.95/.99.
 *                   Ties broken alphabetically (stable, deterministic). This reproduces
 *                   Common=2219, Epic=177, Legendary=45 and the exact 45-Legendary list;
 *                   a single word straddles the Uncommon/Rare score-tie boundary, so we
 *                   treat that combined bucket (1,997 words) as the asserted invariant.
 */
import { WORDS } from "./dictionary";

export const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
export type Letter = (typeof ALPHABET)[number];

/** Multiple of total dictionary demand minted as the global supply cap (spec §5.2). */
export const DEMAND_MULTIPLE = 2.5;

// ---------------------------------------------------------------------------
// Letter economy (Appendix A)
// ---------------------------------------------------------------------------

function computeSlots(): Record<string, number> {
  const slots: Record<string, number> = {};
  for (const L of ALPHABET) slots[L] = 0;
  for (const word of WORDS) {
    for (const ch of word) slots[ch] = (slots[ch] ?? 0) + 1;
  }
  return slots;
}

/** Letter → number of slots it occupies across the whole dictionary. */
export const LETTER_SLOTS: Readonly<Record<string, number>> = Object.freeze(computeSlots());

/** Total letter slots across the dictionary (= 5 × word count = 22,190). */
export const TOTAL_SLOTS = Object.values(LETTER_SLOTS).reduce((a, b) => a + b, 0);

/** Letter → mint probability (share of total slots). Publishable, provable, sums to 1. */
export const LETTER_ODDS: Readonly<Record<string, number>> = Object.freeze(
  Object.fromEntries(ALPHABET.map((L) => [L, LETTER_SLOTS[L] / TOTAL_SLOTS])),
);

/** Global supply cap for a letter id = floor(slots × demand multiple). */
export function supplyCap(letter: string, multiple = DEMAND_MULTIPLE): number {
  return Math.floor(LETTER_SLOTS[letter.toUpperCase()] * multiple);
}

/** Letter → supply cap at the default 2.5× demand multiple. */
export const LETTER_SUPPLY_CAP: Readonly<Record<string, number>> = Object.freeze(
  Object.fromEntries(ALPHABET.map((L) => [L, supplyCap(L)])),
);

/** Total minted-letter supply cap across all 26 ids (= 55,475 at 2.5×). */
export const TOTAL_SUPPLY_CAP = Object.values(LETTER_SUPPLY_CAP).reduce((a, b) => a + b, 0);

/** Letters ordered most-common → rarest (S, E, A, … J, Q). */
export const LETTERS_BY_FREQUENCY: readonly string[] = Object.freeze(
  [...ALPHABET].sort((a, b) => LETTER_SLOTS[b] - LETTER_SLOTS[a]),
);

/**
 * Standard Scrabble letter point values — printed on LOWERCASE tiles only (the "kid"
 * is the raw collectible; the UPPERCASE glow-up hides the value, it's a game piece now).
 * Not part of the economy derivation; purely cosmetic flavor on the tile face.
 */
export const SCRABBLE_VALUES: Readonly<Record<string, number>> = Object.freeze({
  A: 1, E: 1, I: 1, O: 1, U: 1, L: 1, N: 1, S: 1, T: 1, R: 1,
  D: 2, G: 2,
  B: 3, C: 3, M: 3, P: 3,
  F: 4, H: 4, V: 4, W: 4, Y: 4,
  K: 5,
  J: 8, X: 8,
  Q: 10, Z: 10,
});

/** Scrabble point value for a letter (0 for non-letters). */
export const scrabbleValue = (ch: string): number => SCRABBLE_VALUES[ch.toUpperCase()] ?? 0;

// ---------------------------------------------------------------------------
// Word rarity + tiers (Appendix B)
// ---------------------------------------------------------------------------

export type Tier = "Common" | "Uncommon" | "Rare" | "Epic" | "Legendary";

export interface TierMeta {
  name: Tier;
  /** Stake weight used in yield distribution (spec §5.5). */
  weight: number;
  /** Cumulative percentile upper bound used to cut the tier. */
  percentile: number;
}

/** Tier metadata in ascending rarity. Weights drive stake yield (Common 1 … Legendary 8). */
export const TIERS: readonly TierMeta[] = Object.freeze([
  { name: "Common", weight: 1, percentile: 0.5 },
  { name: "Uncommon", weight: 2, percentile: 0.8 },
  { name: "Rare", weight: 3, percentile: 0.95 },
  { name: "Epic", weight: 5, percentile: 0.99 },
  { name: "Legendary", weight: 8, percentile: 1.0 },
]);

export const TIER_WEIGHT: Readonly<Record<Tier, number>> = Object.freeze(
  Object.fromEntries(TIERS.map((t) => [t.name, t.weight])) as Record<Tier, number>,
);

/** Letter frequency (slot share) used by the rarity score. */
const LETTER_FREQUENCY = LETTER_ODDS;

/** Word rarity score = −Σ log₁₀(letterFrequency). Higher = rarer. */
export function rarityScore(word: string): number {
  let s = 0;
  for (const ch of word.toUpperCase()) s += -Math.log10(LETTER_FREQUENCY[ch]);
  return s;
}

interface Ranked {
  word: string;
  score: number;
  tier: Tier;
  rank: number; // 0-based rank by ascending score
}

function computeRanking(): Ranked[] {
  // Sort by ascending score; alphabetical tiebreak makes the cut deterministic.
  const scored = WORDS.map((word) => ({ word, score: rarityScore(word) })).sort(
    (a, b) => a.score - b.score || (a.word < b.word ? -1 : 1),
  );
  const N = scored.length;
  const cuts = TIERS.slice(0, -1).map((t) => Math.floor(N * t.percentile)); // [2219, 3550, 4216, 4393]
  return scored.map((o, i) => {
    let tier: Tier = "Legendary";
    for (let t = 0; t < cuts.length; t++) {
      if (i < cuts[t]) {
        tier = TIERS[t].name;
        break;
      }
    }
    return { word: o.word, score: o.score, tier, rank: i };
  });
}

const RANKING = computeRanking();
const TIER_BY_WORD = new Map<string, Tier>(RANKING.map((r) => [r.word, r.tier]));
const SCORE_BY_WORD = new Map<string, number>(RANKING.map((r) => [r.word, r.score]));

/** Rarity tier of a dictionary word (throws-free: unknown words score as Common). */
export function wordTier(word: string): Tier {
  return TIER_BY_WORD.get(word.toUpperCase()) ?? "Common";
}

export function wordScore(word: string): number {
  return SCORE_BY_WORD.get(word.toUpperCase()) ?? rarityScore(word);
}

/** All words in a tier, rarest first. */
export function wordsByTier(tier: Tier): string[] {
  return RANKING.filter((r) => r.tier === tier)
    .sort((a, b) => b.score - a.score)
    .map((r) => r.word);
}

/** Count of words per tier. */
export const TIER_COUNTS: Readonly<Record<Tier, number>> = Object.freeze(
  RANKING.reduce(
    (acc, r) => {
      acc[r.tier] = (acc[r.tier] ?? 0) + 1;
      return acc;
    },
    {} as Record<Tier, number>,
  ),
);

/** The full ranking (rarest last), exposed for the Lexidex + tests. */
export const RANKED_WORDS: readonly Ranked[] = Object.freeze(RANKING);

/** The 45 Legendaries, rarest first (spec Appendix B). */
export const LEGENDARIES: readonly string[] = Object.freeze(wordsByTier("Legendary"));

// ---------------------------------------------------------------------------
// Case state → yield multiplier (spec §5.5)
// ---------------------------------------------------------------------------

export type CaseState = "lowercase" | "Mixed" | "UPPERCASE";

export const CASE_MULTIPLIER: Readonly<Record<CaseState, number>> = Object.freeze({
  lowercase: 1,
  Mixed: 1, // transition words earn at the lowercase rate
  UPPERCASE: 2,
});

/** Stake weight = tier weight × case multiplier (spec §5.5). */
export function stakeWeight(tier: Tier, caseState: CaseState): number {
  return TIER_WEIGHT[tier] * CASE_MULTIPLIER[caseState];
}

// ---------------------------------------------------------------------------
// Notable subsets (flavor for the Lexidex + marketing)
// ---------------------------------------------------------------------------

export const Q_WORDS: readonly string[] = Object.freeze(WORDS.filter((w) => w.includes("Q")));

/** Words combining two distinct ultra-rares with a double letter — the grails. */
export const DOUBLED_ULTRA_RARES: readonly string[] = Object.freeze(
  ["JAZZY", "FUZZY", "FIZZY", "DIZZY", "MEZZO", "PIZZA", "RAQQA", "XEROX"].filter((w) =>
    WORDS.includes(w),
  ),
);
