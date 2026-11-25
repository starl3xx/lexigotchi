import { NextResponse } from "next/server";
import { isAddress } from "viem";
import { addressOf, isSuiteDeployed } from "@/lib/onchain/addresses";
import { lettersAbi } from "@/lib/onchain/abis";
import { getPublicClient, readChainTime } from "@/lib/onchain/reads";
import { relatedDailyKeys } from "@/lib/onchain/dailyIdentity";
import { NETWORK } from "@/lib/onchain/network";
import { accountWallets } from "@/lib/db/walletLinks";
import { recordedFreeKey } from "@/lib/db/freeClaims";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET `?wallet=0x…[&fid=123]` → `{ claimed }`: has this player taken today's daily under ANY key the
 * daily route would count (relatedDailyKeys: the FIDs that verified the wallet, those FIDs' other
 * wallets, every Coinbase and X key)? The client can't walk Farcaster on its own, so without this a
 * player who pulled in the mini app would see Pull on the web and get refused (Bugbot on #138).
 *
 * Read-only, public chain data, so no sign-in: `fid` only adds keys to read, it unlocks nothing.
 */
export async function GET(req: Request) {
  if (!isSuiteDeployed()) return NextResponse.json({ ok: true, claimed: false });
  const u = new URL(req.url);
  const wallet = u.searchParams.get("wallet") ?? "";
  const fidRaw = Number(u.searchParams.get("fid"));
  if (!isAddress(wallet)) return NextResponse.json({ ok: false, error: "bad_wallet" }, { status: 400 });
  const fid = Number.isInteger(fidRaw) && fidRaw > 0 && fidRaw < 2 ** 32 ? fidRaw : null;
  try {
    const [related, now, { account }] = await Promise.all([relatedDailyKeys({ fid, wallet }), readChainTime(), accountWallets(wallet)]);
    const today = Math.floor(now / 86_400);
    // The key this PROFILE took today's letter under (lib/db/freeClaims.ts), whatever the walk finds:
    // the walk needs Farcaster's lookups, and a failed one would show Pull to a profile that pulled.
    const recorded = await recordedFreeKey(NETWORK.id, account, "daily", today);
    const keys = [...new Set([...related, ...(recorded !== null ? [recorded] : [])])];
    const used = (await getPublicClient().multicall({
      allowFailure: false,
      contracts: keys.map((k) => ({ address: addressOf("letters"), abi: lettersAbi, functionName: "dailyUsed" as const, args: [k] })),
    })) as unknown as (number | bigint)[];
    return NextResponse.json({ ok: true, claimed: used.some((v) => Number(v) === today + 1) }, { headers: { "Cache-Control": "private, max-age=20" } });
  } catch (err) {
    console.error("[daily-status] failed:", String((err as Error)?.message ?? err).slice(0, 120));
    return NextResponse.json({ ok: false, error: "unavailable" }, { status: 503 });
  }
}
