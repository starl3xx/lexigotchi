/**
 * Chain reads — the adapter between on-chain state and the game's view of the world.
 *
 * Everything here is a Multicall3 `aggregate3`, for a reason beyond round-trip count: the game's
 * economics are internally consistent only if the values are read from the same block. Prices,
 * allowances, and balances fetched across three blocks can disagree in ways that produce an
 * "affordable" button which reverts.
 *
 * NOTHING may seed a price from a constant. Every default in `Deploy.s.sol` is already stale
 * against the live deployment — the deploy used env overrides, so e.g. packPrice is 4_242_861e18
 * on-chain versus the script's 4_220_000e18. Read prices live, always.
 *
 * Amounts cross into the app as WHOLE $WORD (numbers), converted once, here. The UI thinks in whole
 * $WORD; only calldata thinks in wei.
 */
import { createPublicClient, http, formatUnits, type PublicClient } from "viem";
import { ACTIVE_CHAIN } from "./chain";
import { addressOf, wordTokenAddress } from "./addresses";
import { lettersAbi, wordsAbi, rollsAbi, stakingAbi, prestigeAbi, erc20Abi, erc1155ApprovalAbi } from "./abis";

const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL || undefined;

let client: PublicClient | undefined;

/** Shared read client for the active chain. Safe on server and client. */
export function getPublicClient(): PublicClient {
  if (!client) {
    client = createPublicClient({ chain: ACTIVE_CHAIN, transport: http(RPC_URL) }) as PublicClient;
  }
  return client;
}

/** $WORD is 18-decimal; the UI works in whole tokens. */
export const WORD_DECIMALS = 18;
export function toWholeWord(wei: bigint): number {
  return Number(formatUnits(wei, WORD_DECIMALS));
}
export function toWordWei(whole: number): bigint {
  return BigInt(Math.ceil(whole)) * 10n ** BigInt(WORD_DECIMALS);
}

export interface GameParams {
  /** Prices in WEI — use these to build calldata and approvals. */
  wei: {
    pack: bigint;
    daily: bigint;
    roll: bigint;
    claim: bigint;
    snack: bigint;
    prestigeFee: bigint;
    prestigeSnackCost: bigint;
  };
  /** The same prices in whole $WORD — use these for display and affordability. */
  word: {
    pack: number;
    daily: number;
    roll: number;
    claim: number;
    snack: number;
    prestigeFee: number;
    prestigeSnackCost: number;
  };
  maxPrestigeLevel: number;
  peckishAfterSeconds: number;
  hungryAfterSeconds: number;
  freeDailySnack: boolean;
  freePackOpen: boolean;
}

/**
 * The whole economic configuration, from one block.
 *
 * Prestige's snackCost is read SEPARATELY from Staking's snackPrice even though they're seeded from
 * the same deploy value and are identical today. They diverge the moment either is repegged
 * independently, and a helper that reuses one for the other passes every test now and silently
 * under-approves later.
 */
export async function readGameParams(): Promise<GameParams> {
  const letters = addressOf("letters");
  const words = addressOf("words");
  const rolls = addressOf("rolls");
  const staking = addressOf("staking");
  const prestige = addressOf("prestige");

  const r = await getPublicClient().multicall({
    allowFailure: false,
    contracts: [
      { address: letters, abi: lettersAbi, functionName: "packPrice" },
      { address: letters, abi: lettersAbi, functionName: "dailyPrice" },
      { address: rolls, abi: rollsAbi, functionName: "rollPrice" },
      { address: words, abi: wordsAbi, functionName: "claimPrice" },
      { address: staking, abi: stakingAbi, functionName: "snackPrice" },
      { address: prestige, abi: prestigeAbi, functionName: "prestigeFee" },
      { address: prestige, abi: prestigeAbi, functionName: "snackCost" },
      { address: prestige, abi: prestigeAbi, functionName: "maxLevel" },
      { address: staking, abi: stakingAbi, functionName: "peckishAfter" },
      { address: staking, abi: stakingAbi, functionName: "hungryAfter" },
      { address: staking, abi: stakingAbi, functionName: "freeDailySnack" },
      { address: letters, abi: lettersAbi, functionName: "freePackOpen" },
    ] as const,
  });

  const [pack, daily, roll, claim, snack, prestigeFee, prestigeSnackCost, maxLevel, peckish, hungry, freeSnack, freePack] = r as unknown as [
    bigint, bigint, bigint, bigint, bigint, bigint, bigint, number, bigint, bigint, boolean, boolean,
  ];

  return {
    wei: { pack, daily, roll, claim, snack, prestigeFee, prestigeSnackCost },
    word: {
      pack: toWholeWord(pack),
      daily: toWholeWord(daily),
      roll: toWholeWord(roll),
      claim: toWholeWord(claim),
      snack: toWholeWord(snack),
      prestigeFee: toWholeWord(prestigeFee),
      prestigeSnackCost: toWholeWord(prestigeSnackCost),
    },
    maxPrestigeLevel: Number(maxLevel),
    peckishAfterSeconds: Number(peckish),
    hungryAfterSeconds: Number(hungry),
    freeDailySnack: freeSnack,
    freePackOpen: freePack,
  };
}

export interface PlayerState {
  /** $WORD balance, whole tokens and wei. */
  balanceWei: bigint;
  balance: number;
  /** Per-spender $WORD allowances, in wei. */
  allowance: { letters: bigint; words: bigint; staking: bigint; rolls: bigint; prestige: bigint };
  /** Operator approvals for the two token transfers the game performs. */
  operator: { lettersToWords: boolean; wordsToStaking: boolean };
  /** Letter inventory by id: 0-25 lowercase, 26-51 UPPERCASE. */
  letters: number[];
}

/** All 52 letter ids — lowercase 0-25, uppercase 26-51. */
const LETTER_IDS = Array.from({ length: 52 }, (_, i) => BigInt(i));

/**
 * Everything about one player, from one block.
 *
 * Letter balances come from a single `balanceOfBatch`, which also happens to be the only correct
 * way to check a word with a doubled letter (ALLOY needs two L's — a per-id balanceOf would say
 * "you have an L" and the claim would still revert).
 */
export async function readPlayerState(player: `0x${string}`): Promise<PlayerState> {
  const token = wordTokenAddress();
  const letters = addressOf("letters");
  const words = addressOf("words");
  const staking = addressOf("staking");
  const rolls = addressOf("rolls");
  const prestige = addressOf("prestige");

  const r = await getPublicClient().multicall({
    allowFailure: false,
    contracts: [
      { address: token, abi: erc20Abi, functionName: "balanceOf", args: [player] },
      { address: token, abi: erc20Abi, functionName: "allowance", args: [player, letters] },
      { address: token, abi: erc20Abi, functionName: "allowance", args: [player, words] },
      { address: token, abi: erc20Abi, functionName: "allowance", args: [player, staking] },
      { address: token, abi: erc20Abi, functionName: "allowance", args: [player, rolls] },
      { address: token, abi: erc20Abi, functionName: "allowance", args: [player, prestige] },
      { address: letters, abi: erc1155ApprovalAbi, functionName: "isApprovedForAll", args: [player, words] },
      { address: words, abi: erc1155ApprovalAbi, functionName: "isApprovedForAll", args: [player, staking] },
      {
        address: letters,
        abi: lettersAbi,
        functionName: "balanceOfBatch",
        args: [LETTER_IDS.map(() => player), LETTER_IDS],
      },
    ] as const,
  });

  const [bal, aLetters, aWords, aStaking, aRolls, aPrestige, opLW, opWS, batch] = r as unknown as [
    bigint, bigint, bigint, bigint, bigint, bigint, boolean, boolean, bigint[],
  ];

  return {
    balanceWei: bal,
    balance: toWholeWord(bal),
    allowance: { letters: aLetters, words: aWords, staking: aStaking, rolls: aRolls, prestige: aPrestige },
    operator: { lettersToWords: opLW, wordsToStaking: opWS },
    letters: batch.map(Number),
  };
}

/** The chain's current block timestamp — the only correct source for the UTC day boundary. */
export async function readChainTime(): Promise<number> {
  const block = await getPublicClient().getBlock();
  return Number(block.timestamp);
}
