import { NextResponse } from "next/server";
import { getAuthedFid } from "@/lib/auth/quickAuth";
import { allow } from "@/lib/ratelimit";
import { addressOf } from "@/lib/onchain/addresses";
import { freeDailyDigest, lettersRevealDigest, chainDay } from "@/lib/onchain/digests";
import { signDigest, drawLetters, dailySeed } from "@/lib/onchain/signer";
import { getPublicClient, readChainTime, readLetterSupply } from "@/lib/onchain/reads";
import { lettersAbi } from "@/lib/onchain/abis";
import { stickyDraw } from "@/lib/onchain/stickyDraw";
import { NETWORK } from "@/lib/onchain/network";
import { dailyKeysFor, isCoinbaseVerified, verifiedDailyKey, xDailyKey } from "@/lib/onchain/verifications";
import { getProfile } from "@/lib/db/profiles";
import { claimDraw, readDraw } from "@/lib/db/draws";
import { relatedDailyKeys } from "@/lib/onchain/dailyIdentity";
import { profilesEnabled } from "@/lib/profile/session";
import { xEnabled } from "@/lib/profile/x";
import { xOldEnough } from "@/lib/profile/rules";
import { isAddress } from "viem";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Ten minutes, further clamped to the UTC day — see below. */
const VOUCHER_TTL_SECONDS = 600;

/**
 * POST — issue the free daily voucher. Body: `{ wallet: "0x..." }`
 *
 * The whole Sybil gate is this signature: the contract never validates the daily key, it only
 * checks that the signer blessed the (contract, chain, kind, buyer, key, day, deadline) tuple. Three
 * identities can earn one, and they live in DISJOINT uint256 namespaces (verifications.ts):
 *
 *   FARCASTER — the fid from the verified Quick Auth JWT, and nowhere else. Small ints (< 2^32).
 *   X — an X account linked to THIS wallet through the profile (a signed wallet session plus X's
 *     own OAuth), older than 90 days at claim time, while X is switched on. Keyed `2^162 | xUserId`.
 *   VERIFIED WALLET — a wallet holding a live Coinbase Verified Account attestation on Base
 *     mainnet (KYC-backed). Keyed `2^160 | uint160(address)` — always ≥ 2^160, always bigint,
 *     because `dailyUsed` is one shared mapping and a synthetic key that came out small would
 *     consume a real FID's slot.
 *
 * Order: the JWT, then X, then Coinbase, so a signed-in player's daily always lands on their FID —
 * their streak doesn't fork the day they link something else. And ONE letter a day per player:
 * before signing, every key this request can see (the FID, this wallet's X, this wallet's Coinbase
 * key) is read, and any one used today refuses the daily. Linking more accounts never adds letters.
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
  // The X account linked to this wallet, if any. A profile read that fails (or a database without
  // migration 0006) just means no X: the other two paths still work.
  const xRow = profilesEnabled() ? await getProfile(wallet).catch(() => null) : null;
  const xUserId = xRow?.xUserId ?? null;
  const xCounts = Boolean(xUserId) && xEnabled() && xOldEnough(xRow?.xCreatedAt);
  if (fid) {
    if (!(await allow("record-add", fid)))
      return NextResponse.json({ ok: false, error: "rate_limited" }, { status: 429 });
    key = BigInt(fid);
  } else if (xCounts && xUserId) {
    if (!(await allow("record-add", wallet.toLowerCase())))
      return NextResponse.json({ ok: false, error: "rate_limited" }, { status: 429 });
    key = xDailyKey(xUserId);
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
      // A linked X that is too young is the likeliest reason here: say so, so the client can show
      // the day it unlocks instead of asking the player to verify something else.
      const error = xUserId && xEnabled() && !xCounts ? "x_too_young" : "verification_required";
      return NextResponse.json({ ok: false, error }, { status: 403 });
    }
    key = verifiedDailyKey(wallet);
  }

  const letters = addressOf("letters");

  // Chain time, never Date.now(): the contract compares against block.timestamp, and a host clock
  // slightly ahead issues vouchers that are already expired.
  const now = await readChainTime();
  const today = chainDay(now);

  // dailyUsed stores day+1 so that 0 can mean "never" — comparing against the raw day is off by one.
  // Every key this player could claim under, not just today's: one letter a day, however many
  // accounts are linked. That includes a FID this request didn't sign in with, and the other
  // wallets of the player's Farcaster accounts (relatedDailyKeys).
  const { all } = dailyKeysFor({ fid, xUserId, xCounts, wallet });
  const keys = [...new Set([key, ...all, ...(await relatedDailyKeys({ fid, wallet }))])];
  const used = (await getPublicClient().multicall({
    allowFailure: false,
    contracts: keys.map((k) => ({ address: letters, abi: lettersAbi, functionName: "dailyUsed" as const, args: [k] })),
  })) as unknown as (number | bigint)[];
  if (used.some((u) => Number(u) === today + 1)) {
    return NextResponse.json({ ok: false, error: "already_claimed_today" }, { status: 409 });
  }

  const nextMidnight = (today + 1) * 86_400;
  const deadline = BigInt(Math.min(now + VOUCHER_TTL_SECONDS, nextMidnight - 1));

  // An X-keyed voucher must leave a record BEFORE it's signed: the X account's unlink/move/replace
  // guard (xKeyUsedToday) reads today's stored draw, and a voucher is spendable for ten minutes
  // before the chain slot is. The bundle's sticky draw writes the same row, but it can be skipped or
  // fail open, so for X it's written here and a failed write refuses (Bugbot on #138). Same seed,
  // same letter, so the bundle and any later reveal agree with it.
  if (xCounts && xUserId && !fid && key === xDailyKey(xUserId)) {
    try {
      const drawKey = `d:${key}:${today}`;
      if (!(await readDraw(NETWORK.id, drawKey))) {
        const { available } = await readLetterSupply();
        await claimDraw(NETWORK.id, drawKey, drawLetters(dailySeed(key, today), 1, available, "daily"));
      }
    } catch (err) {
      console.error("[free-daily] couldn't record the X daily, refusing:", String((err as Error)?.message ?? err).slice(0, 120));
      return NextResponse.json({ ok: false, error: "try_again" }, { status: 503 });
    }
  }

  const signature = await signDigest(
    freeDailyDigest({ letters, buyer: wallet as `0x${string}`, fid: key, today, deadline }),
  );

  // THE BUNDLE — commit + reveal pre-signed together, so the wallet can do the whole daily in one
  // prompt (5792 batch) or two back-to-back prompts with no polling gap (the gap is where the
  // first live daily lost its reveal and stranded).
  //
  // The reveal signature binds the PREDICTED commitId (= commits.length — _newCommit assigns
  // array-index ids). If another commit lands first, the bundled reveal reverts and the stranded-
  // commit recovery finishes the pull with IDENTICAL letters — because the draw is seeded by
  // (identity, day), not commitId. That seeding is also what makes pre-signing safe at all: the
  // response reveals the letter before anything is sent, and a commitId-keyed draw would let a
  // player re-request as traffic shifts the counter until they liked the answer. Per (identity,
  // day) there is nothing to shop — asking twice is the same letter, which is exactly the one-
  // draw-per-identity-day the two-phase flow produced anyway.
  let bundle: { predictedCommitId: string; letterIndexes: number[]; revealSignature: string } | null = null;
  try {
    const [commitCount, { available }] = await Promise.all([
      getPublicClient().readContract({
        address: letters,
        abi: lettersAbi,
        functionName: "commitCount",
      }) as Promise<bigint>,
      readLetterSupply(),
    ]);
    // Same stored draw as /api/mint/reveal's daily path (key `d:<identity>:<day>`), so the bundle
    // and a later two-phase reveal can never hold two different valid letters.
    const letterIndexes = await stickyDraw({
      chainId: NETWORK.id,
      key: `d:${key}:${today}`,
      count: 1,
      available,
      draw: () => drawLetters(dailySeed(key, today), 1, available, "daily"),
    });
    const revealSignature = await signDigest(
      lettersRevealDigest({ letters, commitId: commitCount, buyer: wallet as `0x${string}`, letterIndexes }),
    );
    bundle = { predictedCommitId: String(commitCount), letterIndexes, revealSignature };
  } catch (err) {
    // The bundle is an optimization, never a gate — without it the client falls back to the
    // two-phase flow, which still works.
    console.error("[free-daily] bundle unavailable, two-phase fallback:", err);
  }

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
    bundle,
  });
}
