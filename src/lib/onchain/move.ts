/**
 * Move here: send a wallet's letters and words to another wallet in the same account.
 *
 * Linked wallets (lib/db/walletLinks.ts) share a bag for DISPLAY, but every contract acts on
 * msg.sender, so a player spells, rolls, and stakes with what the connected wallet holds. Moving is
 * how they gather everything in one wallet. Only the wallet that holds the tokens can send them, so
 * the move always runs from the holding wallet, and its destination comes from that wallet's own
 * account list, read fresh (never from a link or a stored value): a transfer can't be undone.
 *
 * What moves: every loose letter (all 52 ids, lowercase and UPPERCASE) in one safeBatchTransferFrom,
 * and every word the wallet HOLDS, one safeTransferFrom each (a receiver that can't take one reverts
 * instead of trapping it). Staked words stay: Staking holds them, and unstaking is the player's call.
 * $WORD moves only when the player asks (it pays for everything, so the game wallet needs it too).
 */
import { encodeFunctionData, erc20Abi as standardErc20Abi } from "viem";
import type { Call } from "./sendCalls";
import { lettersAbi, wordsAbi } from "./abis";
import { addressOf, wordTokenAddress } from "./addresses";

export interface MovePlan {
  /** Letter ids with a nonzero balance (0-25 lowercase, 26-51 UPPERCASE), and how many of each. */
  ids: bigint[];
  amounts: bigint[];
  /** Totals for the confirmation: lowercase letters, UPPERCASE letters. */
  lower: number;
  upper: number;
  /** The held (unstaked) words that move. */
  words: { word: string; tokenId: bigint }[];
  /** Staked words, which stay. */
  staked: number;
  /** $WORD to send (raw, 18 decimals); 0 when the player didn't ask to move it. */
  word: bigint;
}

/** Pure: what a move would send, from the wallet's balances (52 counts) and its words. */
export function movePlan(
  letterCounts: readonly number[],
  words: readonly { word: string; tokenId: bigint; staked: boolean }[],
  wordBalance: bigint = 0n,
): MovePlan {
  const ids: bigint[] = [];
  const amounts: bigint[] = [];
  let lower = 0;
  let upper = 0;
  for (let i = 0; i < 52; i++) {
    const n = Math.max(0, Math.floor(letterCounts[i] ?? 0));
    if (n === 0) continue;
    ids.push(BigInt(i));
    amounts.push(BigInt(n));
    if (i < 26) lower += n;
    else upper += n;
  }
  const held = words.filter((w) => !w.staked).map((w) => ({ word: w.word, tokenId: w.tokenId }));
  return { ids, amounts, lower, upper, words: held, staked: words.length - held.length, word: wordBalance > 0n ? wordBalance : 0n };
}

/** Anything to send? */
export const planIsEmpty = (p: MovePlan) => p.ids.length === 0 && p.words.length === 0 && p.word === 0n;

/** The lowercase letter indexes a plan moves: a loose roll on one of them must finish first. */
export const lowercaseIndexesOf = (p: MovePlan) => p.ids.filter((id) => id < 26n).map(Number);

/** The calls, sent by `from` itself (ERC-1155 and ERC-721 transfers need no approval from the owner). */
export function moveCalls(
  from: `0x${string}`,
  to: `0x${string}`,
  plan: MovePlan,
  contracts: { letters: `0x${string}`; words: `0x${string}`; token?: `0x${string}` } = {
    letters: addressOf("letters"),
    words: addressOf("words"),
    token: wordTokenAddress(),
  },
): Call[] {
  if (from.toLowerCase() === to.toLowerCase()) throw new Error("A move needs two different wallets.");
  const calls: Call[] = [];
  if (plan.ids.length > 0) {
    calls.push({
      to: contracts.letters,
      data: encodeFunctionData({
        abi: lettersAbi,
        functionName: "safeBatchTransferFrom",
        args: [from, to, plan.ids, plan.amounts, "0x"],
      }),
    });
  }
  for (const w of plan.words) {
    calls.push({
      to: contracts.words,
      data: encodeFunctionData({ abi: wordsAbi, functionName: "safeTransferFrom", args: [from, to, w.tokenId] }),
    });
  }
  if (plan.word > 0n) {
    if (!contracts.token) throw new Error("No $WORD token address.");
    calls.push({ to: contracts.token, data: encodeFunctionData({ abi: standardErc20Abi, functionName: "transfer", args: [to, plan.word] }) });
  }
  return calls;
}
