import { NextResponse } from "next/server";
import { allow } from "@/lib/ratelimit";
import { clientIp } from "@/lib/auth/clientIp";
import { isSuiteDeployed } from "@/lib/onchain/addresses";
import { isCampaignConfigured } from "@/lib/db/client";
import { latestYieldDay, loadShares } from "@/lib/rewards/load";
import { earningsJson, summarizeEarnings } from "@/lib/rewards/earnings";
import { parseRewardWallets } from "@/lib/rewards/wallets";
import { accountWalletsOf, snapshotOf } from "@/lib/rewards/share";
import { earningsShareOn, signEarningsShare } from "@/lib/earningsShareToken";
import { accountsOf } from "@/lib/db/walletLinks";
import type { EarningsSummary, LeafStatus } from "@/lib/rewards/earnings";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET `?wallets=0xa,0xb` — what the player's words have earned for these wallets: per word (yield),
 * the latest payout day, the bounty, and anything not paid out yet (lib/rewards/earnings.ts), and
 * `share`: a signed snapshot for the share card, of what the first wallet's account earned.
 * Public, like the chain it reads: every share is a public leaf, and its payment a public event.
 */
/**
 * A signed snapshot for the share card (lib/earningsShare.ts), or null: of what ONE player earned.
 * This route adds up whatever wallets it is given, so the snapshot covers only the first wallet's
 * account (`accountWalletsOf`): the whole answer when every wallet is in it, else the sums of that
 * account's own leaves. `accountsOf` reads a wallet as its own account when the links can't be
 * read, and the snapshot is then the first wallet's alone. Under one whole $WORD earned, or no key:
 * no token.
 */
async function shareOf(leaves: readonly LeafStatus[], latestDay: number | null, whole: EarningsSummary, wallets: readonly string[]): Promise<string | null> {
  if (whole.total <= 0n || !earningsShareOn()) return null;
  const mine = new Set(accountWalletsOf(wallets, await accountsOf(wallets)));
  const part = mine.size === new Set(wallets.map((w) => w.toLowerCase())).size ? whole : summarizeEarnings(leaves.filter((l) => mine.has(l.account.toLowerCase())), latestDay);
  // The picture speaks in whole $WORD, rounded down: under one whole $WORD it would say "0"
  // (Bugbot on #231), so there is nothing to share yet.
  const snapshot = snapshotOf(part);
  return snapshot.total > 0 ? signEarningsShare(snapshot) : null;
}

export async function GET(req: Request) {
  if (!(await allow("status", clientIp(req)))) {
    return NextResponse.json({ ok: false, error: "rate_limited" }, { status: 429 });
  }
  const wallets = parseRewardWallets(new URL(req.url).searchParams.get("wallets"));
  if (!wallets) return NextResponse.json({ ok: false, error: "bad_wallets" }, { status: 400 });

  // No contracts here (mainnet today) or no database: nothing has been earned that we could show.
  if (!isSuiteDeployed() || !isCampaignConfigured()) {
    return NextResponse.json({ ok: true, earnings: earningsJson(summarizeEarnings([], null)), share: null });
  }
  try {
    const [shares, latestDay] = await Promise.all([loadShares(wallets), latestYieldDay()]);
    const leaves = shares.map((s) => ({ ...s, amount: BigInt(s.amount) }));
    const summary = summarizeEarnings(leaves, latestDay);
    return NextResponse.json({ ok: true, earnings: earningsJson(summary), share: await shareOf(leaves, latestDay, summary, wallets) });
  } catch (err) {
    // Say so: "earned nothing" would be a wrong answer for a player whose words earn.
    console.error("[rewards] reading earnings failed:", err);
    return NextResponse.json({ ok: false, error: "rewards_unavailable" }, { status: 503 });
  }
}
