/**
 * Game actions as calldata.
 *
 * Every function here returns a `Call[]` for `sendCallsAttributed` — nothing in this file talks to a
 * wallet. That split is deliberate: the builders stay pure and testable, and the single place that
 * touches a provider stays the one that injects the ERC-8021 builder suffix, so attribution can't be
 * skipped by adding an action. `tests/no-write-bypass.test.ts` enforces it.
 *
 * Batches put approvals FIRST and are otherwise ordered. Note that `sendCallsAttributed` sets
 * `atomicRequired: false`, so a partial batch is possible — the approval lands and the action fails.
 * That's safe here (the worst case is an orphaned allowance) but it means the UI must re-read state
 * after a send rather than assume every call in the batch succeeded.
 */
import { encodeFunctionData, maxUint256 } from "viem";
import type { Call } from "./sendCalls";
import { addressOf, wordTokenAddress } from "./addresses";
import { lettersAbi, wordsAbi, rollsAbi, stakingAbi, prestigeAbi, erc20Abi } from "./abis";
import { erc20ApprovalCalls, operatorApprovalCalls, prestigeTotalNeeded, feedManyNeeded } from "./allowances";
import { NETWORK } from "./network";
import type { GameParams, PlayerState } from "./reads";

// --- minting ------------------------------------------------------------------------------------

export interface FreePackVoucher {
  fid: bigint;
  nonce: bigint;
  deadline: bigint;
  signature: `0x${string}`;
}

/** The campaign free pack. No approvals and no balance — the reason it's the first loop to wire. */
export function commitFreePackCalls(v: FreePackVoucher): Call[] {
  return [
    {
      to: addressOf("letters"),
      data: encodeFunctionData({
        abi: lettersAbi,
        functionName: "commitPackFree",
        args: [v.fid, v.nonce, v.deadline, v.signature],
      }),
    },
  ];
}

/** The FID-gated free daily. Also approval-free. */
export function commitFreeDailyCalls(v: { fid: bigint; deadline: bigint; signature: `0x${string}` }): Call[] {
  return [
    {
      to: addressOf("letters"),
      data: encodeFunctionData({
        abi: lettersAbi,
        functionName: "commitDailyFree",
        args: [v.fid, v.deadline, v.signature],
      }),
    },
  ];
}

/** A paid pack of five: approve $WORD to LETTERS (the collector, never FeeRouter), then commit. */
export function commitPackCalls(params: GameParams, player: PlayerState): Call[] {
  return [
    ...erc20ApprovalCalls({
      token: wordTokenAddress(),
      spender: addressOf("letters"),
      current: player.allowance.letters,
      needed: params.wei.pack,
    }),
    { to: addressOf("letters"), data: encodeFunctionData({ abi: lettersAbi, functionName: "commitPack" }) },
  ];
}

/**
 * Resolve a draw. The signature binds `commits[commitId].buyer`, not the caller, so this can be
 * relayed by anyone — which is what lets the backend push a losing reveal rather than leaving a paid
 * commit stranded forever (the contracts deliberately have no reveal expiry).
 */
export function revealCalls(commitId: bigint, letterIndexes: readonly number[], signature: `0x${string}`): Call[] {
  return [
    {
      to: addressOf("letters"),
      data: encodeFunctionData({
        abi: lettersAbi,
        functionName: "reveal",
        args: [commitId, letterIndexes as number[], signature],
      }),
    },
  ];
}

// --- words --------------------------------------------------------------------------------------

/**
 * Claim a word. Three calls: the 1155 operator approval, the $WORD allowance for the claim fee, then
 * the claim. `word` must be UPPERCASE — the contract requires 'A'..'Z' (Words.sol:108), the merkle
 * leaf is over that same string, and tokenId is keccak256 of it.
 */
export function claimCalls(
  word: string,
  proof: readonly `0x${string}`[],
  uppercase: boolean,
  params: GameParams,
  player: PlayerState,
): Call[] {
  const words = addressOf("words");
  return [
    ...operatorApprovalCalls({
      collection: addressOf("letters"),
      operator: words,
      approved: player.operator.lettersToWords,
    }),
    ...erc20ApprovalCalls({
      token: wordTokenAddress(),
      spender: words,
      current: player.allowance.words,
      needed: params.wei.claim,
    }),
    {
      to: words,
      data: encodeFunctionData({
        abi: wordsAbi,
        functionName: "claim",
        args: [word.toUpperCase(), uppercase, proof as `0x${string}`[]],
      }),
    },
  ];
}

/** Burn a word back into its five letters. No approval — it moves nothing the player must permit. */
export function dissolveCalls(tokenId: bigint, word: string): Call[] {
  return [
    {
      to: addressOf("words"),
      data: encodeFunctionData({ abi: wordsAbi, functionName: "dissolve", args: [tokenId, word.toUpperCase()] }),
    },
  ];
}

// --- staking ------------------------------------------------------------------------------------

/** Stake a word. Needs the 721 operator approval — setApprovalForAll, never a per-token approve. */
export function stakeCalls(tokenId: bigint, player: PlayerState): Call[] {
  const staking = addressOf("staking");
  return [
    ...operatorApprovalCalls({
      collection: addressOf("words"),
      operator: staking,
      approved: player.operator.wordsToStaking,
    }),
    { to: staking, data: encodeFunctionData({ abi: stakingAbi, functionName: "stake", args: [tokenId] }) },
  ];
}

export function unstakeCalls(tokenId: bigint): Call[] {
  return [
    { to: addressOf("staking"), data: encodeFunctionData({ abi: stakingAbi, functionName: "unstake", args: [tokenId] }) },
  ];
}

/**
 * Feed one word. The day's first feed per address is free, so this needs no allowance then — but the
 * second feed the same day does, and there is no on-chain guard against feeding an already-fed word
 * (Staking.sol:81-93), so the caller must gate on hunger or it will happily burn a snack for nothing.
 */
export function feedCalls(tokenId: bigint, params: GameParams, player: PlayerState, freeAvailable: boolean): Call[] {
  const staking = addressOf("staking");
  return [
    ...erc20ApprovalCalls({
      token: wordTokenAddress(),
      spender: staking,
      current: player.allowance.staking,
      needed: freeAvailable ? 0n : params.wei.snack,
    }),
    { to: staking, data: encodeFunctionData({ abi: stakingAbi, functionName: "feed", args: [tokenId] }) },
  ];
}

/**
 * Feed several. Sized with feedManyNeeded because the free snack covers exactly one of them —
 * under-approving reverts the ENTIRE batch, unlike the mock reducer which silently skips.
 */
export function feedManyCalls(
  tokenIds: readonly bigint[],
  params: GameParams,
  player: PlayerState,
  freeAvailable: boolean,
): Call[] {
  const staking = addressOf("staking");
  return [
    ...erc20ApprovalCalls({
      token: wordTokenAddress(),
      spender: staking,
      current: player.allowance.staking,
      needed: feedManyNeeded(tokenIds.length, params.wei.snack, freeAvailable),
    }),
    {
      to: staking,
      data: encodeFunctionData({ abi: stakingAbi, functionName: "feedMany", args: [tokenIds as bigint[]] }),
    },
  ];
}

// --- rolls & prestige ---------------------------------------------------------------------------

export function commitLooseRollCalls(letterIndex: number, params: GameParams, player: PlayerState): Call[] {
  const rolls = addressOf("rolls");
  return [
    ...erc20ApprovalCalls({
      token: wordTokenAddress(),
      spender: rolls,
      current: player.allowance.rolls,
      needed: params.wei.roll,
    }),
    { to: rolls, data: encodeFunctionData({ abi: rollsAbi, functionName: "commitLooseRoll", args: [letterIndex] }) },
  ];
}

export function commitWordRollCalls(tokenId: bigint, pos: number, params: GameParams, player: PlayerState): Call[] {
  const rolls = addressOf("rolls");
  return [
    ...erc20ApprovalCalls({
      token: wordTokenAddress(),
      spender: rolls,
      current: player.allowance.rolls,
      needed: params.wei.roll,
    }),
    { to: rolls, data: encodeFunctionData({ abi: rollsAbi, functionName: "commitWordRoll", args: [tokenId, pos] }) },
  ];
}

export function rollRevealCalls(commitId: bigint, success: boolean, signature: `0x${string}`): Call[] {
  return [
    {
      to: addressOf("rolls"),
      data: encodeFunctionData({ abi: rollsAbi, functionName: "reveal", args: [commitId, success, signature] }),
    },
  ];
}

/**
 * Ascend a word. The allowance must cover prestigeFee + snackCost: commitPrestige collects TWICE in
 * one transaction, so a fee-sized approval succeeds on the first pull and reverts on the second.
 */
export function commitPrestigeCalls(tokenId: bigint, params: GameParams, player: PlayerState): Call[] {
  const prestige = addressOf("prestige");
  return [
    ...erc20ApprovalCalls({
      token: wordTokenAddress(),
      spender: prestige,
      current: player.allowance.prestige,
      needed: prestigeTotalNeeded(params.wei.prestigeFee, params.wei.prestigeSnackCost),
    }),
    { to: prestige, data: encodeFunctionData({ abi: prestigeAbi, functionName: "commitPrestige", args: [tokenId] }) },
  ];
}

export function prestigeRevealCalls(commitId: bigint, success: boolean, signature: `0x${string}`): Call[] {
  return [
    {
      to: addressOf("prestige"),
      data: encodeFunctionData({ abi: prestigeAbi, functionName: "reveal", args: [commitId, success, signature] }),
    },
  ];
}

// --- testnet only -------------------------------------------------------------------------------

/**
 * Mint yourself mock $WORD. Exists ONLY because the Sepolia stand-in token has a permissionless
 * mint(); there is no equivalent on mainnet, so callers must gate on NETWORK.isTestnet and this
 * throws if anyone forgets.
 */
export function faucetCalls(to: `0x${string}`, whole: number): Call[] {
  if (!NETWORK.isTestnet) {
    throw new Error("The $WORD faucet exists only on testnet — there is no mint() on the real token.");
  }
  return [
    {
      to: wordTokenAddress(),
      data: encodeFunctionData({
        abi: erc20Abi,
        functionName: "mint",
        args: [to, BigInt(Math.max(1, Math.floor(whole))) * 10n ** 18n],
      }),
    },
  ];
}

/** Revoke every $WORD allowance the game holds — a courtesy escape hatch, not used by the game loop. */
export function revokeAllCalls(): Call[] {
  const token = wordTokenAddress();
  return (["letters", "words", "staking", "rolls", "prestige"] as const).map((k) => ({
    to: token,
    data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [addressOf(k), 0n] }),
  }));
}

export { maxUint256 };
