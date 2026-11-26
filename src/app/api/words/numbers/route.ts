import { NextResponse } from "next/server";
import { isWord } from "@/lib/dictionary";
import { isSuiteDeployed } from "@/lib/onchain/addresses";
import { cardNumbersOf } from "@/lib/onchain/cardNumbers";

/**
 * Card numbers for a few words: `GET /api/words/numbers?words=CRANE,PLUMB` → `{ numbers: { CRANE: 12 } }`.
 *
 * The front of a word's card letters its number on the ribbon (decisions.md #34), and the front
 * shows on Today, so this is asked for on every visit. `/api/world` carries every word's number,
 * with every owner, letter, and face beside it: far too much to fetch for a handful of numbers.
 * This answers from the same scan (lib/onchain/cardNumbers), with only what was asked for.
 *
 * Public chain data, so no sign-in. A word with no number yet is left out, never guessed. `live`
 * is false where the game isn't deployed (the practice game numbers its own words).
 */
export const dynamic = "force-dynamic";

/** A player's bag is far smaller; this only stops a link from asking for the whole dictionary. */
const MAX_WORDS = 200;

export async function GET(req: Request) {
  const raw = new URL(req.url).searchParams.get("words") ?? "";
  const words = [...new Set(raw.split(",").map((w) => w.trim().toUpperCase()).filter(Boolean))];
  if (words.length === 0 || words.length > MAX_WORDS || !words.every((w) => isWord(w))) {
    return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });
  }
  const live = isSuiteDeployed();
  const numbers = live ? await cardNumbersOf(words) : {};
  // A number is for good, but a just-made word has none for up to a minute: a short cache, shared at the edge.
  return NextResponse.json({ ok: true, live, numbers }, { headers: { "cache-control": "public, max-age=60, s-maxage=60, stale-while-revalidate=300" } });
}
