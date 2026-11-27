import { NextResponse } from "next/server";
import { WORD_COUNT } from "@/lib/dictionary";
import { publicSets, type PublicSet } from "@/lib/sets/rules";
import { hasGate, loadSets, serving } from "@/lib/sets/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** What the game is told about reserved word sets. */
export interface SetsPayload {
  ok: true;
  /** Draft sets as locked slots, revealed and released sets with their names and words. */
  sets: PublicSet[];
  /** How many words the game offers now: the dictionary less every word held back. A count only. Null: can't say right now. */
  released: number | null;
  /** The whole dictionary's size. */
  total: number;
  /** Does this network's Words enforce the first-day limit? (Until it does, a release opens to everyone at once.) */
  gate: boolean;
  /**
   * The words the game holds back right now, A to Z, as ONE UNLABELED LIST: no set, no name, no
   * order of release, nothing that groups them. Null: can't say right now.
   *
   * The owner's choice (2026-11-26, "One unlabeled list"): Spell, the Dictionary, and the Market's
   * picks must leave these words out, so the app has to know them, and which words are held back
   * can't be kept secret anyway (the dictionary is public, and the game answers "not available
   * yet" for any word asked). What stays secret is everything `publicSets` withholds: a draft's
   * name, which words it groups, its headliners, and its dates.
   */
  held: string[] | null;
}

/**
 * GET /api/dictionary/sets: reserved word sets as ANY visitor may see them (decisions.md,
 * "Reserved word sets"). Public, and cached at the edge for ten seconds.
 *
 * Everything about a SET goes through `publicSets` (lib/sets/rules.ts): a draft is a locked slot
 * with nothing in it (no name, no word, no date, no count), a revealed set shows its name and
 * words, and a released set its words and its gate. Beside the sets there are two counts and
 * `held`: the words the game holds back now, as one flat list that says nothing of which set a
 * word is in (see `SetsPayload.held` for why the app is told).
 */
export async function GET() {
  // The chain's side first: asking it is what notices a release that has just landed (it marks the
  // set released and reads the sets again). So the sets shown must be the ones IT read, or one
  // answer could say "still revealed" beside a `held` list that already lets the set's words go.
  const s = await serving().catch(() => null);
  // Without the chain's side the sets are still read for themselves: what a set is doesn't depend
  // on what the chain holds this minute. Can't read them at all: the game shows no sets rather
  // than wrong ones (unknown is never "none").
  const book = s?.ok && s.book.known ? s.book : await loadSets().catch(() => null);
  if (!book?.known) return NextResponse.json({ ok: false, error: "try_again" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  // The count needs the chain's side too (a word is offered only when both agree); without it, no count.
  const body: SetsPayload = {
    ok: true,
    sets: publicSets(book.sets),
    released: s?.ok ? WORD_COUNT - s.held.size : null,
    total: WORD_COUNT,
    gate: hasGate(),
    held: s?.ok ? [...s.held].sort() : null,
  };
  // Kept only a few seconds: the game refuses a word it thinks is held before it ever asks for a
  // proof, so a stale `held` list keeps a just-released set closed in Spell for as long as it is stale.
  return NextResponse.json(body, { headers: { "Cache-Control": "public, s-maxage=10, stale-while-revalidate=10" } });
}
