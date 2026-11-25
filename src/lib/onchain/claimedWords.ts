/**
 * How many dictionary words are claimed right now: every word Words has ever emitted `Claimed` for,
 * less the dissolved ones (`ownerOf` reverts for a burned word; a staked word is held by Staking, so it
 * still counts). The free-letter stop reads it (decisions.md #21: free grants end at about 95%). The
 * same scan the keeper and the world use, reduced to a count; this app has no separate indexer yet
 * (decisions.md #10), so the result is cached for five minutes per server instance.
 *
 * Null when it can't be read: the stop is then skipped, never applied to everyone by an outage.
 */
import { getAbiItem } from "viem";
import { getPublicClient } from "./reads";
import { addressOf, deployBlock, isSuiteDeployed } from "./addresses";
import { wordsAbi } from "./abis";

// From the generated ABI, never a hand copy: a filter on a stale signature silently matches nothing.
const CLAIMED = getAbiItem({ abi: wordsAbi, name: "Claimed" });
const TTL_MS = 5 * 60_000;

let cached: { at: number; n: number } | null = null;
let inflight: Promise<number> | null = null;

async function scan(): Promise<number> {
  const client = getPublicClient();
  const words = addressOf("words");
  const logs = await client.getLogs({ address: words, event: CLAIMED, fromBlock: deployBlock(), toBlock: "latest" });
  const ids = [...new Set(logs.map((l) => String(l.args.tokenId)))].map(BigInt);
  if (ids.length === 0) return 0;
  const owners = await client.multicall({
    allowFailure: true, // ownerOf REVERTS for a dissolved word: it drops out
    contracts: ids.map((id) => ({ address: words, abi: wordsAbi, functionName: "ownerOf" as const, args: [id] })),
  });
  return owners.filter((o) => o.status === "success" && !/^0x0{40}$/i.test(String(o.result))).length;
}

export async function claimedWordCount(): Promise<number | null> {
  if (!isSuiteDeployed()) return null;
  if (cached && Date.now() - cached.at < TTL_MS) return cached.n;
  try {
    inflight ??= scan().finally(() => {
      inflight = null;
    });
    const n = await inflight;
    cached = { at: Date.now(), n };
    return n;
  } catch (err) {
    console.error("[claimed-words] count failed:", String((err as Error)?.message ?? err).slice(0, 120));
    return cached?.n ?? null;
  }
}
