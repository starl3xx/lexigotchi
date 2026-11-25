import { NextResponse } from "next/server";
import { allow } from "@/lib/ratelimit";
import { clientIp } from "@/lib/auth/clientIp";
import { isSuiteDeployed } from "@/lib/onchain/addresses";
import { isCampaignConfigured } from "@/lib/db/client";
import { loadShares } from "@/lib/rewards/load";
import { parseRewardWallets } from "@/lib/rewards/wallets";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET `?wallets=0xa,0xb` — every share still waiting to be paid to one of the given wallets, with
 * its proof (the Collect fallback; the keeper's `payout` job normally pays every share the morning
 * its epoch opens, decisions.md #16).
 *
 * The read side of the keeper's stored trees (lib/rewards/load.ts): the player's stored shares →
 * only epochs the chain says are open with that same root → minus what the chain says is already
 * paid, and minus shares in an epoch with nothing left (recovered after its claim window; a claim
 * there would revert). Proofs are public by design: a share pays its baked-in account no matter who
 * submits it, so serving them gates nothing. No database means no stored epochs: an empty answer.
 */
export async function GET(req: Request) {
  if (!(await allow("status", clientIp(req)))) {
    return NextResponse.json({ ok: false, error: "rate_limited" }, { status: 429 });
  }
  const wallets = parseRewardWallets(new URL(req.url).searchParams.get("wallets"));
  if (!wallets) return NextResponse.json({ ok: false, error: "bad_wallets" }, { status: 400 });

  // No contracts on this network (mainnet today) or no database: nothing can be stored or claimed.
  if (!isSuiteDeployed() || !isCampaignConfigured()) return NextResponse.json({ ok: true, claimables: [] });

  try {
    const shares = await loadShares(wallets);
    const claimables = shares
      .filter((s) => !s.paid && !s.dead)
      .map(({ stream, epochId, tokenId, account, amount, proof }) => ({ stream, epochId, tokenId, account, amount, proof }));
    return NextResponse.json({ ok: true, claimables });
  } catch (err) {
    // Say so rather than answer "nothing to collect": an empty list here would hide real earnings.
    console.error("[rewards] reading shares failed:", err);
    return NextResponse.json({ ok: false, error: "rewards_unavailable" }, { status: 503 });
  }
}
