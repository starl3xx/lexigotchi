import { NextResponse } from "next/server";
import { getAuthedFid } from "@/lib/auth/quickAuth";
import { allow } from "@/lib/ratelimit";
import { addressOf } from "@/lib/onchain/addresses";
import { rollsRevealDigest } from "@/lib/onchain/digests";
import { signDigest, drawSuccess } from "@/lib/onchain/signer";
import { getPublicClient } from "@/lib/onchain/reads";
import { rollsAbi } from "@/lib/onchain/abis";
import { rollSuccessProbability } from "@/lib/params";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ZERO = "0x0000000000000000000000000000000000000000";

/**
 * POST — decide and sign a roll outcome. Body: `{ commitId: "123" }`
 *
 * Every input to the decision comes from `commits(commitId)` on-chain, never the request body: the
 * owner, the letter index, and critically the pity SNAPSHOT taken at commit time. Using live pity
 * instead would let a player influence their own odds by rolling other letters in between, and using
 * a client-supplied letterIndex would let them re-target the digest.
 *
 * The outcome is derived (HMAC of chainId+commitId), so this endpoint is idempotent: asking twice
 * returns the same answer. That is not an optimisation. The reveal is permissionless and the signer
 * decides the result, so a sampler that rolled fresh per request would let a player retry until they
 * won.
 */
export async function POST(req: Request) {
  const fid = await getAuthedFid(req);
  if (!fid) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  if (!(await allow("record-add", fid)))
    return NextResponse.json({ ok: false, error: "rate_limited" }, { status: 429 });

  let raw: string | undefined;
  try {
    raw = (await req.json())?.commitId;
  } catch {
    /* handled below */
  }
  if (!raw || !/^\d+$/.test(String(raw))) {
    return NextResponse.json({ ok: false, error: "bad_commit_id" }, { status: 400 });
  }
  const commitId = BigInt(raw);
  const rolls = addressOf("rolls");

  let commit: readonly [string, number, number, number, boolean, number, bigint];
  try {
    commit = (await getPublicClient().readContract({
      address: rolls,
      abi: rollsAbi,
      functionName: "commits",
      args: [commitId],
    })) as unknown as typeof commit;
  } catch {
    // An out-of-range id panics (0x32) on the dynamic array before any named error can fire.
    return NextResponse.json({ ok: false, error: "unknown_commit" }, { status: 404 });
  }

  const [owner, letterIndex, , , revealed, pityAtCommit] = commit;
  if (!owner || owner === ZERO) {
    return NextResponse.json({ ok: false, error: "unknown_commit" }, { status: 404 });
  }
  if (revealed) return NextResponse.json({ ok: false, error: "already_revealed" }, { status: 409 });

  // 45% base, +10pp per prior failure, capped at 85% — from the SNAPSHOT, not live pity.
  const probability = rollSuccessProbability(Number(pityAtCommit));
  const success = drawSuccess("roll", commitId, probability);

  const signature = await signDigest(
    rollsRevealDigest({
      rolls,
      commitId,
      owner: owner as `0x${string}`,
      letterIndex: Number(letterIndex),
      success,
    }),
  );

  return NextResponse.json({
    ok: true,
    reveal: {
      commitId: String(commitId),
      success,
      signature,
      // Surfaced so the UI can show honest odds rather than the base rate.
      pityAtCommit: Number(pityAtCommit),
      probability,
    },
  });
}
