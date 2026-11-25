/**
 * The word ladder's stages, named in one place (starl3xx, 2026-11-25, decisions.md #19). A staked,
 * all-UPPERCASE word climbs Gilded 1–4, then Holographic, the top stage. Prices and odds live in
 * params.ts (`prestigeStageFeeUsd`, `prestigeSuccessProbability`); this file is the names and the
 * price multiple the contract applies, so the screens, the art, and the docs say the same thing.
 */

/** The top stage: the gold turns into iridescent foil. Equals params `prestige.levels` (a test holds it). */
export const HOLOGRAPHIC_LEVEL = 5;

/** A stage's name: 0 is a plain UPPERCASE word, 1–4 Gilded, 5 Holographic. */
export function stageName(level: number): string {
  if (level <= 0) return "UPPERCASE";
  if (level >= HOLOGRAPHIC_LEVEL) return "Holographic";
  return `Gilded ${Math.round(level)}`;
}

/**
 * How many base fees an attempt from `level` (the word's CURRENT stage) costs: Prestige.sol charges
 * `prestigeFee × (level + 1)`, so Gilded 1 is 1×, Gilded 2 is 2×, … Holographic is 5×.
 */
export function stageFeeMultiple(level: number): number {
  return Math.max(0, Math.floor(level)) + 1;
}
