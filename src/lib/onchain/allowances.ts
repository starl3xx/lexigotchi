/**
 * Approval calldata — the calls that must precede an action, and nothing more.
 *
 * Every function here returns an EMPTY array when the approval is already sufficient, so callers can
 * unconditionally spread the result into a batch and never send a redundant transaction.
 *
 * The two traps this file exists to prevent:
 *
 *   1. WRONG SPENDER. The $WORD pull is executed BY the collector contract (Letters, Words, Staking,
 *      Rolls, Prestige) via FeeCollector.sol:29 — not by FeeRouter. Approving FeeRouter yields
 *      ERC20InsufficientAllowance naming a spender the player never chose, which reads like a bug in
 *      the contracts. There are five separate allowances; they do not share.
 *
 *   2. PRESTIGE UNDER-APPROVAL. `commitPrestige` makes TWO _collect calls in one transaction
 *      (Prestige.sol:83-84): the fee, then the burned snack. An allowance sized to prestigeFee alone
 *      succeeds on the first transferFrom and reverts on the second — a failure that looks random
 *      because the first half worked. Always approve the SUM.
 *
 * Operator approvals use setApprovalForAll, never approve(to, tokenId): OZ's ERC721 clears the
 * per-token approval inside _update on every transfer, so a per-token approve would have to be
 * re-sent before every single stake.
 */
import { encodeFunctionData, maxUint256 } from "viem";
import type { Call } from "./sendCalls";
import { erc20Abi, erc1155ApprovalAbi } from "./abis";

/**
 * Approve to the maximum by default.
 *
 * The tradeoff is deliberate: an exact-amount approval means a fresh approve before literally every
 * action (prices move, and any leftover is short next time), which is two wallet prompts per pack
 * forever. These are our own game contracts and the token is capped-supply, so a standing allowance
 * is the same trust decision the player already made by playing. Pass `exact` to opt out.
 */
export type ApprovalStrategy = "max" | "exact";

export interface Erc20ApprovalInput {
  token: `0x${string}`;
  spender: `0x${string}`;
  /** Current on-chain allowance, from readPlayerState. */
  current: bigint;
  /** Minimum the upcoming action will pull. */
  needed: bigint;
  strategy?: ApprovalStrategy;
}

/** The approve call for an action, or [] when the existing allowance already covers it. */
export function erc20ApprovalCalls(input: Erc20ApprovalInput): Call[] {
  const { token, spender, current, needed, strategy = "max" } = input;
  if (needed === 0n) return []; // free path — _collect short-circuits on amount > 0
  if (current >= needed) return [];
  return [
    {
      to: token,
      data: encodeFunctionData({
        abi: erc20Abi,
        functionName: "approve",
        args: [spender, strategy === "max" ? maxUint256 : needed],
      }),
    },
  ];
}

/** setApprovalForAll for an ERC-1155/721 collection, or [] when already approved. */
export function operatorApprovalCalls(input: {
  collection: `0x${string}`;
  operator: `0x${string}`;
  approved: boolean;
}): Call[] {
  if (input.approved) return [];
  return [
    {
      to: input.collection,
      data: encodeFunctionData({
        abi: erc1155ApprovalAbi,
        functionName: "setApprovalForAll",
        args: [input.operator, true],
      }),
    },
  ];
}

/**
 * The total $WORD `commitPrestige` pulls in one transaction.
 * Read both values live — they're seeded identically at deploy but diverge under independent repegs.
 */
export function prestigeTotalNeeded(prestigeFeeWei: bigint, snackCostWei: bigint): bigint {
  return prestigeFeeWei + snackCostWei;
}

/**
 * The $WORD a `feedMany` batch pulls, accounting for the free daily snack.
 *
 * The day's first feed per address is free (Staking.sol:85-90), so n words cost (n-1) snacks when
 * the free one is still available. Sizing this as n × snackPrice over-approves harmlessly; sizing it
 * as n × snackPrice when the free feed ISN'T available under-approves and reverts the whole batch.
 */
export function feedManyNeeded(count: number, snackPriceWei: bigint, freeAvailable: boolean): bigint {
  const paid = Math.max(0, count - (freeAvailable ? 1 : 0));
  return BigInt(paid) * snackPriceWei;
}
