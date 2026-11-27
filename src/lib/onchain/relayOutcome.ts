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
import { lettersAbi, prestigeAbi } from "./abis";

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

/**
 * What a relayed pack reveal minted, read from the reveal transaction's own logs.
 *
 * The server finishes a pack (or a daily letter) by sending `Letters.reveal` itself (decisions.md
 * #49). What it then tells the game is what the CHAIN minted, from the reveal's own event, never
 * the draw it signed:
 *
 *   Revealed(commitId, buyer, letterIds)   one id per letter; a pull is always lowercase, and a
 *                                          lowercase id is its alphabet index (0 = a)
 *
 * `Letters.reveal` also emits one ERC-1155 `TransferSingle` per letter before it. Those are skipped:
 * the one `Revealed` names the commit, and a transfer does not.
 */
export interface LettersRevealOutcome {
  commitId: bigint;
  buyer: string;
  /** each letter's alphabet index, in the order the reveal minted them */
  letterIndexes: number[];
}

/** The `Revealed` event of `Letters.reveal` among a receipt's logs, or null when there is none. */
export function lettersRevealOutcome(logs: readonly RelayLog[], letters: string): LettersRevealOutcome | null {
  for (const log of logs) {
    if (log.address.toLowerCase() !== letters.toLowerCase()) continue;
    try {
      const ev = decodeEventLog({ abi: lettersAbi, data: log.data, topics: log.topics as [Hex, ...Hex[]] });
      if (ev.eventName !== "Revealed") continue;
      const a = ev.args as unknown as { commitId: bigint; buyer: string; letterIds: readonly bigint[] };
      const letterIndexes = a.letterIds.map(Number);
      // A pull mints lowercase only (ids 0 to 25). Anything else is not a reveal this game can show.
      if (!letterIndexes.length || letterIndexes.some((i) => !Number.isInteger(i) || i < 0 || i > 25)) return null;
      return { commitId: a.commitId, buyer: a.buyer, letterIndexes };
    } catch {
      /* an event of Letters that its ABI doesn't name; keep looking */
    }
  }
  return null;
}
