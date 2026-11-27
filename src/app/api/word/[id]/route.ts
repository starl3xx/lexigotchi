/**
 * GET /api/word/{tokenId}: a word's token metadata, the JSON `Words.tokenURI` points to once the
 * owner sets the base URI to `<site>/api/word/` (lib/wordMetadata.ts; decisions.md, "Collab sets").
 *
 * - The id is the word's own (keccak256 of the word), so an id that is no dictionary word is 404.
 * - A word nobody holds is 404 too: `tokenURI` reverts for it on the chain, and there is no card.
 * - The chain's state decides the name, the picture, and the case and ascension traits. When the
 *   chain can't be read the answer is 503, never a guess a marketplace would keep.
 * - "Set" and "Collab" follow what any visitor may see: a draft set adds nothing here. If the sets
 *   can't be read the answer is 503 too. A marketplace keeps the first 200 it gets, whatever the
 *   cache header says, and a collab word served with its derived rarity and no Collab trait would
 *   stay that way there; an indexer asks again after a 503.
 * - The card's number is WAITED for (`cardNumberOf`), for the same reason: a first answer without
 *   it would be the one that is kept.
 *
 * (`/api/word` itself, with no id, is the $WORD token's numbers: another thing entirely.)
 */
import { NextResponse } from "next/server";
import { addressOf, isSuiteDeployed } from "@/lib/onchain/addresses";
import { wordsAbi } from "@/lib/onchain/abis";
import { getPublicClient } from "@/lib/onchain/reads";
import { cardNumberOf } from "@/lib/onchain/cardNumbers";
import { wordOfTokenId } from "@/lib/market/sales";
import { tierWith, collabWordsOf, NO_COLLAB } from "@/lib/rarity";
import { SITE_URL } from "@/lib/site";
import { parseTokenId, wordMetadata } from "@/lib/wordMetadata";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const OPEN = { "Access-Control-Allow-Origin": "*" };
const no = (error: string, status: number) => NextResponse.json({ error }, { status, headers: { ...OPEN, "Cache-Control": status === 503 ? "no-store" : "public, s-maxage=60" } });

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const id = parseTokenId((await ctx.params).id);
  const word = id === null ? null : wordOfTokenId(id);
  if (id === null || !word) return no("not_a_word", 404);
  if (!isSuiteDeployed()) return no("not_minted", 404);

  const words = addressOf("words");
  let held: boolean;
  let level: number;
  let upper: boolean[];
  try {
    const client = getPublicClient();
    // Two reads at once: the word's own state, and each letter's case (two shapes of answer).
    const [state, letters] = await Promise.all([
      client.multicall({
        allowFailure: false,
        contracts: [
          { address: words, abi: wordsAbi, functionName: "exists", args: [id] },
          { address: words, abi: wordsAbi, functionName: "prestigeLevel", args: [id] },
        ],
      }),
      client.multicall({
        // A word nobody holds has no escrow: its letters' reads may fail, and it is a 404 below.
        allowFailure: true,
        contracts: Array.from({ length: word.length }, (_, pos) => ({ address: words, abi: wordsAbi, functionName: "escrowLetter" as const, args: [id, pos] as const })),
      }),
    ]);
    held = Boolean(state[0]);
    level = Number(state[1]);
    if (held && !letters.every((l) => l.status === "success")) return no("try_again", 503);
    upper = letters.map((l) => (l.status === "success" ? Boolean((l.result as unknown as readonly [number, boolean])[1]) : false));
  } catch {
    return no("try_again", 503);
  }
  if (!held) return no("not_minted", 404);

  // What the sets say of it, as any visitor may be told. Unreadable: 503, never a rarity and
  // traits a marketplace would keep wrong. (No database configured: there are no sets, which
  // `loadSets` answers as known.)
  let setName: string | null = null;
  let collabPartner: string | null = null;
  let collab = NO_COLLAB;
  try {
    const { loadSets } = await import("@/lib/sets/server");
    const book = await loadSets();
    if (!book.known) return no("try_again", 503);
    collab = collabWordsOf(book.sets);
    const mine = book.sets.find((s) => s.status !== "draft" && s.words.some((w) => w.word === word));
    if (mine?.status === "released") setName = mine.name;
    if (mine?.type === "collab") collabPartner = mine.partnerName;
  } catch {
    return no("try_again", 503);
  }

  const number = await cardNumberOf(word).catch(() => null);
  const body = wordMetadata({ word, upper, level, number, tier: tierWith(word, collab), setName, collabPartner }, SITE_URL);
  // A minute: the word's case and stage can change with any transaction, and the picture's
  // address inside changes with them.
  return NextResponse.json(body, { headers: { ...OPEN, "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" } });
}
