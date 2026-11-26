/**
 * What a relayed ascension reveal did, read from the reveal transaction's own logs.
 *
 * The server finishes an ascension by sending `Prestige.reveal` itself (lib/onchain/relayer,
 * decisions.md #14). What it then tells the game must be what the CHAIN did, never the outcome it
 * signed: a signed success no longer counts if the word was unstaked or changed hands before the
 * reveal, and Prestige then emits `PrestigeFailed` with the pity unchanged. So the answer is the
 * event:
 *
 *   PrestigeSucceeded(commitId, tokenId, newLevel)  the word stands at `newLevel`; its pity is 0
 *   PrestigeFailed(commitId, tokenId, pity)         the word's pity is `pity`; its level is not in
 *                                                   the event, so the relayer reads it at the
 *                                                   reveal's own block
 *
 * Pure, and apart from the relayer (which needs a key and a chain), so it is tested on logs taken
 * from real Base Sepolia reveals (tests/relay-outcome.test.ts).
 */
import { decodeEventLog, type Hex } from "viem";
import { prestigeAbi } from "./abis";

export interface RelayLog {
  address: string;
  data: Hex;
  topics: readonly Hex[];
}

export type PrestigeRevealOutcome =
  | { success: true; commitId: bigint; tokenId: bigint; level: number }
  | { success: false; commitId: bigint; tokenId: bigint; pity: number };

/** The outcome event of `Prestige.reveal` among a receipt's logs, or null when there is none. */
export function prestigeRevealOutcome(logs: readonly RelayLog[], prestige: string): PrestigeRevealOutcome | null {
  for (const log of logs) {
    if (log.address.toLowerCase() !== prestige.toLowerCase()) continue;
    try {
      const ev = decodeEventLog({ abi: prestigeAbi, data: log.data, topics: log.topics as [Hex, ...Hex[]] });
      if (ev.eventName === "PrestigeSucceeded") {
        const a = ev.args as { commitId: bigint; tokenId: bigint; newLevel: number | bigint };
        return { success: true, commitId: a.commitId, tokenId: a.tokenId, level: Number(a.newLevel) };
      }
      if (ev.eventName === "PrestigeFailed") {
        const a = ev.args as { commitId: bigint; tokenId: bigint; pity: number | bigint };
        return { success: false, commitId: a.commitId, tokenId: a.tokenId, pity: Number(a.pity) };
      }
    } catch {
      /* another contract's event, or one of Prestige's we don't read; keep looking */
    }
  }
  return null;
}
