import { NextResponse } from "next/server";
import { isWord } from "@/lib/dictionary";
import { hasGate, serving } from "@/lib/sets/server";
import { addressOf } from "@/lib/onchain/addresses";
import { wordsAbi } from "@/lib/onchain/abis";
import { getPublicClient } from "@/lib/onchain/reads";
import { tokenIdOf } from "@/lib/onchain/tokenId";
import { allow } from "@/lib/ratelimit";
import { clientIp } from "@/lib/auth/clientIp";

export const runtime = "nodejs";
// Not cached: the answer depends on the onchain root, which the owner can update after a re-vendor
// or a set's release (a cached "dictionary_mismatch" would block claims long after the fix). Proofs
// are cheap: a tree is built once per root per server start.
export const dynamic = "force-dynamic";

/** How long past a gate's end (by this server's clock) the game is still sent to ask for a voucher. */
const GATE_SKEW_SECONDS = 120;

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
 * On a network whose Words charges the claim fee by rarity (decisions.md #60), the answer also
 * carries the leaf's tier (`tier`, 0 Common … 4 Mythic, and `tierName`): the claim must send that
 * number with the proof, which checks it.
 *
 * A word still inside its set's first day carries `gate` (when the gate lifts, in seconds, read
 * from the chain): the claim then needs a voucher too. The game asks the voucher route whenever
 * `gate` is there; that route reads the chain's own time and decides.
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
  // the game is told until when. Asked of the CHAIN, for this word, on a network whose Words has
  // the gate: never of the sets table (which may be unreadable, or behind an owner who lifted a
  // gate early), and a proof is never served for a word whose gate couldn't be read (the plain
  // claim would revert in the wallet).
  let gate: number | null = null;
  if (hasGate()) {
    let until: number;
    try {
      until = Number(await getPublicClient().readContract({ address: addressOf("words"), abi: wordsAbi, functionName: "gatedUntil", args: [tokenIdOf(W)] }));
    } catch {
      return NextResponse.json({ ok: false, error: "try_again" }, { status: 503 });
    }
    // Generous on purpose: this server's clock isn't the chain's, and neither is the player's
    // device's. A gate that ended a moment ago still sends the game to the voucher route, which
    // reads the chain's own time and answers "not gated" (then the plain claim is the claim).
    if ((until + GATE_SKEW_SECONDS) * 1000 > Date.now()) gate = until;
  }

  // On a Words with the claim fee by rarity (decisions.md #60), the leaf's tier: the claim must
  // name it (`tier`, the number Words.claim takes, and `tierName`, the game's name for it). It is
  // the tier the tree was built with, the game's own (collab words included), so the fee the game
  // shows and the fee the contract takes are the same tier's. Absent on an older Words.
  const tier = result.tierIndex !== null && result.tier !== null ? { tier: result.tierIndex, tierName: result.tier } : {};
  return NextResponse.json({ ok: true, word: result.word, proof: result.proof, root: s.tree.root, ...tier, ...(gate ? { gate } : {}) });
}
