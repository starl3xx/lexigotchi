/**
 * The server finishes a roll or an ascension attempt: it sends the reveal itself, so the player
 * confirms ONE transaction (the paid commit) and learns the result from the game, not from a wallet
 * prompt in the middle of it.
 *
 * Why (decisions.md #14): a roll's reveal was the player's second transaction, and the wallet's
 * simulation showed "+NFT" for a hit and nothing for a miss before the game's animation played.
 * Ascension had the same second prompt, landing while the word's letters stood with their eyes shut
 * (decisions.md #36 named this as its follow-up). `Rolls.reveal` and `Prestige.reveal` are both
 * permissionless (the signature binds the commit's owner and outcome, and the outcome is fixed per
 * commitId), so anyone may relay them; this is the game doing so.
 *
 * Every relayed write carries the builder code (ERC-8021 `dataSuffix`), like the keeper's: it is
 * an app write (tests/no-write-bypass.test.ts holds this file to that).
 *
 * The key is its OWN hot key (RELAYER_PRIVATE_KEY), never the keeper's: the keeper cron assumes
 * one key, one nonce. Serverless instances share nothing in memory, so two reveals at once can
 * race for a nonce; a nonce error is retried with a fresh pending nonce. A repeat request for the
 * same commit on the same instance reuses the first send (`inflight`); across instances a rare
 * duplicate reverts on chain (AlreadyRevealed) and costs a fraction of a cent.
 */
import { createWalletClient, decodeEventLog, publicActions, type Hash, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { ACTIVE_CHAIN } from "./chain";
import { rpcTransport } from "./transport";
import { BUILDER_DATA_SUFFIX } from "./builderCode";
import { prestigeAbi, rollsAbi, wordsAbi } from "./abis";
import { addressOf } from "./addresses";
import { prestigeRevealOutcome } from "./relayOutcome";

/**
 * What happened to a relayed reveal.
 * - `mined`: on chain. The outcome is read from the reveal's own event, so it is exact even when a
 *   signed success no longer applied (that reveal emits the "failed" event with pity unchanged).
 * - `pending`: broadcast, not mined within the wait. Never fall back to the player's wallet here:
 *   that reveal would revert once ours lands.
 * - `reverted`: mined but reverted (another reveal of this commit won a race). The chain has it.
 * - `unavailable`: nothing was broadcast (no key, no funds, the send was refused). The caller hands
 *   the player the signature and their wallet sends it, as before relaying existed.
 */
type Unmined = { kind: "pending"; txHash: Hash } | { kind: "reverted"; txHash: Hash } | { kind: "unavailable"; reason: string };

export type RollRelay = { kind: "mined"; txHash: Hash; success: boolean; pity: number } | Unmined;

/**
 * An ascension's relayed reveal. `mined` carries where the reveal left the word: its stage and its
 * misses in a row. `level` is null when the one thing the event doesn't say (the level after a
 * "failed" reveal) couldn't be read at the reveal's block; the game then reads it itself.
 */
export type PrestigeRelay = { kind: "mined"; txHash: Hash; success: boolean; level: number | null; pity: number } | Unmined;

/** How long the route waits for the reveal to be mined. Base makes a block every 2 s. */
export const RELAY_WAIT_MS = 20_000;

const NONCE_RACE = /nonce too low|nonce has already been used|replacement transaction underpriced|already known/i;
/**
 * Sends in flight, by contract AND commit: "roll:7" and "prestige:7" are different commits (each
 * contract counts its own), and one key for both would answer an ascension with a roll's result.
 */
const inflight = new Map<string, Promise<RollRelay | PrestigeRelay>>();

export function relayerConfigured(): boolean {
  return !!process.env.RELAYER_PRIVATE_KEY;
}

/** One send per (contract, commit) at a time on this instance; repeats get the first one's answer. */
function once<T extends RollRelay | PrestigeRelay>(key: string, send: () => Promise<T>): Promise<T> {
  const existing = inflight.get(key);
  if (existing) return existing as Promise<T>;
  const p = send().finally(() => {
    // Keep answering repeats for a minute, then forget: by then the chain says `revealed`.
    setTimeout(() => inflight.delete(key), 60_000);
  });
  inflight.set(key, p);
  return p;
}

/** Send `Rolls.reveal(commitId, success, signature)` from the relayer key and wait for it. */
export function relayRollReveal(commitId: bigint, success: boolean, signature: Hex): Promise<RollRelay> {
  return once(`roll:${commitId}`, () => sendRollReveal(commitId, success, signature));
}

/** Send `Prestige.reveal(commitId, success, signature)` from the relayer key and wait for it. */
export function relayPrestigeReveal(commitId: bigint, success: boolean, signature: Hex): Promise<PrestigeRelay> {
  return once(`prestige:${commitId}`, () => sendPrestigeReveal(commitId, success, signature));
}

function relayerClient(pk: string) {
  return createWalletClient({
    account: privateKeyToAccount(pk as Hex),
    chain: ACTIVE_CHAIN,
    // rpcTransport, never bare http(): the Alchemy key's domain allowlist rejects originless calls.
    transport: rpcTransport(process.env.NEXT_PUBLIC_RPC_URL || undefined),
  }).extend(publicActions);
}

/**
 * Broadcast one reveal (a nonce race is retried with a fresh pending nonce), then wait for its
 * receipt. `write` is the contract call; it is passed in so each write stays in the function that
 * names its contract, with its builder suffix beside it (the test that counts them reads this file
 * as text, so the call is not spelled out here).
 */
async function broadcast(
  w: ReturnType<typeof relayerClient>,
  write: () => Promise<Hash>,
): Promise<Unmined | { kind: "landed"; txHash: Hash; receipt: Awaited<ReturnType<typeof w.waitForTransactionReceipt>> }> {
  let hash: Hash | undefined;
  for (let attempt = 0; !hash; attempt++) {
    try {
      hash = await write();
    } catch (err) {
      const msg = String((err as Error)?.message ?? err);
      if (attempt < 2 && NONCE_RACE.test(msg)) {
        await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
        continue;
      }
      // Never the raw error: it can quote the RPC URL, and that URL carries the provider key.
      return { kind: "unavailable", reason: /insufficient funds/i.test(msg) ? "relayer_unfunded" : "send_failed" };
    }
  }
  let receipt;
  try {
    receipt = await w.waitForTransactionReceipt({ hash, timeout: RELAY_WAIT_MS });
  } catch {
    return { kind: "pending", txHash: hash };
  }
  if (receipt.status !== "success") return { kind: "reverted", txHash: hash };
  return { kind: "landed", txHash: hash, receipt };
}

async function sendRollReveal(commitId: bigint, success: boolean, signature: Hex): Promise<RollRelay> {
  const pk = process.env.RELAYER_PRIVATE_KEY;
  if (!pk) return { kind: "unavailable", reason: "no_relayer" };
  const rolls = addressOf("rolls");
  const w = relayerClient(pk);
  const sent = await broadcast(w, () =>
    w.writeContract({
      dataSuffix: BUILDER_DATA_SUFFIX, // ERC-8021: the relayer's writes are app writes too
      address: rolls,
      abi: rollsAbi,
      functionName: "reveal",
      args: [commitId, success, signature],
    }),
  );
  if (sent.kind !== "landed") return sent;

  for (const log of sent.receipt.logs) {
    if (log.address.toLowerCase() !== rolls.toLowerCase()) continue;
    try {
      const ev = decodeEventLog({ abi: rollsAbi, data: log.data, topics: log.topics });
      if (ev.eventName === "RollSucceeded") return { kind: "mined", txHash: sent.txHash, success: true, pity: 0 };
      if (ev.eventName === "RollFailed") {
        const args = ev.args as { pity: number | bigint };
        return { kind: "mined", txHash: sent.txHash, success: false, pity: Number(args.pity) };
      }
    } catch {
      /* another event of this contract; keep looking */
    }
  }
  // Mined and successful, but no outcome event: impossible for Rolls.reveal. Say only what we know.
  return { kind: "pending", txHash: sent.txHash };
}

async function sendPrestigeReveal(commitId: bigint, success: boolean, signature: Hex): Promise<PrestigeRelay> {
  const pk = process.env.RELAYER_PRIVATE_KEY;
  if (!pk) return { kind: "unavailable", reason: "no_relayer" };
  const prestige = addressOf("prestige");
  const w = relayerClient(pk);
  const sent = await broadcast(w, () =>
    w.writeContract({
      dataSuffix: BUILDER_DATA_SUFFIX, // ERC-8021: the relayer's writes are app writes too
      address: prestige,
      abi: prestigeAbi,
      functionName: "reveal",
      args: [commitId, success, signature],
    }),
  );
  if (sent.kind !== "landed") return sent;

  // What the chain did, from the reveal's own event (lib/onchain/relayOutcome says why).
  const outcome = prestigeRevealOutcome(sent.receipt.logs, prestige);
  // Mined and successful, but no outcome event: impossible for Prestige.reveal. Say only what we know.
  if (!outcome) return { kind: "pending", txHash: sent.txHash };
  // A hit resets the pity (Prestige.reveal), and its event names the new level.
  if (outcome.success) return { kind: "mined", txHash: sent.txHash, success: true, level: outcome.level, pity: 0 };
  // A "failed" event names the pity but not the level. Read it AT the reveal's block, so it is the
  // level that reveal left and not one a later block changed. If the read fails the level is null
  // and the game reads it itself; it is never guessed.
  let level: number | null = null;
  try {
    level = Number(
      await w.readContract({
        address: addressOf("words"),
        abi: wordsAbi,
        functionName: "prestigeLevel",
        args: [outcome.tokenId],
        blockNumber: sent.receipt.blockNumber,
      }),
    );
  } catch {
    /* leave it null */
  }
  return { kind: "mined", txHash: sent.txHash, success: false, level, pity: outcome.pity };
}
