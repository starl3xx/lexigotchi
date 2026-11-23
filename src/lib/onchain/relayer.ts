/**
 * The server finishes a roll: it sends `Rolls.reveal` itself, so the player confirms ONE transaction
 * per roll (the paid commit) and learns the result from the game, not from a wallet preview.
 *
 * Why (decisions.md #14): the reveal was the player's second transaction, and the wallet's
 * simulation showed "+NFT" for a hit and nothing for a miss before the game's animation played.
 * `Rolls.reveal` is permissionless (the signature binds the commit's owner and outcome, and the
 * outcome is fixed per commitId), so anyone may relay it; this is the game doing so.
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
import { rollsAbi } from "./abis";
import { addressOf } from "./addresses";

/**
 * What happened to a relayed reveal.
 * - `mined`: on chain. The outcome is read from the reveal's own event, so it is exact even when a
 *   signed success no longer applied (that reveal emits RollFailed with pity unchanged).
 * - `pending`: broadcast, not mined within the wait. Never fall back to the player's wallet here:
 *   that reveal would revert once ours lands.
 * - `reverted`: mined but reverted (another reveal of this commit won a race). The chain has it.
 * - `unavailable`: nothing was broadcast (no key, no funds, the send was refused). The caller hands
 *   the player the signature and their wallet sends it, as before relaying existed.
 */
export type RollRelay =
  | { kind: "mined"; txHash: Hash; success: boolean; pity: number }
  | { kind: "pending"; txHash: Hash }
  | { kind: "reverted"; txHash: Hash }
  | { kind: "unavailable"; reason: string };

/** How long the route waits for the reveal to be mined. Base makes a block every 2 s. */
export const RELAY_WAIT_MS = 20_000;

const NONCE_RACE = /nonce too low|nonce has already been used|replacement transaction underpriced|already known/i;
const inflight = new Map<string, Promise<RollRelay>>();

export function relayerConfigured(): boolean {
  return !!process.env.RELAYER_PRIVATE_KEY;
}

/** Send `Rolls.reveal(commitId, success, signature)` from the relayer key and wait for it. */
export function relayRollReveal(commitId: bigint, success: boolean, signature: Hex): Promise<RollRelay> {
  const key = commitId.toString();
  const existing = inflight.get(key);
  if (existing) return existing;
  const p = send(commitId, success, signature).finally(() => {
    // Keep answering repeats for a minute, then forget: by then the chain says `revealed`.
    setTimeout(() => inflight.delete(key), 60_000);
  });
  inflight.set(key, p);
  return p;
}

async function send(commitId: bigint, success: boolean, signature: Hex): Promise<RollRelay> {
  const pk = process.env.RELAYER_PRIVATE_KEY;
  if (!pk) return { kind: "unavailable", reason: "no_relayer" };
  const rolls = addressOf("rolls");
  const w = createWalletClient({
    account: privateKeyToAccount(pk as Hex),
    chain: ACTIVE_CHAIN,
    // rpcTransport, never bare http(): the Alchemy key's domain allowlist rejects originless calls.
    transport: rpcTransport(process.env.NEXT_PUBLIC_RPC_URL || undefined),
  }).extend(publicActions);

  let hash: Hash | undefined;
  for (let attempt = 0; !hash; attempt++) {
    try {
      hash = await w.writeContract({
        dataSuffix: BUILDER_DATA_SUFFIX, // ERC-8021: the relayer's writes are app writes too
        address: rolls,
        abi: rollsAbi,
        functionName: "reveal",
        args: [commitId, success, signature],
      });
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

  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== rolls.toLowerCase()) continue;
    try {
      const ev = decodeEventLog({ abi: rollsAbi, data: log.data, topics: log.topics });
      if (ev.eventName === "RollSucceeded") return { kind: "mined", txHash: hash, success: true, pity: 0 };
      if (ev.eventName === "RollFailed") {
        const args = ev.args as { pity: number | bigint };
        return { kind: "mined", txHash: hash, success: false, pity: Number(args.pity) };
      }
    } catch {
      /* another event of this contract; keep looking */
    }
  }
  // Mined and successful, but no outcome event: impossible for Rolls.reveal. Say only what we know.
  return { kind: "pending", txHash: hash };
}
