import { NextResponse } from "next/server";
import { getAuthedFid } from "@/lib/auth/quickAuth";
import { allow } from "@/lib/ratelimit";
import { clientIp } from "@/lib/auth/clientIp";
import { addressOf } from "@/lib/onchain/addresses";
import { prestigeRevealDigest } from "@/lib/onchain/digests";
import { signDigest, drawSuccess } from "@/lib/onchain/signer";
import { getPublicClient } from "@/lib/onchain/reads";
import { prestigeAbi } from "@/lib/onchain/abis";
import { prestigeSuccessProbability } from "@/lib/params";
import { relayPrestigeReveal, relayerConfigured } from "@/lib/onchain/relayer";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// A relayed reveal waits up to RELAY_WAIT_MS (20 s) for its block; leave room around it. Without
// this the function could be cut off after the broadcast, with the answer never sent.
export const maxDuration = 30;

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
 * and reveal. The STAGE comes from the commit too (`PrestigeCommit.level`, the word ladder): each
 * stage has its own first-try odds (params `prestige.baseByLevel`), and the commit records the stage
 * the fee priced, so the odds always match what was paid.
 *
 * AUTH IS OPTIONAL, as on /api/mint/reveal. The signature binds the owner STORED in the commit (a
 * reveal pays nobody new, whoever relays it) and the outcome is fixed per commitId, so a caller
 * learns nothing it can spend or reroll. Requiring a Farcaster session would shut wallet-only
 * players out of a mechanic they paid for (decisions.md #9). The FID, when present, is only the
 * rate-limit key; anonymous callers are bucketed by IP.
 *
 * RELAY (`{ relay: true }`; decisions.md #14, which named ascension as a later case): the server
 * sends the reveal itself (lib/onchain/relayer), so the player confirms one transaction per attempt
 * and no wallet prompt lands in the middle of it. The answer then carries what the chain did, read
 * from the mined reveal (`relayed: "mined"`, with `success`, the word's `stage` level, and its
 * `pity`), and no signature. Without a relayer key, or when the send is refused before broadcast,
 * the answer is the signature as before and the player's wallet sends it. An already-revealed
 * commit answers `relayed: "already"` under relay (a lost response is a normal case there: the
 * game reads the result from the chain), and 409 otherwise.
 *
 * WITHOUT the relay flag this route answers exactly as it always did: a client bundle from before
 * the relay keeps working through a deploy.
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
  const prestige = addressOf("prestige");

  let commit: readonly [bigint, string, boolean, number, number];
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

  const [tokenId, owner, revealed, pityAtCommit, level] = commit;
  if (!owner || owner === ZERO) {
    return NextResponse.json({ ok: false, error: "unknown_commit" }, { status: 404 });
  }

  const probability = prestigeSuccessProbability(Number(pityAtCommit), Number(level));
  const success = drawSuccess("prestige", prestige, commitId, probability);
  // What the commit was: the game checks a resumed attempt is this word's own (`level`, `owner`).
  const facts = {
    commitId: String(commitId),
    tokenId: String(tokenId),
    pityAtCommit: Number(pityAtCommit),
    level: Number(level),
    owner,
    probability,
  };

  if (revealed) {
    if (!wantRelay) return NextResponse.json({ ok: false, error: "already_revealed" }, { status: 409 });
    // Finished already (this server's own relay, whose answer was lost, or another tab). No
    // outcome is claimed here: the signed one may not be what the chain applied, so the game reads
    // the word's stage from the chain.
    return NextResponse.json({ ok: true, reveal: { ...facts, relayed: "already" } });
  }

  const signature = await signDigest(
    prestigeRevealDigest({ prestige, commitId, tokenId, owner: owner as `0x${string}`, success }),
  );

  if (wantRelay && relayerConfigured()) {
    const r = await relayPrestigeReveal(commitId, success, signature);
    if (r.kind === "mined") {
      return NextResponse.json({
        ok: true,
        // The outcome as the chain applied it (the reveal's own event): where the word stands now.
        // `stage` is null when the level after a miss couldn't be read at the reveal's block.
        reveal: { ...facts, success: r.success, stage: r.level, pity: r.pity, relayed: "mined", txHash: r.txHash },
      });
    }
    if (r.kind === "pending" || r.kind === "reverted") {
      // Broadcast: the player's wallet must NOT send a second reveal. The chain finishes it, and
      // the game reads the result from there (no outcome is claimed for a reveal not seen to land).
      return NextResponse.json({ ok: true, reveal: { ...facts, relayed: r.kind, txHash: r.txHash } });
    }
    console.warn(`[prestige/reveal] relay unavailable (${r.reason}); the player's wallet sends commit ${commitId}`);
    // Nothing was broadcast: fall through to the signature, and the wallet sends it.
  }

  return NextResponse.json({
    ok: true,
    reveal: {
      ...facts,
      success,
      signature,
    },
  });
}
