import { NextResponse } from "next/server";
import { isWord } from "@/lib/dictionary";
import { hasGate, serving } from "@/lib/sets/server";
import { allow } from "@/lib/ratelimit";
import { clientIp } from "@/lib/auth/clientIp";

export const runtime = "nodejs";
// Not cached: the answer depends on the onchain root, which the owner can update after a re-vendor
// or a set's release (a cached "dictionary_mismatch" would block claims long after the fix). Proofs
// are cheap: a tree is built once per root per server start.
export const dynamic = "force-dynamic";

/**
 * GET /api/dictionary/proof?word=CRANE
 *
 * Returns the Merkle proof `Words.claim` verifies against `dictionaryRoot`. The word is echoed back
 * UPPERCASE because that is the only form the contract accepts (Words.sol:108) and the same string
 * that produces tokenId = keccak256(word) — a caller that lowercases it will compute a different
 * token id and get a proof that doesn't verify.
 *
 * The proof comes from the tree behind the root the CHAIN holds (lib/sets/server.ts `serving`):
 * the whole dictionary, or the dictionary less the words held back in reserved sets. A root this
 * server never built means the bundled dictionary and the chain disagree (after a re-vendor, until
 * the owner sends `Words.setDictionaryRoot`): every claim would revert NotInDictionary inside the
 * wallet, so the route says `dictionary_mismatch` instead.
 *
 * A released word still inside its set's first day carries `gate` (when the gate lifts, in
 * seconds): the claim then needs a voucher too.
 *
 * A dictionary word that is held back answers `not_released`, and nothing more: not which set has
 * it, not when it comes. One word a request, and a limit per address, because the answers together
 * are the list of what is held back (which can only be made slow to gather, never secret: the
 * dictionary is public).
 */
export async function GET(req: Request) {
  const word = (new URL(req.url).searchParams.get("word") ?? "").trim();
  if (!/^[A-Za-z]{5}$/.test(word)) {
    return NextResponse.json({ ok: false, error: "bad_word" }, { status: 400 });
  }
  if (!isWord(word)) {
    return NextResponse.json({ ok: false, error: "not_in_dictionary" }, { status: 404 });
  }
  if (!(await allow("proof", clientIp(req)))) {
    return NextResponse.json({ ok: false, error: "rate_limited" }, { status: 429 });
  }

  const s = await serving();
  if (!s.ok) {
    return NextResponse.json({ ok: false, error: s.error }, { status: s.error === "try_again" ? 503 : 409 });
  }
  const W = word.toUpperCase();
  if (s.held.has(W)) {
    return NextResponse.json({ ok: false, error: "not_released" }, { status: 404 });
  }
  const result = s.tree.proofFor(W);
  // In the dictionary, not held back, and still not in the chain's tree: can't happen while
  // `held` covers what the chain leaves out, but a proof that can't verify is never served.
  if (!result) return NextResponse.json({ ok: false, error: "not_released" }, { status: 404 });

  // Inside its set's first day? Then the claim also needs a voucher (POST /api/sets/voucher), and
  // the game is told until when. From the set's stored time, which was read from the chain when
  // the release was marked; the voucher route asks the chain itself before it signs.
  const set = s.book.sets.find((x) => x.status === "released" && x.gateUntil !== null && x.words.some((w) => w.word === W));
  const until = set?.gateUntil ? Math.floor(set.gateUntil.getTime() / 1000) : 0;
  const gate = until * 1000 > Date.now() && (await hasGate()) ? until : null;

  return NextResponse.json({ ok: true, word: result.word, proof: result.proof, root: s.tree.root, ...(gate ? { gate } : {}) });
}
