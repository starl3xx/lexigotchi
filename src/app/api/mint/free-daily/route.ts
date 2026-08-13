import { NextResponse } from "next/server";
import { getAuthedFid } from "@/lib/auth/quickAuth";
import { allow } from "@/lib/ratelimit";
import { addressOf } from "@/lib/onchain/addresses";
import { freeDailyDigest, chainDay } from "@/lib/onchain/digests";
import { signDigest } from "@/lib/onchain/signer";
import { getPublicClient, readChainTime } from "@/lib/onchain/reads";
import { lettersAbi } from "@/lib/onchain/abis";
import { isCoinbaseVerified, verifiedDailyKey } from "@/lib/onchain/verifications";
import { isAddress } from "viem";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Ten minutes, further clamped to the UTC day — see below. */
const VOUCHER_TTL_SECONDS = 600;

/**
 * POST — issue the free daily voucher. Body: `{ wallet: "0x..." }`
 *
 * The whole Sybil gate is this signature: the contract never validates the daily key, it only
 * checks that the signer blessed the (contract, chain, kind, buyer, key, day, deadline) tuple. Two
 * identities can earn one, and they live in DISJOINT uint256 namespaces:
 *
 *   FARCASTER — the fid from the verified Quick Auth JWT, and nowhere else. Small ints (< 2^32).
 *   VERIFIED WALLET — a wallet holding a live Coinbase Verified Account attestation on Base
 *     mainnet (KYC-backed). Keyed `2^160 | uint160(address)` — always ≥ 2^160, always bigint,
 *     because `dailyUsed` is one shared mapping and a synthetic key that came out small would
 *     consume a real FID's slot.
 *
 * The JWT wins when both are present, so a signed-in player's daily always lands on their FID —
 * their streak doesn't fork the day they verify a wallet.
 *
 * No wallet-ownership proof is needed for issuance: the voucher binds `buyer`, so it is only
 * spendable BY that wallet. Requesting one for someone else's address hands them nothing but a
 * courtesy — and burns your own rate-limit budget, not theirs.
 *
 * TWO EXPIRIES, and the subtle one matters. `deadline` is checked against block.timestamp, but the
 * UTC DAY is baked into the digest itself — so a voucher issued at 23:59 and submitted at 00:01 is
 * not "expired", it's BadSignature, with nothing to indicate the day rolled over. The deadline is
 * therefore clamped to the earlier of now+10min and the next UTC midnight, so the failure a player
 * can actually hit is the legible one.
 */
export async function POST(req: Request) {
  let wallet: string | undefined;
  try {
    wallet = (await req.json())?.wallet;
  } catch {
    /* handled below */
  }
  if (!wallet || !isAddress(wallet)) {
    return NextResponse.json({ ok: false, error: "bad_wallet" }, { status: 400 });
  }

  // Identity. `key` is bigint from birth: verified-wallet keys exceed 2^53, and a JS number would
  // silently corrupt one before BigInt() ever saw it.
  let key: bigint;
  const fid = await getAuthedFid(req);
  if (fid) {
    if (!(await allow("record-add", fid)))
      return NextResponse.json({ ok: false, error: "rate_limited" }, { status: 429 });
    key = BigInt(fid);
  } else {
    // Rate limit BEFORE the attestation check — it costs two mainnet RPC reads and this is an
    // unauthenticated surface.
    if (!(await allow("record-add", wallet.toLowerCase())))
      return NextResponse.json({ ok: false, error: "rate_limited" }, { status: 429 });
    let verified: boolean;
    try {
      verified = await isCoinbaseVerified(wallet);
    } catch (err) {
      // "Could not check" is not "not verified" — a 403 here would tell a verified player they
      // aren't, every time the mainnet RPC hiccups.
      console.error("[free-daily] attestation check failed:", err);
      return NextResponse.json({ ok: false, error: "verification_unavailable" }, { status: 502 });
    }
    if (!verified) {
      return NextResponse.json({ ok: false, error: "verification_required" }, { status: 403 });
    }
    key = verifiedDailyKey(wallet);
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
    args: [key],
  })) as unknown as number | bigint;
  if (Number(usedDayPlusOne) === today + 1) {
    return NextResponse.json({ ok: false, error: "already_claimed_today" }, { status: 409 });
  }

  const nextMidnight = (today + 1) * 86_400;
  const deadline = BigInt(Math.min(now + VOUCHER_TTL_SECONDS, nextMidnight - 1));

  const signature = await signDigest(
    freeDailyDigest({ letters, buyer: wallet as `0x${string}`, fid: key, today, deadline }),
  );

  return NextResponse.json({
    ok: true,
    voucher: {
      // A string, not a number: verified-wallet keys are ≥ 2^160 and JSON numbers stop being exact
      // at 2^53. The client does BigInt(v.fid), which handles either namespace.
      fid: String(key),
      today,
      deadline: String(deadline),
      signature,
      // So the UI can show an honest "resets in", driven by chain time rather than local midnight.
      secondsUntilReset: nextMidnight - now,
    },
  });
}
