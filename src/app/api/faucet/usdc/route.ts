/**
 * POST /api/faucet/usdc: a voucher for 25 test USDC (MockUSDC.faucet), Base Sepolia only
 * (decisions.md #22). Body: `{ wallet }`, the wallet that will send the faucet call and receive the
 * USDC. One tap per PROFILE per UTC day: only this server knows which wallets share a profile, so it
 * names the profile, and the contract keeps the day (`faucetDayPlusOne[profile]`), like the free snack.
 *
 * No sign-in: the voucher names the caller, so nobody else can spend it, and asking for a stranger's
 * spends nothing. Refused (`used_today`) when the profile, or any of its wallets as a profile of its
 * own, already tapped today: a wallet that tapped and then joined this profile can't add a second.
 * A database error refuses (`try_again`), as the free snack does. On mainnet there is no faucet: 404.
 */
import { NextResponse } from "next/server";
import { getAddress, isAddress } from "viem";
import { allow } from "@/lib/ratelimit";
import { clientIp } from "@/lib/auth/clientIp";
import { usdcAddress } from "@/lib/onchain/addresses";
import { mockUsdcAbi } from "@/lib/onchain/abis";
import { chainDay, usdcFaucetDigest } from "@/lib/onchain/digests";
import { signDigest } from "@/lib/onchain/signer";
import { getPublicClient, readChainTime } from "@/lib/onchain/reads";
import { accountWalletsStrict } from "@/lib/db/walletLinks";
import { testUsdcFaucetOn } from "@/lib/shop/config";

export const dynamic = "force-dynamic";

/** Seconds a voucher stays spendable (never past the UTC day it names: the contract binds the day). */
const VOUCHER_TTL_SECONDS = 600;

export async function POST(req: Request) {
  if (!testUsdcFaucetOn()) return NextResponse.json({ ok: false, error: "no_faucet" }, { status: 404 });
  if (!(await allow("usdc-faucet-ip", clientIp(req)))) {
    return NextResponse.json({ ok: false, error: "rate_limited" }, { status: 429 });
  }
  const body = (await req.json().catch(() => null)) as { wallet?: string } | null;
  const wallet = body?.wallet;
  if (!wallet || !isAddress(wallet)) return NextResponse.json({ ok: false, error: "bad_wallet" }, { status: 400 });

  let profile: string;
  let wallets: string[];
  try {
    ({ account: profile, wallets } = await accountWalletsStrict(wallet));
  } catch (err) {
    console.error("[usdc-faucet] couldn't read the wallet's profile:", String((err as Error)?.message ?? err).slice(0, 120));
    return NextResponse.json({ ok: false, error: "try_again" }, { status: 503 });
  }

  const usdc = usdcAddress()!;
  const keys = [...new Set([profile, ...wallets])] as `0x${string}`[];
  const [now, ...used] = await Promise.all([
    readChainTime(),
    ...keys.map((k) =>
      getPublicClient().readContract({ address: usdc, abi: mockUsdcAbi, functionName: "faucetDayPlusOne", args: [k] }),
    ),
  ]);
  const today = chainDay(now);
  if (used.some((u) => Number(u) === today + 1)) {
    return NextResponse.json({ ok: false, error: "used_today" }, { status: 409 });
  }
  const deadline = BigInt(Math.min(now + VOUCHER_TTL_SECONDS, (today + 1) * 86_400 - 1));
  const sig = await signDigest(
    usdcFaucetDigest({ usdc, caller: getAddress(wallet), profile: getAddress(profile), today, deadline }),
  );
  return NextResponse.json(
    { ok: true, voucher: { profile: getAddress(profile), deadline: deadline.toString(), sig } },
    { headers: { "Cache-Control": "no-store" } },
  );
}
