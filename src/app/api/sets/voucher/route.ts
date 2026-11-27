/**
 * POST /api/sets/voucher: the voucher `Words.claim` needs for a word of a newly released set on
 * its first day (decisions.md, "Reserved word sets"; Words.sol `gatedUntil`).
 *
 * Body: `{ wallet, word }`. `wallet` is the one that will send the claim: the voucher names it, so
 * one read out of the mempool is useless to anyone else.
 *
 * Who gets one:
 *  - A VERIFIED profile only: Farcaster, a linked X account older than 90 days, or a
 *    Coinbase-verified wallet, exactly as the free letters decide it (`resolveFreeIdentity`).
 *  - At most the set's `per_player_limit` DIFFERENT words per PROFILE, across all its wallets,
 *    counted from vouchers issued (lib/sets/voucher.ts says why never from words held). The row is
 *    written before the voucher is signed; a voucher that expires unused gives its slot back, read
 *    from the chain's own `Claimed` history.
 *  - On a set whose first day has a rule of its own (an allowlist, or holders of a token on Base):
 *    the CLAIMING wallet must be one the rule lets in (lib/sets/firstDay.ts). This adds to "verified".
 *  - A caller who PROVES the wallet is theirs: that wallet's profile session, or a Farcaster
 *    sign-in that Farcaster itself says verified one of the profile's wallets. Unlike the free
 *    snack's voucher, this one spends something scarce (the profile's one slot, on a word the
 *    caller names), so the wallet in the body can't just be the client's word: a stranger could
 *    name your wallet and a word you don't want, again each time it expired, for the whole day.
 *
 * Every refusal says which rule it was, so the game can explain it. A database or chain read that
 * fails refuses (`try_again`): read as "nothing issued yet", a failure would hand out a second word.
 */
import { NextResponse } from "next/server";
import { getAbiItem, getAddress, isAddress } from "viem";
import { allow } from "@/lib/ratelimit";
import { clientIp } from "@/lib/auth/clientIp";
import { getAuthedFid } from "@/lib/auth/quickAuth";
import { isWord } from "@/lib/dictionary";
import { addressOf, deployBlock, isSuiteDeployed } from "@/lib/onchain/addresses";
import { wordsAbi } from "@/lib/onchain/abis";
import { gatedClaimDigest } from "@/lib/onchain/digests";
import { resolveFreeIdentity } from "@/lib/onchain/freeIdentity";
import { getPublicClient, readChainTime } from "@/lib/onchain/reads";
import { getLogsAdaptive } from "@/lib/onchain/logs";
import { signDigest } from "@/lib/onchain/signer";
import { tokenIdOf } from "@/lib/onchain/tokenId";
import { NETWORK } from "@/lib/onchain/network";
import { fidsByAddressesDetailed } from "@/lib/neynar";
import { sessionAddress } from "@/lib/profile/session";
import { accountWalletsStrict } from "@/lib/db/walletLinks";
import { settleVouchers, takeVoucher } from "@/lib/db/setVouchers";
import { cleanWord } from "@/lib/sets/rules";
import { hasGate, loadSets } from "@/lib/sets/server";
import { firstDayOpenTo } from "@/lib/sets/firstDay";
import { VOUCHER_TTL_SECONDS, walletsToAsk, type VoucherRow } from "@/lib/sets/voucher";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };
const no = (error: string, status: number, more: Record<string, unknown> = {}) =>
  NextResponse.json({ ok: false, error, ...more }, { status, headers: NO_STORE });
const short = (err: unknown) => String((err as { code?: string; name?: string })?.code ?? (err as Error)?.name ?? "error").slice(0, 40);

// From the generated ABI, never a hand copy: a filter on a stale signature silently matches nothing.
const CLAIMED = getAbiItem({ abi: wordsAbi, name: "Claimed" });

/** Base makes a block every 2 seconds. Used only to pick where a log read STARTS, with room to spare. */
const BLOCK_SECONDS = 2;
/** Blocks of slack before a row's first voucher: ten minutes, for a chain that ran a little fast. */
const START_SLACK_BLOCKS = 300n;

/**
 * Did ANY wallet this row's vouchers were signed for, or any wallet of the profile, claim
 * `row.word` since the row's first voucher? The chain's own history, never who holds the word now,
 * and never only the wallet the row names last: a renewal from a linked wallet leaves the first
 * wallet's voucher spendable. Null when it can't be read.
 *
 * Read from about when the row was first made (no voucher for it existed earlier), never from the
 * set's release: a public RPC refuses a `getLogs` over a day of blocks, and a read that always
 * fails would leave an unused voucher holding its slot for the whole first day. The read also
 * halves its span while an RPC refuses it (`getLogsAdaptive`).
 */
async function claimedByProfile(row: VoucherRow, profileWallets: readonly string[], floor: bigint): Promise<boolean | null> {
  try {
    const client = getPublicClient();
    const latest = await client.getBlock();
    const age = Math.max(0, Number(latest.timestamp) - Math.floor(row.createdAt.getTime() / 1000));
    const back = BigInt(Math.ceil((age / BLOCK_SECONDS) * 1.25)) + START_SLACK_BLOCKS;
    const from = latest.number - back > floor ? latest.number - back : floor;
    const logs = await getLogsAdaptive(client, {
      address: addressOf("words"),
      event: CLAIMED,
      args: { tokenId: tokenIdOf(row.word), owner: walletsToAsk(row, profileWallets).map((w) => getAddress(w)) },
      fromBlock: from,
      toBlock: latest.number,
    });
    return logs.length > 0;
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  if (!(await allow("set-voucher-ip", clientIp(req)))) return no("rate_limited", 429);
  const body = (await req.json().catch(() => null)) as { wallet?: unknown; word?: unknown } | null;
  const wallet = typeof body?.wallet === "string" && isAddress(body.wallet) ? body.wallet.toLowerCase() : null;
  const word = cleanWord(body?.word);
  if (!wallet || !word || !isWord(word)) return no("bad_request", 400);
  if (!(await allow("set-voucher", wallet))) return no("rate_limited", 429);
  // No gate on this network's Words: there is nothing to vouch for, and the plain claim is the claim.
  if (!isSuiteDeployed() || !hasGate()) return no("not_gated", 409);

  const book = await loadSets();
  if (!book.known) return no("try_again", 503);
  const set = book.sets.find((s) => s.status === "released" && s.words.some((w) => w.word === word));
  // Not a word of any released set: nothing this route signs. (Never says whether an unreleased set has it.)
  if (!set) return no("not_gated", 409);

  const words = addressOf("words");
  const tokenId = tokenIdOf(word);
  let now: number;
  let until: number;
  let taken: boolean;
  try {
    const client = getPublicClient();
    const [t, g, e] = await Promise.all([
      readChainTime(),
      client.readContract({ address: words, abi: wordsAbi, functionName: "gatedUntil", args: [tokenId] }),
      client.readContract({ address: words, abi: wordsAbi, functionName: "exists", args: [tokenId] }),
    ]);
    now = t;
    until = Number(g);
    taken = Boolean(e);
  } catch (err) {
    console.error("[sets/voucher] the chain couldn't be read:", short(err));
    return no("try_again", 503);
  }
  // The chain decides whether the gate is up, never the set's stored time.
  if (until <= now) return no("not_gated", 409);
  if (taken) return no("taken", 409);

  // The profile, read strictly: read as unlinked on a failure, a wallet would be a profile of its
  // own and could take a second word.
  let account: string;
  let wallets: string[];
  try {
    ({ account, wallets } = await accountWalletsStrict(wallet));
  } catch (err) {
    console.error("[sets/voucher] the profile couldn't be read:", short(err));
    return no("try_again", 503);
  }

  // Verified, as the free letters decide it.
  const id = await resolveFreeIdentity(req, wallet, "sets/voucher");
  if (!id.ok) return no(id.error, id.status, { until });

  // And the caller's own wallet: its profile session, or a Farcaster sign-in Farcaster ties to it.
  const signedInAs = sessionAddress(req);
  let proven = signedInAs !== null && wallets.includes(signedInAs);
  if (!proven) {
    const fid = await getAuthedFid(req);
    if (fid) {
      const { fids } = await fidsByAddressesDetailed(wallets).catch(() => ({ fids: new Map<string, number[]>() }));
      proven = [...fids.values()].some((list) => list.includes(fid));
    }
  }
  if (!proven) return no("sign_in", 401, { until });

  // Who this set's first day is open to (an allowlist, or holders of a token). After verification,
  // never in its place; and a list or a balance that can't be read issues nothing. It is asked of
  // the wallet that will CLAIM, never of the whole profile: a listed wallet linked into one
  // verified profile after another would otherwise let each of them in (lib/sets/firstDay.ts).
  const open = await firstDayOpenTo(set, [wallet]);
  if (open === null) return no("try_again", 503);
  if (!open) {
    // Say so when another wallet of the profile would be let in: the fix is to claim with that one.
    const others = wallets.filter((w) => w !== wallet);
    const linked = others.length > 0 && (await firstDayOpenTo(set, others)) === true;
    return no("not_on_list", 403, { until, rule: set.gateRule, label: set.gateLabel, linked });
  }

  const deadline = now + VOUCHER_TTL_SECONDS;
  try {
    const from = set.releaseBlock !== null ? BigInt(set.releaseBlock) : deployBlock();
    await settleVouchers(NETWORK.id, set.id, account, wallets, now, (row) => claimedByProfile(row, wallets, from));
    const took = await takeVoucher({
      chainId: NETWORK.id,
      setId: set.id,
      account,
      wallets,
      wallet,
      word,
      limit: set.perPlayerLimit,
      deadline: new Date(deadline * 1000),
    });
    if (!took.ok) return no("limit_reached", 409, { words: took.words, limit: set.perPlayerLimit, until });
  } catch (err) {
    console.error("[sets/voucher] the vouchers couldn't be read or written:", short(err));
    return no("try_again", 503);
  }

  const sig = await signDigest(gatedClaimDigest({ words, caller: getAddress(wallet), tokenId, deadline: BigInt(deadline) }));
  return NextResponse.json({ ok: true, voucher: { deadline: String(deadline), sig }, until }, { headers: NO_STORE });
}
