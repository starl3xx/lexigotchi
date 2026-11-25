/**
 * A word's story onchain, for the back of its card (lib/cardFacts): every claim of it (the first is
 * its finder) and every change of hands, oldest first, with block times.
 *
 * Both events index the token id, so each read is one filtered log query for one word, not a scan
 * of the game. Staking moves the token to the Staking contract and back; that isn't a change of
 * hands, so those transfers are left out (which also keeps the block-time reads few: a word staked
 * and unstaked a hundred times has a short story).
 */
import { getAbiItem, parseAbiItem } from "viem";
import { getPublicClient } from "./reads";
import { addressOf, deployBlock } from "./addresses";
import { wordsAbi } from "./abis";
import { tokenIdOf } from "./tokenId";
import type { WordStory } from "@/lib/cardFacts";

// From the generated ABI, never a hand copy: a filter on a stale signature silently matches nothing.
const CLAIMED = getAbiItem({ abi: wordsAbi, name: "Claimed" });
const TRANSFER = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)");

export async function readWordStory(word: string): Promise<WordStory> {
  const client = getPublicClient();
  const words = addressOf("words");
  const staking = addressOf("staking").toLowerCase();
  const tokenId = tokenIdOf(word);
  const fromBlock = deployBlock();
  const [claims, transfers] = await Promise.all([
    client.getLogs({ address: words, event: CLAIMED, args: { tokenId }, fromBlock, toBlock: "latest" }),
    client.getLogs({ address: words, event: TRANSFER, args: { tokenId }, fromBlock, toBlock: "latest" }),
  ]);
  const hands = transfers.filter((l) => String(l.args.from).toLowerCase() !== staking && String(l.args.to).toLowerCase() !== staking);

  // Block times for the blocks that matter, once each.
  const blocks = [...new Set([...claims, ...hands].map((l) => l.blockNumber))];
  const times = new Map(
    await Promise.all(blocks.map(async (n) => [n, Number((await client.getBlock({ blockNumber: n })).timestamp)] as const)),
  );
  const order = (a: { blockNumber: bigint; logIndex: number }, b: { blockNumber: bigint; logIndex: number }) =>
    a.blockNumber === b.blockNumber ? a.logIndex - b.logIndex : a.blockNumber < b.blockNumber ? -1 : 1;

  return {
    claims: [...claims].sort(order).map((l) => ({ owner: String(l.args.owner).toLowerCase(), at: times.get(l.blockNumber) ?? 0 })),
    transfers: [...hands].sort(order).map((l) => ({
      from: String(l.args.from).toLowerCase(),
      to: String(l.args.to).toLowerCase(),
      at: times.get(l.blockNumber) ?? 0,
    })),
  };
}
