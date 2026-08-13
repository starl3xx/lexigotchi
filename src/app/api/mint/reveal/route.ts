import { NextResponse } from "next/server";
import { getAuthedFid } from "@/lib/auth/quickAuth";
import { allow } from "@/lib/ratelimit";
import { clientIp } from "@/lib/auth/clientIp";
import { addressOf } from "@/lib/onchain/addresses";
import { lettersRevealDigest } from "@/lib/onchain/digests";
import { signDigest, drawLetters } from "@/lib/onchain/signer";
import { getPublicClient, readLetterSupply } from "@/lib/onchain/reads";
import { lettersAbi } from "@/lib/onchain/abis";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST — draw and sign the outcome of a letter commit.
 *
 * Shared by all four commit paths: the reveal knows nothing about how the commit was funded, only
 * what `commits(commitId)` says. In particular the digest binds `commits[commitId].buyer` — the
 * STORED committer — not the caller, so a reveal can be relayed by anyone (including us) on behalf
 * of the player who paid.
 *
 * The draw is derived from (chainId, commitId) under the server secret, so this endpoint is
 * idempotent by construction: asking twice returns the identical letters. That is load-bearing —
 * the reveal is permissionless and the signer picks the outcome, so a sampler that rolled fresh each
 * call would let a player re-request until they liked their pack.
 *
 * AUTH IS OPTIONAL, deliberately. Those two properties — buyer-bound signature, idempotent draw —
 * mean this endpoint hands out nothing a caller can spend or reroll; the FID was only ever a
 * rate-limit key. Requiring it anyway would strand the verified-wallet daily (Coinbase-attested
 * players have no Farcaster JWT) with the letter already paid for on-chain. Anonymous callers are
 * bucketed by IP instead.
 *
 * Body: `{ commitId: "123" }`
 */
export async function POST(req: Request) {
  const fid = await getAuthedFid(req);
  if (!(await allow("record-add", fid ?? clientIp(req))))
    return NextResponse.json({ ok: false, error: "rate_limited" }, { status: 429 });

  let commitIdRaw: string | undefined;
  try {
    commitIdRaw = (await req.json())?.commitId;
  } catch {
    /* handled below */
  }
  if (!commitIdRaw || !/^\d+$/.test(String(commitIdRaw))) {
    return NextResponse.json({ ok: false, error: "bad_commit_id" }, { status: 400 });
  }
  const commitId = BigInt(commitIdRaw);

  const letters = addressOf("letters");
  const client = getPublicClient();

  // An out-of-range commitId panics (0x32) on the dynamic array before the contract's own BadCommit
  // check can run, so a stale id surfaces as a raw panic rather than a named error. Translate it.
  let commit: { buyer: `0x${string}`; count: number; revealed: boolean };
  try {
    const raw = (await client.readContract({
      address: letters,
      abi: lettersAbi,
      functionName: "commits",
      args: [commitId],
    })) as unknown as readonly [string, number, boolean];
    commit = { buyer: raw[0] as `0x${string}`, count: Number(raw[1]), revealed: Boolean(raw[2]) };
  } catch {
    return NextResponse.json({ ok: false, error: "unknown_commit" }, { status: 404 });
  }

  if (!commit.buyer || commit.buyer === "0x0000000000000000000000000000000000000000") {
    return NextResponse.json({ ok: false, error: "unknown_commit" }, { status: 404 });
  }
  if (commit.revealed) {
    return NextResponse.json({ ok: false, error: "already_revealed" }, { status: 409 });
  }

  // Never draw a capped letter — Letters.reveal reverts CapExceeded and the paid commit is stranded.
  const { available } = await readLetterSupply();
  let letterIndexes: number[];
  try {
    letterIndexes = drawLetters(commitId, commit.count, available);
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: "no_supply", detail: (err as Error).message },
      { status: 503 },
    );
  }

  const inner = lettersRevealDigest({ letters, commitId, buyer: commit.buyer, letterIndexes });
  const signature = await signDigest(inner);

  return NextResponse.json({
    ok: true,
    reveal: {
      commitId: String(commitId),
      buyer: commit.buyer,
      letterIndexes,
      signature,
    },
  });
}
