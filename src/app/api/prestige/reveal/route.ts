import { NextResponse } from "next/server";
import { getAuthedFid } from "@/lib/auth/quickAuth";
import { allow } from "@/lib/ratelimit";
import { addressOf } from "@/lib/onchain/addresses";
import { prestigeRevealDigest } from "@/lib/onchain/digests";
import { signDigest, drawSuccess } from "@/lib/onchain/signer";
import { getPublicClient } from "@/lib/onchain/reads";
import { prestigeAbi } from "@/lib/onchain/abis";
import { prestigeSuccessProbability } from "@/lib/params";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ZERO = "0x0000000000000000000000000000000000000000";

/**
 * POST — decide and sign an ascension outcome. Body: `{ commitId: "123" }`
 *
 * Same shape as the roll reveal with one field-order difference that matters: the prestige digest is
 * (contract, chainId, commitId, tokenId, owner, success) — tokenId BEFORE owner, and no letterIndex.
 * Getting that order wrong produces a signature that fails as BadSignature with no other symptom, so
 * the encoder lives in digests.ts where it is pinned against Foundry vectors.
 *
 * Prestige pity is keyed per TOKEN (Prestige.sol:42), unlike roll pity which is keyed per
 * (owner, letterIndex) — but both come from the commit snapshot, so neither can move between commit
 * and reveal.
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
  const prestige = addressOf("prestige");

  let commit: readonly [bigint, string, boolean, number];
  try {
    commit = (await getPublicClient().readContract({
      address: prestige,
      abi: prestigeAbi,
      functionName: "commits",
      args: [commitId],
    })) as unknown as typeof commit;
  } catch {
    return NextResponse.json({ ok: false, error: "unknown_commit" }, { status: 404 });
  }

  const [tokenId, owner, revealed, pityAtCommit] = commit;
  if (!owner || owner === ZERO) {
    return NextResponse.json({ ok: false, error: "unknown_commit" }, { status: 404 });
  }
  if (revealed) return NextResponse.json({ ok: false, error: "already_revealed" }, { status: 409 });

  const probability = prestigeSuccessProbability(Number(pityAtCommit));
  const success = drawSuccess("prestige", commitId, probability);

  const signature = await signDigest(
    prestigeRevealDigest({ prestige, commitId, tokenId, owner: owner as `0x${string}`, success }),
  );

  return NextResponse.json({
    ok: true,
    reveal: {
      commitId: String(commitId),
      tokenId: String(tokenId),
      success,
      signature,
      pityAtCommit: Number(pityAtCommit),
      probability,
    },
  });
}
