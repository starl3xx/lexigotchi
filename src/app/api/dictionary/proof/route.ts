import { NextResponse } from "next/server";
import { proofFor, dictionaryRoot } from "@/lib/onchain/dictionaryTree";

export const runtime = "nodejs";
// The dictionary is immutable for the life of a deployment, so proofs are safe to cache hard.
export const revalidate = 3600;

/**
 * GET /api/dictionary/proof?word=CRANE
 *
 * Returns the Merkle proof `Words.claim` verifies against `dictionaryRoot`. The word is echoed back
 * UPPERCASE because that is the only form the contract accepts (Words.sol:108) and the same string
 * that produces tokenId = keccak256(word) — a caller that lowercases it will compute a different
 * token id and get a proof that doesn't verify.
 */
export async function GET(req: Request) {
  const word = new URL(req.url).searchParams.get("word") ?? "";
  if (!/^[A-Za-z]{5}$/.test(word.trim())) {
    return NextResponse.json({ ok: false, error: "bad_word" }, { status: 400 });
  }

  const result = proofFor(word);
  if (!result) {
    return NextResponse.json({ ok: false, error: "not_in_dictionary" }, { status: 404 });
  }

  return NextResponse.json({
    ok: true,
    word: result.word,
    proof: result.proof,
    root: dictionaryRoot(),
  });
}
