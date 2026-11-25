import { NextResponse } from "next/server";
import { addressOf } from "@/lib/onchain/addresses";
import { freePackDigest } from "@/lib/onchain/digests";
import { signDigest } from "@/lib/onchain/signer";
import { getPublicClient, readChainTime } from "@/lib/onchain/reads";
import { lettersAbi } from "@/lib/onchain/abis";
import { NETWORK } from "@/lib/onchain/network";
import { isAddress } from "viem";
import { claimFree, crossGrants, fidLedgerAccount, keyOwnedByProfile, recordedFreeGrant } from "@/lib/db/freeClaims";
import { fidsByAddressesDetailed } from "@/lib/neynar";
import { relatedDailyKeys } from "@/lib/onchain/dailyIdentity";
import { resolveFreeIdentity } from "@/lib/onchain/freeIdentity";
import { freeGrantStop, settleGrants, STOP_ERROR } from "@/lib/onchain/freeLedger";
import { crossKeys, FREE_LETTERS } from "@/lib/freeLetters";

export const dynamic = "force-dynamic";
export const runtime = "nodejs"; // node:crypto + quick-auth

/** Ten minutes is plenty for a wallet confirmation and short enough to bound a leaked voucher. */
const VOUCHER_TTL_SECONDS = 600;

/**
 * POST — issue the free-pack voucher: five free letters, once per PROFILE, for every verified player
 * (decisions.md #21: "every verified player (FC, X, or CB-verified) gets a free 5-pack"). It used to be
 * the pre-launch campaign's reward, signed only for a Quick Auth FID that added the mini app and
 * shared a cast; the campaign still records adds and shares, but no longer gates the pack.
 *
 * The identity is the daily's (lib/onchain/freeIdentity.ts): a Farcaster FID, an X account older than
 * 90 days, or a Coinbase-verified wallet, keyed in the namespaces `freePackClaimed` shares with
 * `dailyUsed` (`uint256`, never interpreted by the contract), so no contract change. The contract only
 * checks that the signer blessed (contract, chain, kind, buyer, key, nonce, deadline), so signing a
 * client-supplied identity would hand away the whole gate: the FID comes from the verified JWT, the X
 * account from the profile, the Coinbase key from an attestation. The wallet is bound into the digest,
 * so the voucher can't be spent from another address.
 *
 * One pack per profile: `freePackClaimed` across every key the profile has (relatedDailyKeys, the same
 * walk the daily uses, plus the key this profile's pack was recorded under), then the `free_claims`
 * record, first key wins. Then the free-letter budget and the dictionary stop. The nonce is the key,
 * so a repeat request re-issues the SAME voucher; `freePackClaimed[key]` is the onchain one-shot guard.
 *
 * Body: `{ wallet: "0x..." }`
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

  const who = await resolveFreeIdentity(req, wallet, "free-pack");
  if (!who.ok) return NextResponse.json({ ok: false, error: who.error }, { status: who.status });
  const { key, fid, account, wallets: accountWalletList } = who;

  const letters = addressOf("letters");
  const client = getPublicClient();

  // On-chain refusals first: they are the authoritative guards, and checking them here turns a
  // confusing revert into a clean error the UI can explain.
  // Expired grants are settled against the chain first (lib/onchain/freeLedger.ts), so a pack voucher
  // that lapsed unused gives its five letters back, BEFORE this profile's own grant is read: a re-issue
  // is only a re-issue of a grant that still counts.
  //
  // Which ledger account the pack goes on: the profile, when the key belongs to it (an X or Coinbase
  // key came from the profile itself; a FID must have verified one of its wallets). A FID that didn't
  // isn't recorded ON the profile (no planting a stranger's key), but its pack still counts, under a
  // ledger account of the FID's own.
  const owned = await keyOwnedByProfile({ fid, derivedFromProfile: who.source !== "fid", accountWallets: accountWalletList, lookup: fidsByAddressesDetailed });
  const ledger = owned || fid === null ? account : fidLedgerAccount(fid);
  await settleGrants(NETWORK.id, ledger);
  // A pack on ANOTHER ledger account that paid one of the profile's wallets (an unverified FID's;
  // Bugbot on #199) joins the onchain check: once its key opened a pack, this profile has had one. A
  // voucher not yet used blocks nothing, so a stranger naming this wallet can't hold its pack.
  const [recordedGrant, profileGrant, cross] = await Promise.all([
    recordedFreeGrant(NETWORK.id, ledger, "pack", 0),
    ledger === account ? Promise.resolve(null) : recordedFreeGrant(NETWORK.id, account, "pack", 0),
    crossGrants(NETWORK.id, accountWalletList, [ledger]),
  ]);
  const recordedKeys = [recordedGrant?.key, profileGrant?.key, ...crossKeys(cross, "pack", 0)].filter((k): k is bigint => k != null);
  const keys = [...new Set([key, ...(await relatedDailyKeys({ fid, wallet })), ...recordedKeys])];
  const [open, claimed] = await Promise.all([
    client.readContract({ address: letters, abi: lettersAbi, functionName: "freePackOpen" }) as Promise<boolean>,
    client.multicall({
      allowFailure: false,
      contracts: keys.map((k) => ({ address: letters, abi: lettersAbi, functionName: "freePackClaimed" as const, args: [k] })),
    }) as Promise<boolean[]>,
  ]);
  if (!open) return NextResponse.json({ ok: false, error: "campaign_closed" }, { status: 409 });
  if (claimed.some(Boolean)) return NextResponse.json({ ok: false, error: "already_claimed" }, { status: 409 });

  // The free-letter budget and the dictionary stop (decisions.md #21). A pack this profile already
  // holds a counted voucher for is a re-issue: no new letters.
  try {
    const stop = await freeGrantStop(NETWORK.id, recordedGrant?.counts ? 0 : FREE_LETTERS.pack);
    if (stop) return NextResponse.json({ ok: false, error: STOP_ERROR[stop] }, { status: 409 });
  } catch (err) {
    console.error("[free-pack] couldn't read the free-letter ledger, refusing:", String((err as Error)?.message ?? err).slice(0, 120));
    return NextResponse.json({ ok: false, error: "try_again" }, { status: 503 });
  }

  // `deadline` must come from chain time, not Date.now(): the contract compares against
  // block.timestamp, and a host clock even slightly ahead issues vouchers that are already expired.
  const now = await readChainTime();
  const deadline = BigInt(now + VOUCHER_TTL_SECONDS);

  // One free pack per PROFILE (lib/db/freeClaims.ts; starl3xx: "only one wallet per profile should get
  // a free anything"): recorded on `ledger` (above) before signing, first key wins; a database error
  // refuses, never signs twice.
  try {
    const claim = await claimFree({
          chainId: NETWORK.id,
          account: ledger,
          kind: "pack",
          period: 0,
          key,
          letters: FREE_LETTERS.pack,
          expiresAt: new Date(Number(deadline) * 1000),
          wallet,
          voucherTtlSeconds: VOUCHER_TTL_SECONDS,
          usedOnchain: async (k) =>
            Boolean(await getPublicClient().readContract({ address: letters, abi: lettersAbi, functionName: "freePackClaimed", args: [k] })),
        });
    if (claim === "taken") return NextResponse.json({ ok: false, error: "already_claimed" }, { status: 409 });
  } catch (err) {
    console.error("[free-pack] couldn't record the profile's free pack, refusing:", String((err as Error)?.message ?? err).slice(0, 120));
    return NextResponse.json({ ok: false, error: "try_again" }, { status: 503 });
  }

  // Deterministic per key so a retry re-issues the identical voucher.
  const nonce = key;
  const signature = await signDigest(freePackDigest({ letters, buyer: wallet as `0x${string}`, fid: key, nonce, deadline }));

  return NextResponse.json({
    ok: true,
    voucher: {
      // A string: X and Coinbase keys are ≥ 2^160, past what a JSON number holds exactly.
      fid: String(key),
      nonce: String(nonce),
      deadline: String(deadline),
      signature,
      letters,
      chainId: NETWORK.id,
    },
  });
}
