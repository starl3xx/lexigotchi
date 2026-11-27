/**
 * A word's rarity AS THE GAME TREATS IT: the tier derived from the full dictionary, with one layer
 * on top (decisions.md, "Collab sets", item 2).
 *
 * Rarity is derived from the full dictionary and never moves (lib/economy.ts `wordTier`): letter
 * supply, mint odds, and token ids all stand on that. The one exception is a COLLAB word. From the
 * moment its set is revealed, a word of a collab set is Legendary everywhere a rarity is shown or
 * counted: what a card says, what a word earns, its share of the bounty, filters, the sort order,
 * and what a marketplace is told. A word whose own tier is higher keeps it.
 *
 * So there are two questions, and this file keeps them apart by name:
 *  - `wordTier(word)` (economy.ts): the DERIVED tier. Still what supply, odds, and the simulator
 *    use, and still available to anything that needs to know what a word "really" is.
 *  - `tierWith(word, collab)`: the tier the game treats it as. Everything a player reads, and
 *    everything that pays, asks this.
 *
 * The collab words are passed in, always. Nothing here reads a database or keeps a copy: the
 * server reads them from the sets (lib/sets/server.ts `collabNow`) and the game from the sets
 * answer (components/game/useSets.ts), and a caller that pays (the keeper) must refuse when they
 * can't be read. tests/rarity-override.test.ts holds every other caller of `wordTier` to a list.
 *
 * Tier COUNTS come from the same rule (`tierCountsWith`), so "one of N Legendary words" stays true
 * when a collab word joins that tier.
 */
import { TIERS, TIER_COUNTS, wordScore, wordTier, type Tier } from "./economy";

/** The words of every REVEALED or RELEASED collab set, UPPERCASE. A draft's words are never in it. */
export type CollabWords = ReadonlySet<string>;

/** No collab words: the derived tiers, as they were before collab sets existed. */
export const NO_COLLAB: CollabWords = new Set<string>();

/** The tier a collab word is raised to. */
export const COLLAB_TIER: Tier = "Legendary";

const RANK = Object.fromEntries(TIERS.map((t, i) => [t.name, i])) as Record<Tier, number>;

/** Is this word raised by the collab layer (in a collab set, and below Legendary by itself)? */
export function raisedByCollab(word: string, collab: CollabWords): boolean {
  return collab.size > 0 && collab.has(word.toUpperCase()) && RANK[wordTier(word)] < RANK[COLLAB_TIER];
}

/** The tier the game treats `word` as: Legendary for a collab word, unless its own tier is higher. */
export function tierWith(word: string, collab: CollabWords): Tier {
  return raisedByCollab(word, collab) ? COLLAB_TIER : wordTier(word);
}

/** A function of one word, for a caller that maps many. */
export function tierFn(collab: CollabWords): (word: string) => Tier {
  return collab.size === 0 ? wordTier : (word) => tierWith(word, collab);
}

/**
 * "Rarest first" by the rarity SCORE (Spell's order), with the game's tier on top: a collab word
 * sorts with the Legendary words it is treated as, and within a tier the order is the score's, then
 * A to Z. With the derived tiers this is the score order itself, exactly as it was.
 */
export function rarestByScore(tierOf: (word: string) => Tier): (a: string, b: string) => number {
  const byScore = (a: string, b: string) => wordScore(b) - wordScore(a) || a.localeCompare(b);
  return tierOf === wordTier ? byScore : (a, b) => RANK[tierOf(b)] - RANK[tierOf(a)] || byScore(a, b);
}

/** How many words are in each tier, by the same rule: a raised word counts in Legendary, not in its own tier. */
export function tierCountsWith(collab: CollabWords): Record<Tier, number> {
  const counts = { ...TIER_COUNTS } as Record<Tier, number>;
  for (const word of collab) {
    if (!raisedByCollab(word, collab)) continue;
    counts[wordTier(word)] -= 1;
    counts[COLLAB_TIER] += 1;
  }
  return counts;
}

/**
 * The collab words in a list of sets. Works on the server's sets (`type`, `status`) and on what the
 * game is told (`collab`, `kind`), so both sides apply one rule: a set counts from its REVEAL, and
 * a draft never does.
 */
export function collabWordsOf(
  sets: readonly (
    | { type: "standard" | "collab"; status: "draft" | "revealed" | "released"; words: readonly { word: string }[] }
    | { kind: "locked" }
    | { kind: "revealed" | "released"; collab?: object | null; words: readonly { word: string }[] }
  )[],
): CollabWords {
  const out = new Set<string>();
  for (const s of sets) {
    if ("kind" in s) {
      if (s.kind === "locked" || !s.collab) continue;
    } else if (s.type !== "collab" || s.status === "draft") continue;
    for (const w of s.words) out.add(w.word.toUpperCase());
  }
  return out.size === 0 ? NO_COLLAB : out;
}
