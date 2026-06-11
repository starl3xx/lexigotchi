/**
 * Canonical Lexigotchi dictionary.
 *
 * Source of truth: `data/guess_words_clean.ts` (LHAW master word list v7.1.0).
 *
 * The vendored file assembles `WORDS` as
 *   [...CORE_COMMON, ...BIG_PLACES, ...COMMON_NAMES, ...MORPHOLOGICAL, ...SLANG_ALLOWLIST]
 *     .filter(w => !BANNED_GUESSES.includes(w))
 *     .sort()
 * which evaluates to exactly 4,438 unique entries — the categories do not actually
 * overlap, so the `.filter().sort()` already yields a duplicate-free list matching the
 * Lexigotchi spec (Appendix A): 4,438 eligible words / 22,190 letter slots.
 *
 * We still pass the list through a `Set` defensively (so a future category edit that
 * introduces an overlap can never silently inflate the claimable set), then assert the
 * 4,438 invariant in tests.
 */
import {
  WORDS as RAW_WORDS,
  BANNED_GUESSES,
  CORE_COMMON,
  BIG_PLACES,
  COMMON_NAMES,
  MORPHOLOGICAL,
  SLANG_ALLOWLIST,
} from "../../data/guess_words_clean";

/** The raw assembled list straight from the vendored file (filtered, sorted, NOT deduped). */
export const RAW_WORD_LIST: readonly string[] = RAW_WORDS;

/**
 * The canonical claimable dictionary: deduplicated, sorted, all 5-letter A–Z.
 * This is the only set that is claimable in Lexigotchi (spec §3 "No open dictionary").
 */
export const WORDS: readonly string[] = Object.freeze(
  [...new Set(RAW_WORDS)].filter((w) => /^[A-Z]{5}$/.test(w)).sort(),
);

export const WORD_COUNT = WORDS.length;

const WORD_SET = new Set(WORDS);

/** Is `word` a claimable dictionary word? (case-insensitive) */
export function isWord(word: string): boolean {
  return WORD_SET.has(word.toUpperCase());
}

/** The 16 banned guesses removed from the canonical set (slurs / inappropriate). */
export const BANNED: readonly string[] = Object.freeze([...BANNED_GUESSES]);

/** Category provenance, exposed for diagnostics / the Lexidex "where did this word come from" UI. */
export const CATEGORIES = Object.freeze({
  CORE_COMMON,
  BIG_PLACES,
  COMMON_NAMES,
  MORPHOLOGICAL,
  SLANG_ALLOWLIST,
});
