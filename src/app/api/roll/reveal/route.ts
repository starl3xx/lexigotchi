import { NextResponse } from "next/server";
import { getAuthedFid } from "@/lib/auth/quickAuth";
import { allow } from "@/lib/ratelimit";
import { clientIp } from "@/lib/auth/clientIp";
import { addressOf } from "@/lib/onchain/addresses";
import { rollsRevealDigest } from "@/lib/onchain/digests";
import { signDigest, drawSuccess } from "@/lib/onchain/signer";
import { getPublicClient } from "@/lib/onchain/reads";
import { rollsAbi } from "@/lib/onchain/abis";
import { rollSuccessProbability } from "@/lib/params";
import { relayRollReveal, relayerConfigured, RELAY_WAIT_MS } from "@/lib/onchain/relayer";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// A relayed reveal waits up to RELAY_WAIT_MS for its block; leave room around it.
export const maxDuration = 30;

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
 *
 * AUTH IS OPTIONAL, as on /api/mint/reveal. The signature binds the owner STORED in the commit (a
 * reveal pays nobody new, whoever relays it) and the outcome is fixed per commitId, so a caller
 * learns nothing it can spend or reroll. Requiring a Farcaster session would shut wallet-only
 * players out of a mechanic they paid for (decisions.md #9). The FID, when present, is only the
 * rate-limit key; anonymous callers are bucketed by IP.
 *
 * RELAY (`{ relay: true }`, decisions.md #14): the server sends the reveal itself
 * (lib/onchain/relayer), so the player confirms one transaction per roll and the wallet never
 * previews the result. The answer then carries the outcome read from the mined reveal, not a
 * signature. Without a relayer key, or when the send is refused before broadcast, the answer is the
 * signature as before and the player's wallet sends it. An already-revealed commit answers with
 * its outcome under relay (a lost response is a normal case there), and 409 otherwise.
 */
export async function POST(req: Request) {
  const fid = await getAuthedFid(req);
  if (!(await allow("record-add", fid ?? clientIp(req))))
    return NextResponse.json({ ok: false, error: "rate_limited" }, { status: 429 });

  let raw: string | undefined;
  let wantRelay = false;
  try {
    const body = await req.json();
    raw = body?.commitId;
    wantRelay = body?.relay === true;
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

  // 40% base, +15pp per prior failure, capped at 85% (params.ts) — from the SNAPSHOT, not live pity.
  const probability = rollSuccessProbability(Number(pityAtCommit));
  const success = drawSuccess("roll", commitId, probability);
  const facts = {
    commitId: String(commitId),
    pityAtCommit: Number(pityAtCommit),
    letterIndex: Number(letterIndex),
    owner,
    probability,
  };

  if (revealed) {
    if (!wantRelay) return NextResponse.json({ ok: false, error: "already_revealed" }, { status: 409 });
    // The outcome is fixed per commit, so this is the answer the first request got. (A signed
    // success that no longer applied was a no-op on chain; the pity read will say so.)
    return NextResponse.json({ ok: true, reveal: { ...facts, success, relayed: "already" } });
  }

  const signature = await signDigest(
    rollsRevealDigest({
      rolls,
      commitId,
      owner: owner as `0x${string}`,
      letterIndex: Number(letterIndex),
      success,
    }),
  );

  if (wantRelay && relayerConfigured()) {
    const r = await relayRollReveal(commitId, success, signature);
    if (r.kind === "mined") {
      return NextResponse.json({
        ok: true,
        // The outcome as the chain applied it (the reveal's own event), and the exact new pity.
        reveal: { ...facts, success: r.success, pity: r.pity, relayed: "mined", txHash: r.txHash },
      });
    }
    if (r.kind === "pending" || r.kind === "reverted") {
      // Broadcast: the player's wallet must NOT send a second reveal. The chain finishes it.
      return NextResponse.json({ ok: true, reveal: { ...facts, success, relayed: r.kind, txHash: r.txHash } });
    }
    console.warn(`[roll/reveal] relay unavailable (${r.reason}); the player's wallet sends commit ${commitId}`);
    // Nothing was broadcast: fall through to the signature, and the wallet sends it.
  }

  return NextResponse.json({
    ok: true,
    reveal: {
      commitId: String(commitId),
      success,
      signature,
      // Surfaced so the UI can show honest odds rather than the base rate, and the new pity
      // (lib/onchain/pityOverlay) before the chain read catches up.
      pityAtCommit: Number(pityAtCommit),
      letterIndex: Number(letterIndex),
      owner,
      probability,
    },
  });
}
