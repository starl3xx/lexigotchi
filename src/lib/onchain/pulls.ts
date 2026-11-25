/**
 * Pull then act (docs/linked-wallets-onchain.md, option a): with the player's opt-in approvals, the
 * CONNECTED wallet borrows what an action needs from the player's other wallets, then acts. The
 * contracts already allow it: an ERC-1155 operator can move the owner's letters, and a $WORD
 * allowance lets the spender move up to that much. Nothing here changes who owns anything: the pulled
 * items land in another of the same player's wallets.
 *
 * Pure (tests/pulls.test.ts). The rules:
 * - Use the acting wallet's own letters and $WORD first; pull only what's missing.
 * - Pull only from a wallet that approved the acting wallet (letters: setApprovalForAll; $WORD: an
 *   allowance, capped by the player).
 * - Never pull a lowercase letter with an open loose roll in its wallet: the roll's reveal re-checks
 *   that the roller still holds it, and a pull would turn a paid success into a no-op.
 * - Leave letters promised in the wallet's open swap offers, which would stop working without them.
 * - Sources are tried in the order given (the game wallet first).
 */
import { encodeFunctionData, erc20Abi as standardErc20Abi } from "viem";
import type { Call } from "./sendCalls";
import { erc1155ApprovalAbi, lettersAbi, wordsAbi } from "./abis";
import { addressOf, wordTokenAddress } from "./addresses";

export interface PullSource {
  wallet: `0x${string}`;
  /** 52 letter counts this wallet holds (0-25 lowercase, 26-51 UPPERCASE). */
  letters: readonly number[];
  /** $WORD it holds (raw). */
  word: bigint;
  /** It approved the acting wallet on Letters (setApprovalForAll). */
  lettersApproved: boolean;
  /** Its $WORD allowance to the acting wallet (raw). */
  wordAllowance: bigint;
  /** Lowercase letters (0-25) with an open loose roll in this wallet: never pulled. */
  openRolls?: ReadonlySet<number>;
  /** 52 counts promised in this wallet's open swap offers: left in place. */
  promised?: readonly number[];
}

export interface PullPlan {
  pulls: { from: `0x${string}`; ids: bigint[]; amounts: bigint[]; word: bigint }[];
  /** What's still missing after every pull (52 counts, and $WORD): the action can't run if any. */
  short: { letters: number[]; word: bigint };
}

/** The 52-count need to spell `word` (all lowercase, or all UPPERCASE letters). */
export function lettersForWord(word: string, uppercase: boolean): number[] {
  const need = Array.from({ length: 52 }, () => 0);
  for (const ch of word.toUpperCase()) {
    const i = ch.charCodeAt(0) - 65;
    if (i < 0 || i > 25) throw new Error(`Not a letter: ${ch}`);
    need[uppercase ? 26 + i : i] += 1;
  }
  return need;
}

export function planPulls(
  acting: { letters: readonly number[]; word: bigint },
  need: { letters?: readonly number[]; word?: bigint },
  sources: readonly PullSource[],
): PullPlan {
  const missing = Array.from({ length: 52 }, (_, i) => Math.max(0, (need.letters?.[i] ?? 0) - (acting.letters[i] ?? 0)));
  let missingWord = (need.word ?? 0n) > acting.word ? (need.word ?? 0n) - acting.word : 0n;
  const pulls: PullPlan["pulls"] = [];
  for (const s of sources) {
    const ids: bigint[] = [];
    const amounts: bigint[] = [];
    if (s.lettersApproved) {
      for (let i = 0; i < 52; i++) {
        if (missing[i] === 0) continue;
        if (i < 26 && s.openRolls?.has(i)) continue;
        const available = Math.max(0, (s.letters[i] ?? 0) - (s.promised?.[i] ?? 0));
        const take = Math.min(available, missing[i]);
        if (take <= 0) continue;
        ids.push(BigInt(i));
        amounts.push(BigInt(take));
        missing[i] -= take;
      }
    }
    let word = 0n;
    if (missingWord > 0n && s.wordAllowance > 0n) {
      const cap = s.word < s.wordAllowance ? s.word : s.wordAllowance;
      word = cap < missingWord ? cap : missingWord;
      missingWord -= word;
    }
    if (ids.length > 0 || word > 0n) pulls.push({ from: s.wallet, ids, amounts, word });
  }
  return { pulls, short: { letters: missing, word: missingWord } };
}

/** Anything still missing after the pulls? */
export const planShort = (p: PullPlan) => p.short.word > 0n || p.short.letters.some((n) => n > 0);

/** The pull calls, sent by the ACTING wallet (an approved operator / spender of each source). */
export function pullCalls(
  acting: `0x${string}`,
  plan: PullPlan,
  contracts: { letters: `0x${string}`; token: `0x${string}` } = { letters: addressOf("letters"), token: wordTokenAddress() },
): Call[] {
  const calls: Call[] = [];
  for (const p of plan.pulls) {
    if (p.from.toLowerCase() === acting.toLowerCase()) throw new Error("A wallet can't pull from itself.");
    if (p.ids.length > 0) {
      calls.push({
        to: contracts.letters,
        data: encodeFunctionData({ abi: lettersAbi, functionName: "safeBatchTransferFrom", args: [p.from, acting, p.ids, p.amounts, "0x"] }),
      });
    }
    if (p.word > 0n) {
      calls.push({
        to: contracts.token,
        data: encodeFunctionData({ abi: standardErc20Abi, functionName: "transferFrom", args: [p.from, acting, p.word] }),
      });
    }
  }
  return calls;
}

/**
 * The opt-in grant, sent by the wallet that HOLDS things, naming another wallet of the same player:
 * that wallet may move its letters and words, and up to `wordCap` of its $WORD (0: none). `allowed`
 * false revokes all three. The approval target must come from a fresh read of the account.
 */
export function grantCalls(
  sibling: `0x${string}`,
  allowed: boolean,
  wordCap: bigint,
  contracts: { letters: `0x${string}`; words: `0x${string}`; token: `0x${string}` } = {
    letters: addressOf("letters"),
    words: addressOf("words"),
    token: wordTokenAddress(),
  },
): Call[] {
  return [
    { to: contracts.letters, data: encodeFunctionData({ abi: erc1155ApprovalAbi, functionName: "setApprovalForAll", args: [sibling, allowed] }) },
    { to: contracts.words, data: encodeFunctionData({ abi: wordsAbi, functionName: "setApprovalForAll", args: [sibling, allowed] }) },
    {
      to: contracts.token,
      data: encodeFunctionData({ abi: standardErc20Abi, functionName: "approve", args: [sibling, allowed ? wordCap : 0n] }),
    },
  ];
}
