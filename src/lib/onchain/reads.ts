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
import { addressOf, wordTokenAddress, deployBlock } from "./addresses";
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

/**
 * Remaining primary supply per letter, indexed 0..25 — what the draw sampler must respect.
 *
 * `Letters.reveal` reverts CapExceeded if the signer draws a letter whose mintedEver has reached its
 * cap (Letters.sol:263), which would strand a paid commit with no way to resolve it.
 *
 * Note the asymmetry in the contract's getters: `caps()` returns the whole uint32[26] in one call
 * (Letters.sol:286), but `mintedEver` is a bare public array, so it needs 26 — hence one aggregate3
 * rather than two round-trips.
 */
export async function readLetterSupply(): Promise<{ caps: number[]; minted: number[]; available: number[] }> {
  const letters = addressOf("letters");
  const client = getPublicClient();

  const [capsResult, mintedResults] = await Promise.all([
    client.readContract({ address: letters, abi: lettersAbi, functionName: "caps" }),
    client.multicall({
      allowFailure: false,
      contracts: Array.from({ length: 26 }, (_, i) => ({
        address: letters,
        abi: lettersAbi,
        functionName: "mintedEver" as const,
        args: [BigInt(i)],
      })),
    }),
  ]);

  const caps = (capsResult as unknown as readonly number[]).map(Number);
  const minted = (mintedResults as unknown as number[]).map(Number);
  return { caps, minted, available: caps.map((c, i) => Math.max(0, c - (minted[i] ?? 0))) };
}

export interface PendingCommit {
  commitId: bigint;
  /** 1 for a daily, 5 for a pack — the reveal must supply exactly this many letters. */
  count: number;
  buyer: `0x${string}`;
  blockNumber: bigint;
}

/**
 * Unrevealed letter commits belonging to a player — the discovery step every commit→reveal flow
 * needs, and the resume path for stranded ones.
 *
 * `commitPack` and friends return `commitId` as a Solidity return value, which is UNREACHABLE
 * through `wallet_sendCalls` — the wallet hands back a batch id, not a decoded return. The only way
 * to learn it is the indexed `Committed(commitId, buyer, count)` log, emitted by `_newCommit` for
 * all four commit paths.
 *
 * This doubles as the stranded-commit recovery path, which matters more than it sounds: the
 * contracts deliberately have NO reveal expiry, so an unrevealed paid commit stays open forever and
 * the player's money stays spent. Anything that lands here and never clears is money owed.
 */
export async function readPendingCommits(player: `0x${string}`): Promise<PendingCommit[]> {
  const letters = addressOf("letters");
  const client = getPublicClient();

  const logs = await client.getLogs({
    address: letters,
    event: {
      type: "event",
      name: "Committed",
      inputs: [
        { name: "commitId", type: "uint256", indexed: true },
        { name: "buyer", type: "address", indexed: true },
        { name: "count", type: "uint8", indexed: false },
      ],
    },
    args: { buyer: player },
    fromBlock: deployBlock(),
    toBlock: "latest",
  });

  if (logs.length === 0) return [];

  // A log proves the commit happened, not that it's still open — check revealed state on-chain.
  const states = await client.multicall({
    allowFailure: false,
    contracts: logs.map((l) => ({
      address: letters,
      abi: lettersAbi,
      functionName: "commits" as const,
      args: [l.args.commitId as bigint],
    })),
  });

  return logs
    .map((l, i) => {
      const s = states[i] as unknown as readonly [string, number, boolean];
      return {
        commitId: l.args.commitId as bigint,
        count: Number(l.args.count),
        buyer: l.args.buyer as `0x${string}`,
        blockNumber: l.blockNumber ?? 0n,
        revealed: Boolean(s[2]),
      };
    })
    .filter((c) => !c.revealed)
    .map(({ commitId, count, buyer, blockNumber }) => ({ commitId, count, buyer, blockNumber }));
}

/**
 * Poll until a commit appears that wasn't in `knownIds`.
 *
 * Callers discovering a commit they JUST created cannot use `readPendingCommits` directly: logs are
 * not queryable the instant a transaction mines, and a single read returns an empty list that is
 * indistinguishable from "the commit failed". Verified against Sepolia — the same query returned 0
 * immediately after mining and 1 a moment later.
 *
 * Returns null on timeout, which the caller must treat as "unknown", never as "failed": the commit
 * may well exist, and the money is already spent.
 */
export async function waitForNewCommit(
  player: `0x${string}`,
  knownIds: readonly bigint[],
  { timeoutMs = 60_000, intervalMs = 2_000 }: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<PendingCommit | null> {
  const known = new Set(knownIds.map(String));
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const pending = await readPendingCommits(player);
    const fresh = pending.find((c) => !known.has(String(c.commitId)));
    if (fresh) return fresh;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return null;
}

export interface DayState {
  /** The contract's day index: uint32(block.timestamp / 1 days). */
  chainDay: number;
  /** Seconds until the next UTC midnight — the chain's reset, NOT the player's local midnight. */
  secondsUntilReset: number;
  /** True when this FID has already taken today's daily. */
  dailyUsed: boolean;
}

/**
 * Day-boundary state, read from chain time.
 *
 * The daily resets at UTC midnight because the contract computes `block.timestamp / 1 days`. Any
 * countdown driven by a local-midnight calculation is wrong for every player outside UTC, and wrong
 * in the direction that tells them the daily is available when the contract will reject it.
 */
export async function readDayState(fid: bigint): Promise<DayState> {
  const letters = addressOf("letters");
  const [now, usedDayPlusOne] = await Promise.all([
    readChainTime(),
    getPublicClient().readContract({
      address: letters,
      abi: lettersAbi,
      functionName: "dailyUsed",
      args: [fid],
    }) as Promise<number | bigint>,
  ]);
  const day = Math.floor(now / 86_400);
  return {
    chainDay: day,
    secondsUntilReset: (day + 1) * 86_400 - now,
    // The contract stores day+1 so that 0 means "never" — comparing against the raw day is off by one.
    dailyUsed: Number(usedDayPlusOne) === day + 1,
  };
}

/** Per-letter pity streaks for a player, indexed 0..25. Drives the roll odds the UI shows. */
export async function readPity(player: `0x${string}`): Promise<number[]> {
  const rolls = addressOf("rolls");
  const r = await getPublicClient().multicall({
    allowFailure: false,
    contracts: Array.from({ length: 26 }, (_, i) => ({
      address: rolls,
      abi: rollsAbi,
      functionName: "pityOf" as const,
      args: [player, i],
    })),
  });
  return (r as unknown as number[]).map(Number);
}

/** The chain's current block timestamp — the only correct source for the UTC day boundary. */
export async function readChainTime(): Promise<number> {
  const block = await getPublicClient().getBlock();
  return Number(block.timestamp);
}
