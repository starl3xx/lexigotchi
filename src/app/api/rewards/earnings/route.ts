import { NextResponse } from "next/server";
import { allow } from "@/lib/ratelimit";
import { clientIp } from "@/lib/auth/clientIp";
import { isSuiteDeployed } from "@/lib/onchain/addresses";
import { isCampaignConfigured } from "@/lib/db/client";
import { latestYieldDay, loadShares } from "@/lib/rewards/load";
import { earningsJson, summarizeEarnings } from "@/lib/rewards/earnings";
import { parseRewardWallets } from "@/lib/rewards/wallets";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET `?wallets=0xa,0xb` — what the player's words have earned for these wallets: per word (yield),
 * the latest payout day, the bounty, and anything not paid out yet (lib/rewards/earnings.ts).
 * Public, like the chain it reads: every share is a public leaf, and its payment a public event.
 */
export async function GET(req: Request) {
  if (!(await allow("status", clientIp(req)))) {
    return NextResponse.json({ ok: false, error: "rate_limited" }, { status: 429 });
  }
  const wallets = parseRewardWallets(new URL(req.url).searchParams.get("wallets"));
  if (!wallets) return NextResponse.json({ ok: false, error: "bad_wallets" }, { status: 400 });

  // No contracts here (mainnet today) or no database: nothing has been earned that we could show.
  if (!isSuiteDeployed() || !isCampaignConfigured()) {
    return NextResponse.json({ ok: true, earnings: earningsJson(summarizeEarnings([], null)) });
  }
  try {
    const [shares, latestDay] = await Promise.all([loadShares(wallets), latestYieldDay()]);
    const leaves = shares.map((s) => ({ ...s, amount: BigInt(s.amount) }));
    return NextResponse.json({ ok: true, earnings: earningsJson(summarizeEarnings(leaves, latestDay)) });
  } catch (err) {
    // Say so: "earned nothing" would be a wrong answer for a player whose words earn.
    console.error("[rewards] reading earnings failed:", err);
    return NextResponse.json({ ok: false, error: "rewards_unavailable" }, { status: 503 });
  }
}
