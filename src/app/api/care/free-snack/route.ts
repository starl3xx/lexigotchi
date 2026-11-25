/**
 * POST /api/care/free-snack: today's free snack voucher for a staker's PROFILE (Staking.feedWithSnack).
 *
 * Body: `{ wallet, staker }`. `wallet` is the one that will send the feed (the staker, or a caretaker
 * it named); `staker` stakes the first Word fed. One free snack per profile per UTC day (starl3xx:
 * "only one wallet per profile should get a free anything"): the snack is the STAKER's profile's,
 * whoever feeds, and only this server knows which wallets share a profile, so it names the profile.
 *
 * No sign-in: the voucher names the caller, so it's useless to anyone else, and it names the staker,
 * so it feeds only that staker's Words (the contract checks both, and that the caller may feed them).
 * Asking for a stranger's voucher spends nothing.
 *
 * Refused (`used_today`) when the profile, or any of its wallets as a profile of its own, already
 * used today's snack: a wallet that spent its snack and then joined this profile can't add a second.
 * Then the app feeds paid. A database error refuses (`try_again`): read as unlinked, a wallet would be
 * a profile of its own, and could take a second snack.
 */
import { NextResponse } from "next/server";
import { getAddress, isAddress } from "viem";
import { allow } from "@/lib/ratelimit";
import { addressOf, isSuiteDeployed } from "@/lib/onchain/addresses";
import { stakingAbi } from "@/lib/onchain/abis";
import { chainDay, freeSnackDigest } from "@/lib/onchain/digests";
import { signDigest } from "@/lib/onchain/signer";
import { getPublicClient, readChainTime } from "@/lib/onchain/reads";
import { accountWalletsStrict } from "@/lib/db/walletLinks";

/** Seconds a voucher stays spendable (and never past the UTC day it names: the contract binds the day). */
const VOUCHER_TTL_SECONDS = 600;

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { wallet?: string; staker?: string } | null;
  const wallet = body?.wallet;
  const staker = body?.staker;
  if (!wallet || !isAddress(wallet) || !staker || !isAddress(staker)) {
    return NextResponse.json({ ok: false, error: "bad_wallet" }, { status: 400 });
  }
  if (!(await allow("free-snack", wallet.toLowerCase()))) {
    return NextResponse.json({ ok: false, error: "rate_limited" }, { status: 429 });
  }
  if (!isSuiteDeployed()) return NextResponse.json({ ok: false, error: "not_deployed" }, { status: 503 });

  let profile: string;
  let wallets: string[];
  try {
    ({ account: profile, wallets } = await accountWalletsStrict(staker));
  } catch (err) {
    console.error("[free-snack] couldn't read the staker's profile:", String((err as Error)?.message ?? err).slice(0, 120));
    return NextResponse.json({ ok: false, error: "try_again" }, { status: 503 });
  }

  const staking = addressOf("staking");
  const keys = [...new Set([profile, ...wallets])] as `0x${string}`[];
  const [now, toggle, ...used] = await Promise.all([
    readChainTime(),
    getPublicClient().readContract({ address: staking, abi: stakingAbi, functionName: "freeDailySnack" }),
    ...keys.map((k) => getPublicClient().readContract({ address: staking, abi: stakingAbi, functionName: "freeSnackDayPlusOne", args: [k] })),
  ]);
  if (!toggle) return NextResponse.json({ ok: false, error: "no_free_snack" }, { status: 409 });
  const today = chainDay(now);
  if (used.some((u) => Number(u) === today + 1)) {
    return NextResponse.json({ ok: false, error: "used_today" }, { status: 409 });
  }

  const deadline = BigInt(Math.min(now + VOUCHER_TTL_SECONDS, (today + 1) * 86_400 - 1));
  const sig = await signDigest(
    freeSnackDigest({
      staking,
      caller: getAddress(wallet),
      staker: getAddress(staker),
      profile: getAddress(profile),
      today,
      deadline,
    }),
  );
  return NextResponse.json(
    { ok: true, voucher: { staker: getAddress(staker), profile: getAddress(profile), deadline: deadline.toString(), sig } },
    { headers: { "Cache-Control": "no-store" } },
  );
}
