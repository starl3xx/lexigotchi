import { NextResponse } from "next/server";
import { getAuthedFid } from "@/lib/auth/quickAuth";
import { allow } from "@/lib/ratelimit";
import { addressOf } from "@/lib/onchain/addresses";
import { freeDailyDigest, chainDay } from "@/lib/onchain/digests";
import { signDigest } from "@/lib/onchain/signer";
import { getPublicClient, readChainTime } from "@/lib/onchain/reads";
import { lettersAbi } from "@/lib/onchain/abis";
import { isAddress } from "viem";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Ten minutes, further clamped to the UTC day — see below. */
const VOUCHER_TTL_SECONDS = 600;

/**
 * POST — issue the FID-gated free daily voucher. Body: `{ wallet: "0x..." }`
 *
 * The whole Sybil gate is this signature: the contract never validates the fid, it only checks that
 * the signer blessed the (contract, chain, kind, buyer, fid, day, deadline) tuple. So the fid comes
 * from the verified Quick Auth JWT and nowhere else.
 *
 * TWO EXPIRIES, and the subtle one matters. `deadline` is checked against block.timestamp, but the
 * UTC DAY is baked into the digest itself — so a voucher issued at 23:59 and submitted at 00:01 is
 * not "expired", it's BadSignature, with nothing to indicate the day rolled over. The deadline is
 * therefore clamped to the earlier of now+10min and the next UTC midnight, so the failure a player
 * can actually hit is the legible one.
 */
export async function POST(req: Request) {
  const fid = await getAuthedFid(req);
  if (!fid) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  if (!(await allow("record-add", fid)))
    return NextResponse.json({ ok: false, error: "rate_limited" }, { status: 429 });

  let wallet: string | undefined;
  try {
    wallet = (await req.json())?.wallet;
  } catch {
    /* handled below */
  }
  if (!wallet || !isAddress(wallet)) {
    return NextResponse.json({ ok: false, error: "bad_wallet" }, { status: 400 });
  }

  const letters = addressOf("letters");

  // Chain time, never Date.now(): the contract compares against block.timestamp, and a host clock
  // slightly ahead issues vouchers that are already expired.
  const now = await readChainTime();
  const today = chainDay(now);

  // dailyUsed stores day+1 so that 0 can mean "never" — comparing against the raw day is off by one.
  const usedDayPlusOne = (await getPublicClient().readContract({
    address: letters,
    abi: lettersAbi,
    functionName: "dailyUsed",
    args: [BigInt(fid)],
  })) as unknown as number | bigint;
  if (Number(usedDayPlusOne) === today + 1) {
    return NextResponse.json({ ok: false, error: "already_claimed_today" }, { status: 409 });
  }

  const nextMidnight = (today + 1) * 86_400;
  const deadline = BigInt(Math.min(now + VOUCHER_TTL_SECONDS, nextMidnight - 1));

  const signature = await signDigest(
    freeDailyDigest({ letters, buyer: wallet as `0x${string}`, fid: BigInt(fid), today, deadline }),
  );

  return NextResponse.json({
    ok: true,
    voucher: {
      fid: String(fid),
      today,
      deadline: String(deadline),
      signature,
      // So the UI can show an honest "resets in", driven by chain time rather than local midnight.
      secondsUntilReset: nextMidnight - now,
    },
  });
}
