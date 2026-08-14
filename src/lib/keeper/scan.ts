import { getPublicClient, readChainTime } from "@/lib/onchain/reads";
import { addressOf, deployBlock } from "@/lib/onchain/addresses";
import { wordsAbi, stakingAbi } from "@/lib/onchain/abis";
import type { KeeperWord } from "./shares";

/**
 * The keeper's world-scan: EVERY claimed word's reward-relevant state, not one player's.
 *
 * Same derivations as reads.ts's per-player readOwnedWords — beneficial owner is the staker for
 * staked words else the holder, lastFed 0 means freshly-claimed not infinitely-starving, escrow
 * case read letter by letter because the struct has no getter — but keyed off the global Claimed
 * event stream. Dissolved words drop out via the allowFailure ownerOf (it reverts for burned
 * tokens), exactly like the player scan.
 */

const ZERO = "0x0000000000000000000000000000000000000000";

const CLAIMED_EVENT = {
  type: "event",
  name: "Claimed",
  inputs: [
    { name: "tokenId", type: "uint256", indexed: true },
    { name: "owner", type: "address", indexed: true },
    { name: "word", type: "string", indexed: false },
    { name: "uppercase", type: "bool", indexed: false },
  ],
} as const;

export async function scanAllWords(): Promise<KeeperWord[]> {
  const words = addressOf("words");
  const staking = addressOf("staking");
  const client = getPublicClient();

  const [claimed, now] = await Promise.all([
    client.getLogs({ address: words, event: CLAIMED_EVENT, fromBlock: deployBlock(), toBlock: "latest" }),
    readChainTime(),
  ]);

  const wordById = new Map<string, string>();
  for (const l of claimed) wordById.set(String(l.args.tokenId), String(l.args.word).toUpperCase());
  const ids = [...wordById.keys()].map(BigInt);
  if (ids.length === 0) return [];

  const ownership = await client.multicall({
    allowFailure: true, // ownerOf REVERTS for dissolved words — they simply drop out
    contracts: ids.flatMap((id) => [
      { address: staking, abi: stakingAbi, functionName: "stakerOf" as const, args: [id] },
      { address: words, abi: wordsAbi, functionName: "ownerOf" as const, args: [id] },
    ]),
  });

  const live: { id: bigint; owner: `0x${string}`; staked: boolean }[] = [];
  ids.forEach((id, i) => {
    const staker = ownership[i * 2];
    const owner = ownership[i * 2 + 1];
    const stakerAddr = staker.status === "success" ? String(staker.result) : ZERO;
    const ownerAddr = owner.status === "success" ? String(owner.result) : ZERO;
    if (stakerAddr !== ZERO) live.push({ id, owner: stakerAddr.toLowerCase() as `0x${string}`, staked: true });
    else if (ownerAddr !== ZERO) live.push({ id, owner: ownerAddr.toLowerCase() as `0x${string}`, staked: false });
  });
  if (live.length === 0) return [];

  const detail = await client.multicall({
    allowFailure: false,
    contracts: live.flatMap(({ id }) => [
      { address: words, abi: wordsAbi, functionName: "prestigeLevel" as const, args: [id] },
      { address: staking, abi: stakingAbi, functionName: "lastFed" as const, args: [id] },
      ...Array.from({ length: 5 }, (_, pos) => ({
        address: words,
        abi: wordsAbi,
        functionName: "escrowLetter" as const,
        args: [id, pos],
      })),
    ]),
  });

  const PER = 7;
  return live.map(({ id, owner, staked }, i) => {
    const base = i * PER;
    const lastFed = Number(detail[base + 1]);
    const upper = Array.from({ length: 5 }, (_, pos) => {
      const r = detail[base + 2 + pos] as unknown as readonly [number, boolean];
      return Boolean(r[1]);
    });
    // One quantity, two resolutions: days for the share math (what the contracts count), seconds
    // for the hunger warning (which needs the remainder flooring discards). Derived from the same
    // number so they cannot drift.
    const secondsUnfed = lastFed === 0 ? 0 : Math.max(0, now - lastFed);
    return {
      tokenId: id,
      word: wordById.get(String(id)) ?? "?????",
      owner,
      staked,
      secondsUnfed,
      daysUnfed: Math.floor(secondsUnfed / 86_400),
      prestigeLevel: Number(detail[base]),
      upperAll: upper.every(Boolean),
    };
  });
}
