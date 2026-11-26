/**
 * The Dictionary's list (decisions.md #31): which words show, and in what order. Pure, so the
 * screen and the tests agree.
 *
 * - **Closest first** puts the words the player can spell on top, then one letter away, then two,
 *   and so on; within the same distance the rarest word comes first, so "one away" opens on the
 *   Mythic word that needs a single letter. A letter in another of the player's wallets is a move,
 *   which is closer than a mint, so those words sit between "can spell" and "one away". Words that
 *   can't be spelled at all (someone has them) come after, the ones for sale first.
 * - **The quick filters count only unclaimed words:** "Can spell" is exactly Spell's list.
 * - **"Only needs a q"** (the `letter` filter) is the Market's link: the words one more of that
 *   letter finishes, by lib/wordNeed's `finishingLetter`, the rule the Market counted them with
 *   (decisions.md #32). So "and 45 more words" in the Market lands on those 46 cards.
 * - Distances are null when there is nothing to count (no letters, or the owners aren't known):
 *   then the list is A to Z and the distance filters match nothing.
 */
import { WORDS } from "./dictionary";
import { RANKED_WORDS, wordTier, type Tier } from "./economy";
import { finishingLetter, type Distance } from "./wordNeed";

/**
 * - `mine`: in the player's bag (its card opens). `mineAway`: theirs, in a linked wallet the bag
 *   doesn't hold. `sale`: someone's, and listed in the Market. `taken`: someone's, not for sale.
 * - `open`: nobody's. `unknown`: the owners aren't known yet.
 */
export type EntryStatus = "mine" | "mineAway" | "sale" | "taken" | "open" | "unknown";
/** What is known about who has the words, when a word's status is worked out. */
export interface WordHolders {
  /** the words in the player's bag */
  owned: ReadonlySet<string>;
  /** each claimed word's owner, from the world read (absent until it answers) */
  owners?: Readonly<Record<string, string>>;
  /** the player's wallets, as the world read writes them */
  wallets: ReadonlySet<string>;
  /** every word on the Market's board, and whether its seller is the player */
  listed: ReadonlyMap<string, boolean>;
  /** the world read has answered: an absent owner means nobody, not "not known yet" */
  ownersKnown: boolean;
}

/**
 * Who has a word. **A word on the Market's board belongs to its seller, whatever the world read
 * says** (decisions.md #32): the board is read live, and a listing shows only while its seller
 * holds the word, while the world is a minute old. So the board is asked first:
 * - a word claimed and listed in the last minute would read as unclaimed, with a price on it in the
 *   Market, and Spell would offer a claim that reverts;
 * - a word that changed hands and was listed again would read as its previous owner's: one the
 *   player just sold, as "theirs, in a linked wallet" (Bugbot on #224);
 * - the practice stall's sellers are in no world read at all.
 * A word of unknown owner is never `open`: nothing is promised until the owners are known.
 */
export function entryStatus(word: string, k: WordHolders): EntryStatus {
  if (k.owned.has(word)) return "mine";
  const sellerIsPlayer = k.listed.get(word);
  if (sellerIsPlayer !== undefined) return sellerIsPlayer ? "mineAway" : "sale";
  const owner = k.owners?.[word];
  if (owner) return k.wallets.has(owner) ? "mineAway" : "taken";
  return k.ownersKnown ? "open" : "unknown";
}

/** Someone has this word, so a claim of it reverts: another player, a seller, or another wallet of the player's. */
export const isTaken = (status: EntryStatus): boolean => status === "taken" || status === "sale" || status === "mineAway";

export type DictSort = "closest" | "az";
export type DictFilter = "all" | "can" | "one" | "two" | "letter" | "unclaimed" | "claimed";

export const DICT_SORTS: readonly DictSort[] = ["closest", "az"];

export interface DictQuery {
  /** what the player typed; matches anywhere in the word */
  query: string;
  tier: Tier | "All";
  filter: DictFilter;
  sort: DictSort;
  /** The letter (0-25) the `letter` filter asks about; counted whenever it is set. */
  letter?: number | null;
}

export interface DictList {
  /** every word that matches, in order (the screen shows a page at a time) */
  words: string[];
  /** unclaimed words under the search and the rarity, by distance: the quick filters' counts (`letter`: the words `q.letter` finishes) */
  counts: { can: number; one: number; two: number; letter: number };
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
  const counts = { can: 0, one: 0, two: 0, letter: 0 };
  const letter = q.letter ?? -1;
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
    // a word this letter finishes is also "one away": it is counted under both
    const finished = open && !!d && letter >= 0 && finishingLetter(d) === letter;
    if (finished) counts.letter++;

    if (q.filter === "can" && !spellable) continue;
    if (q.filter === "one" && !(open && d && d.missing === 1)) continue;
    if (q.filter === "two" && !(open && d && d.missing === 2)) continue;
    if (q.filter === "letter" && !finished) continue;
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
