import { NextResponse } from "next/server";
import { proofFor, dictionaryRoot } from "@/lib/onchain/dictionaryTree";
import { addressOf, isSuiteDeployed } from "@/lib/onchain/addresses";
import { getPublicClient } from "@/lib/onchain/reads";
import { wordsAbi } from "@/lib/onchain/abis";

export const runtime = "nodejs";
// Not cached: the answer depends on the onchain root, which the owner can update after a re-vendor
// (a cached "dictionary_mismatch" would block claims long after the fix). Proofs are cheap: the tree
// is built once per server start.
export const dynamic = "force-dynamic";

/**
 * GET /api/dictionary/proof?word=CRANE
 *
 * Returns the Merkle proof `Words.claim` verifies against `dictionaryRoot`. The word is echoed back
 * UPPERCASE because that is the only form the contract accepts (Words.sol:108) and the same string
 * that produces tokenId = keccak256(word) — a caller that lowercases it will compute a different
 * token id and get a proof that doesn't verify.
 *
 * The proof is built from the BUNDLED dictionary, so it only verifies while the deployed Words
 * contract holds the same root. After a re-vendor (Let's Have A Word's list grows), the onchain root
 * lags until the owner sends `Words.setDictionaryRoot`; during that gap every claim would revert
 * NotInDictionary inside the wallet. So the route compares roots first and says so plainly.
 */
let onchainRoot: { value: string; at: number } | null = null;
async function readOnchainRoot(): Promise<string | null> {
  if (!isSuiteDeployed()) return null;
  if (onchainRoot && Date.now() - onchainRoot.at < 60_000) return onchainRoot.value; // one read a minute
  try {
    const value = (await getPublicClient().readContract({
      address: addressOf("words"),
      abi: wordsAbi,
      functionName: "dictionaryRoot",
    })) as string;
    onchainRoot = { value, at: Date.now() };
    return value;
  } catch {
    return null; // can't tell: serve the proof; the contract still has the final word
  }
}
export async function GET(req: Request) {
  const word = new URL(req.url).searchParams.get("word") ?? "";
  if (!/^[A-Za-z]{5}$/.test(word.trim())) {
    return NextResponse.json({ ok: false, error: "bad_word" }, { status: 400 });
  }

  const result = proofFor(word);
  if (!result) {
    return NextResponse.json({ ok: false, error: "not_in_dictionary" }, { status: 404 });
  }
  const chainRoot = await readOnchainRoot();
  if (chainRoot && chainRoot.toLowerCase() !== dictionaryRoot().toLowerCase()) {
    return NextResponse.json({ ok: false, error: "dictionary_mismatch" }, { status: 409 });
  }

  return NextResponse.json({
    ok: true,
    word: result.word,
    proof: result.proof,
    root: dictionaryRoot(),
  });
}
