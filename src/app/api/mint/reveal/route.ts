import { NextResponse } from "next/server";
import { getAuthedFid } from "@/lib/auth/quickAuth";
import { allow } from "@/lib/ratelimit";
import { clientIp } from "@/lib/auth/clientIp";
import { addressOf, deployBlock } from "@/lib/onchain/addresses";
import { lettersRevealDigest } from "@/lib/onchain/digests";
import { signDigest, drawLetters, dailySeed } from "@/lib/onchain/signer";
import { getPublicClient, readLetterSupply } from "@/lib/onchain/reads";
import { lettersAbi } from "@/lib/onchain/abis";
import { stickyDraw } from "@/lib/onchain/stickyDraw";
import { NETWORK } from "@/lib/onchain/network";
import { getAbiItem } from "viem";
import { relayLettersReveal, relayerConfigured } from "@/lib/onchain/relayer";

/**
 * The letters a commit's reveal MINTED, from its own `Revealed` event (commitId is indexed, so this
 * is one log lookup). Null when the event can't be read: the caller then says the pack is open and
 * names no letters. The event comes from the generated ABI, never a hand copy: a log filter on a
 * changed signature silently matches nothing.
 *
 * Never the draw: `stickyDraw` serves a stored draw again only while it can still be minted, so
 * after a letter caps out it would hand back five DIFFERENT letters for a pack long since opened.
 */
async function readRevealedLetters(commitId: bigint, letters: `0x${string}`): Promise<number[] | null> {
  try {
    const logs = await getPublicClient().getLogs({
      address: letters,
      event: getAbiItem({ abi: lettersAbi, name: "Revealed" }),
      args: { commitId },
      fromBlock: deployBlock(),
      toBlock: "latest",
    });
    const ids = logs[0]?.args.letterIds;
    if (!ids?.length) return null;
    const indexes = ids.map(Number);
    return indexes.every((i) => Number.isInteger(i) && i >= 0 && i <= 25) ? indexes : null;
  } catch {
    return null;
  }
}

/**
 * The (identity, day) a daily commit was minted under, from its FreeDailyMinted event — commitId
 * is indexed there, so this is one log lookup. Null for non-daily count-1 commits (the paid daily,
 * which has no issuance route yet and keeps the commitId-keyed draw).
 */
async function readDailyIdentity(
  commitId: bigint,
  letters: `0x${string}`,
): Promise<{ key: bigint; day: number } | null> {
  const logs = await getPublicClient().getLogs({
    address: letters,
    event: {
      type: "event",
      name: "FreeDailyMinted",
      inputs: [
        { name: "fid", type: "uint256", indexed: true },
        { name: "buyer", type: "address", indexed: true },
        { name: "commitId", type: "uint256", indexed: true },
        { name: "day", type: "uint32", indexed: false },
      ],
    },
    args: { commitId },
    fromBlock: deployBlock(),
    toBlock: "latest",
  });
  const log = logs[0];
  if (!log) return null;
  return { key: log.args.fid as bigint, day: Number(log.args.day) };
}

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// A relayed reveal waits up to RELAY_WAIT_MS for its block; leave room around it.
export const maxDuration = 30;

/**
 * POST — draw and sign the outcome of a letter commit.
 *
 * Shared by all four commit paths: the reveal knows nothing about how the commit was funded, only
 * what `commits(commitId)` says. In particular the digest binds `commits[commitId].buyer` — the
 * STORED committer — not the caller, so a reveal can be relayed by anyone (including us) on behalf
 * of the player who paid.
 *
 * The draw is derived from (chainId, commitId) under the server secret, so this endpoint is
 * idempotent by construction: asking twice returns the identical letters. That is load-bearing —
 * the reveal is permissionless and the signer picks the outcome, so a sampler that rolled fresh each
 * call would let a player re-request until they liked their pack.
 *
 * AUTH IS OPTIONAL, deliberately. Those two properties — buyer-bound signature, idempotent draw —
 * mean this endpoint hands out nothing a caller can spend or reroll; the FID was only ever a
 * rate-limit key. Requiring it anyway would strand the verified-wallet daily (Coinbase-attested
 * players have no Farcaster JWT) with the letter already paid for on-chain. Anonymous callers are
 * bucketed by IP instead.
 *
 * RELAY (`{ relay: true }`, decisions.md #49): the server sends the reveal itself
 * (lib/onchain/relayer), so a pack is ONE wallet confirmation and no wallet prompt names the letters
 * before the game shows them. The answer then says what the chain did:
 * - `relayed: "mined"`, with `letterIndexes` read from the reveal's own event;
 * - `relayed: "already"`: revealed before this request (a lost answer is a normal case, since the
 *   request is held while the reveal mines). `letterIndexes` are again the chain's, from the
 *   `Revealed` event, and are left out if that event can't be read;
 * - `relayed: "pending"` or `"reverted"`: broadcast, not seen to land. NO letters and NO signature:
 *   the letters don't exist yet as far as this answer knows, and a second reveal from the player's
 *   wallet would only revert when the first lands.
 * Without a relayer key, or when the send is refused before broadcast, the answer is the signature
 * as before and the player's wallet sends it. Without `relay: true` the route answers exactly as it
 * always has (a client from before the relay keeps working through a deploy).
 *
 * Body: `{ commitId: "123", relay?: true }`
 */
export async function POST(req: Request) {
  const fid = await getAuthedFid(req);
  if (!(await allow("record-add", fid ?? clientIp(req))))
    return NextResponse.json({ ok: false, error: "rate_limited" }, { status: 429 });

  let commitIdRaw: string | undefined;
  let wantRelay = false;
  try {
    const body = await req.json();
    commitIdRaw = body?.commitId;
    wantRelay = body?.relay === true;
  } catch {
    /* handled below */
  }
  if (!commitIdRaw || !/^\d+$/.test(String(commitIdRaw))) {
    return NextResponse.json({ ok: false, error: "bad_commit_id" }, { status: 400 });
  }
  const commitId = BigInt(commitIdRaw);

  const letters = addressOf("letters");
  const client = getPublicClient();

  // An out-of-range commitId panics (0x32) on the dynamic array before the contract's own BadCommit
  // check can run, so a stale id surfaces as a raw panic rather than a named error. Translate it.
  let commit: { buyer: `0x${string}`; count: number; revealed: boolean };
  try {
    const raw = (await client.readContract({
      address: letters,
      abi: lettersAbi,
      functionName: "commits",
      args: [commitId],
    })) as unknown as readonly [string, number, boolean];
    commit = { buyer: raw[0] as `0x${string}`, count: Number(raw[1]), revealed: Boolean(raw[2]) };
  } catch {
    return NextResponse.json({ ok: false, error: "unknown_commit" }, { status: 404 });
  }

  if (!commit.buyer || commit.buyer === "0x0000000000000000000000000000000000000000") {
    return NextResponse.json({ ok: false, error: "unknown_commit" }, { status: 404 });
  }
  if (commit.revealed) {
    if (!wantRelay) return NextResponse.json({ ok: false, error: "already_revealed" }, { status: 409 });
    // Open already: what it held is the chain's to say, from the reveal's own event.
    const minted = await readRevealedLetters(commitId, letters);
    return NextResponse.json({
      ok: true,
      reveal: { commitId: String(commitId), buyer: commit.buyer, ...(minted ? { letterIndexes: minted } : {}), relayed: "already" },
    });
  }

  // Never draw a capped letter — Letters.reveal reverts CapExceeded and the paid commit is stranded.
  const { available } = await readLetterSupply();
  let letterIndexes: number[];
  try {
    // DAILY commits (count 1) draw from the (identity, day) seed, not the commitId — the SAME
    // derivation the free-daily bundle pre-signs. If this route drew commitId-keyed instead, a
    // player could commit, decline the bundled reveal, and come back here for a second, different
    // draw — two letters to choose from. One identity-day, one draw, everywhere.
    const daily = commit.count === 1 ? await readDailyIdentity(commitId, letters) : null;
    // Sticky: the first draw served for this pack (or this identity-day) is served again while it
    // can still be minted, so a cap-out can't hand one commit a second valid draw (stickyDraw.ts).
    // The daily key matches the one /api/mint/free-daily uses when it pre-signs the bundle. A pack's
    // key names the Letters contract: commit ids restart on a redeploy, and a row stored for the old
    // contract's commit N must never be served for the new one's (its letters are public onchain).
    letterIndexes = await stickyDraw({
      chainId: NETWORK.id,
      key: daily ? `d:${daily.key}:${daily.day}` : `c:${letters.toLowerCase()}:${commitId}`,
      count: commit.count,
      available,
      draw: () =>
        daily
          ? drawLetters(letters, dailySeed(daily.key, daily.day), 1, available, "daily")
          : drawLetters(letters, commitId, commit.count, available),
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: "no_supply", detail: (err as Error).message },
      { status: 503 },
    );
  }

  const inner = lettersRevealDigest({ letters, commitId, buyer: commit.buyer, letterIndexes });
  const signature = await signDigest(inner);

  if (wantRelay && relayerConfigured()) {
    const r = await relayLettersReveal(commitId, letterIndexes, signature);
    const facts = { commitId: String(commitId), buyer: commit.buyer };
    if (r.kind === "mined") {
      // The letters as the chain minted them (the reveal's own event), not the draw that was signed.
      return NextResponse.json({ ok: true, reveal: { ...facts, letterIndexes: r.letterIndexes, relayed: "mined", txHash: r.txHash } });
    }
    if (r.kind === "pending" || r.kind === "reverted") {
      // Broadcast: the player's wallet must NOT send a second reveal, and no letter is named yet.
      return NextResponse.json({ ok: true, reveal: { ...facts, relayed: r.kind, txHash: r.txHash } });
    }
    console.warn(`[mint/reveal] relay unavailable (${r.reason}); the player's wallet sends commit ${commitId}`);
    // Nothing was broadcast: fall through to the signature, and the wallet sends it.
  }

  return NextResponse.json({
    ok: true,
    reveal: {
      commitId: String(commitId),
      buyer: commit.buyer,
      letterIndexes,
      signature,
    },
  });
}
