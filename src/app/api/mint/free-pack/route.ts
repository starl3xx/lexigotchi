import { NextResponse } from "next/server";
import { getAuthedFid } from "@/lib/auth/quickAuth";
import { allow } from "@/lib/ratelimit";
import { addressOf } from "@/lib/onchain/addresses";
import { freePackDigest } from "@/lib/onchain/digests";
import { signDigest } from "@/lib/onchain/signer";
import { getPublicClient, readChainTime } from "@/lib/onchain/reads";
import { lettersAbi } from "@/lib/onchain/abis";
import { NETWORK } from "@/lib/onchain/network";
import { isAddress } from "viem";

export const dynamic = "force-dynamic";
export const runtime = "nodejs"; // node:crypto + quick-auth

/** Ten minutes is plenty for a wallet confirmation and short enough to bound a leaked voucher. */
const VOUCHER_TTL_SECONDS = 600;

/**
 * POST — issue a free-pack voucher for the Quick-Auth-verified caller.
 *
 * The contract never validates the FID; it only checks that the signer blessed the tuple. So signing
 * a client-supplied fid would hand away the entire Sybil gate — the FID comes from the verified JWT,
 * always, and the wallet is bound into the digest so the voucher can't be used from another address.
 *
 * The voucher is deterministic in the nonce, which means a repeat request RE-ISSUES THE SAME one
 * rather than minting a second entitlement. That's deliberate: `nonce` is bound into the digest but
 * is not recorded on-chain, so it prevents nothing by itself. `freePackClaimed[fid]` is the only
 * real one-shot guard, and it is set at commit time by the contract.
 *
 * Body: `{ wallet: "0x..." }`
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
  const client = getPublicClient();

  // On-chain refusals first — these are the authoritative guards, and checking them here turns a
  // confusing revert into a clean error the UI can explain.
  const [open, claimed] = await client.multicall({
    allowFailure: false,
    contracts: [
      { address: letters, abi: lettersAbi, functionName: "freePackOpen" },
      { address: letters, abi: lettersAbi, functionName: "freePackClaimed", args: [BigInt(fid)] },
    ] as const,
  });
  if (!open) return NextResponse.json({ ok: false, error: "campaign_closed" }, { status: 409 });
  if (claimed) return NextResponse.json({ ok: false, error: "already_claimed" }, { status: 409 });

  // `deadline` must come from chain time, not Date.now(): the contract compares against
  // block.timestamp, and a host clock even slightly ahead issues vouchers that are already expired.
  const now = await readChainTime();
  const deadline = BigInt(now + VOUCHER_TTL_SECONDS);

  // Deterministic per (fid, wallet) so a retry re-issues the identical voucher.
  const nonce = BigInt(fid);

  const inner = freePackDigest({
    letters,
    buyer: wallet as `0x${string}`,
    fid: BigInt(fid),
    nonce,
    deadline,
  });
  const signature = await signDigest(inner);

  return NextResponse.json({
    ok: true,
    voucher: {
      fid: String(fid),
      nonce: String(nonce),
      deadline: String(deadline),
      signature,
      letters,
      chainId: NETWORK.id,
    },
  });
}
