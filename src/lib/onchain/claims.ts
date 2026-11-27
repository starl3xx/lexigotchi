/**
 * The words made in a stretch of time, from the Words contract's `Claimed` events: for the beta
 * group's daily recap (lib/telegramRecap) and its Mythic-word alert (lib/telegramAlerts).
 *
 * A log carries its block's number, not its time. So: measure how fast blocks come, read the claims
 * from a block safely before the stretch begins, and then read the exact time of each block that
 * holds one (a day's claims sit in a handful of blocks). The start block is checked, and moved back
 * until its time is before the stretch, so a change in the chain's pace can't quietly drop the
 * earliest words.
 */
import { getAbiItem } from "viem";
import { getPublicClient } from "./reads";
import { addressOf, deployBlock } from "./addresses";
import { wordsAbi } from "./abis";

// From the generated ABI, never a hand copy: a log filter on a stale signature silently matches nothing.
const CLAIMED = getAbiItem({ abi: wordsAbi, name: "Claimed" });
/** How many blocks apart the two blocks are that measure how fast blocks come. */
const PACE_SAMPLE = 5_000n;
/** The most blocks whose times are read one by one. A day's claims sit in far fewer; more than this is left unread. */
const TIMED_BLOCKS_MAX = 150;

/** One word made: who made it, in which case, and where the event sits in the chain. */
export interface Claim {
  word: string;
  /** The wallet that made it, lowercase. */
  owner: string;
  /** Each letter's case when it was made, by position (Words.claim's upperMask: bit k is position k). */
  upper: boolean[];
  /** The chain's clock at its block, in seconds. */
  at: number;
  transactionHash: string;
  logIndex: number;
}

/**
 * Every claim between `from` (inclusive) and `to` (exclusive), in chain seconds, oldest first.
 * `to` may be omitted for "until now". Throws when the chain can't be read, or when the claims sit
 * in more blocks than it will time one by one: unread is never passed off as "none".
 */
export async function readClaimsBetween(from: number, to = Infinity): Promise<Claim[]> {
  const client = getPublicClient();
  const first = deployBlock();
  const latest = await client.getBlock();
  const sampleAt = latest.number - PACE_SAMPLE > first ? latest.number - PACE_SAMPLE : first;
  const sample = sampleAt === latest.number ? latest : await client.getBlock({ blockNumber: sampleAt });
  const pace = sampleAt === latest.number ? 2 : Math.max(0.05, Number(latest.timestamp - sample.timestamp) / Number(latest.number - sampleAt));

  let back = BigInt(Math.ceil((Math.max(0, Number(latest.timestamp) - from) / pace) * 1.2) + 100);
  let fromBlock = first;
  for (let tries = 0; tries < 4; tries++) {
    fromBlock = latest.number - back > first ? latest.number - back : first;
    if (fromBlock === first || Number((await client.getBlock({ blockNumber: fromBlock })).timestamp) < from) break;
    back *= 2n;
    if (tries === 3) fromBlock = first;
  }

  const logs = await client.getLogs({ address: addressOf("words"), event: CLAIMED, fromBlock, toBlock: latest.number });
  const blocks = [...new Set(logs.map((l) => l.blockNumber))];
  if (blocks.length > TIMED_BLOCKS_MAX) throw new Error(`${blocks.length} blocks to time`);
  const times = new Map(await Promise.all(blocks.map(async (n) => [n, Number((await client.getBlock({ blockNumber: n })).timestamp)] as const)));
  return [...logs]
    .sort((a, b) => (a.blockNumber === b.blockNumber ? a.logIndex - b.logIndex : a.blockNumber < b.blockNumber ? -1 : 1))
    .flatMap((l) => {
      const at = times.get(l.blockNumber) ?? 0;
      if (at < from || at >= to) return [];
      const word = String(l.args.word ?? "").toUpperCase();
      const mask = Number(l.args.upperMask ?? 0);
      return [
        {
          word,
          owner: String(l.args.owner).toLowerCase(),
          upper: Array.from({ length: word.length }, (_, k) => Boolean((mask >> k) & 1)),
          at,
          transactionHash: l.transactionHash,
          logIndex: l.logIndex,
        },
      ];
    });
}
