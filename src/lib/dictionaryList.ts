/**
 * The Dictionary's list (decisions.md #30): which words show, and in what order. Pure, so the
 * screen and the tests agree.
 *
 * - **Closest first** puts the words the player can spell on top, then one letter away, then two,
 *   and so on; within the same distance the rarest word comes first, so "one away" opens on the
 *   Mythic word that needs a single letter. A letter in another of the player's wallets is a move,
 *   which is closer than a mint, so those words sit between "can spell" and "one away". Words that
 *   can't be spelled at all (someone has them) come after, the ones for sale first.
 * - **The quick filters count only unclaimed words:** "Can spell" is exactly Spell's list.
 * - Distances are null when there is nothing to count (no letters, or the owners aren't known):
 *   then the list is A to Z and the distance filters match nothing.
 */
import { WORDS } from "./dictionary";
import { RANKED_WORDS, wordTier, type Tier } from "./economy";
import type { Distance } from "./wordNeed";

/**
 * - `mine`: in the player's bag (its card opens). `mineAway`: theirs, in a linked wallet the bag
 *   doesn't hold. `sale`: someone's, and listed in the Market. `taken`: someone's, not for sale.
 * - `open`: nobody's. `unknown`: the owners aren't known yet.
 */
export type EntryStatus = "mine" | "mineAway" | "sale" | "taken" | "open" | "unknown";
export type DictSort = "closest" | "az";
export type DictFilter = "all" | "can" | "one" | "two" | "unclaimed" | "claimed";

export const DICT_SORTS: readonly DictSort[] = ["closest", "az"];

export interface DictQuery {
  /** what the player typed; matches anywhere in the word */
  query: string;
  tier: Tier | "All";
  filter: DictFilter;
  sort: DictSort;
}

export interface DictList {
  /** every word that matches, in order (the screen shows a page at a time) */
  words: string[];
  /** unclaimed words under the search and the rarity, by distance: the quick filters' counts */
  counts: { can: number; one: number; two: number };
}

/** Higher = rarer. */
const RANK = new Map(RANKED_WORDS.map((r) => [r.word, r.rank]));
const CLAIMED: ReadonlySet<EntryStatus> = new Set<EntryStatus>(["mine", "mineAway", "sale", "taken"]);
const AFTER: Partial<Record<EntryStatus, number>> = { sale: 100, taken: 101, mineAway: 102, mine: 103, unknown: 99 };

/** Where a word sits under "Closest first": lower is closer. A move (away) is closer than a mint. */
export function closeness(status: EntryStatus, d: Distance | undefined): number {
  if (status !== "open" || !d) return AFTER[status] ?? 99;
  return d.missing * 10 + Math.min(d.away, 9);
}

/**
 * `distances` lines up with the dictionary (lib/dictionary WORDS), one per word, or is null when
 * there is nothing to count.
 */
export function listDictionary(q: DictQuery, statusOf: (word: string) => EntryStatus, distances: readonly Distance[] | null): DictList {
  const needle = q.query.trim().toUpperCase();
  const counts = { can: 0, one: 0, two: 0 };
  const rows: { word: string; key: number }[] = [];
  for (let i = 0; i < WORDS.length; i++) {
    const w = WORDS[i];
    if (needle && !w.includes(needle)) continue;
    if (q.tier !== "All" && wordTier(w) !== q.tier) continue;
    const status = statusOf(w);
    const d = distances?.[i];
    const open = status === "open";
    const spellable = open && !!d && d.missing === 0 && d.away === 0;
    if (spellable) counts.can++;
    else if (open && d && d.missing === 1) counts.one++;
    else if (open && d && d.missing === 2) counts.two++;

    if (q.filter === "can" && !spellable) continue;
    if (q.filter === "one" && !(open && d && d.missing === 1)) continue;
    if (q.filter === "two" && !(open && d && d.missing === 2)) continue;
    if (q.filter === "unclaimed" && !open) continue;
    if (q.filter === "claimed" && !CLAIMED.has(status)) continue;
    rows.push({ word: w, key: closeness(status, d) });
  }
  // The dictionary is alphabetical already. Closest first needs distances to mean anything.
  if (q.sort === "closest" && distances) {
    rows.sort((a, b) => a.key - b.key || (RANK.get(b.word) ?? 0) - (RANK.get(a.word) ?? 0) || a.word.localeCompare(b.word));
  }
  return { words: rows.map((r) => r.word), counts };
}
