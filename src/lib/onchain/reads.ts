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

const ZERO = "0x0000000000000000000000000000000000000000";
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

export interface ChainWord {
  /** UPPERCASE dictionary key — the UI's primary key. */
  word: string;
  tokenId: bigint;
  /** Per-position case of the five escrowed letters (true = UPPERCASE). */
  upper: boolean[];
  staked: boolean;
  daysUnfed: number;
  prestigeLevel: number;
}

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

const TRANSFER_EVENT = {
  type: "event",
  name: "Transfer",
  inputs: [
    { name: "from", type: "address", indexed: true },
    { name: "to", type: "address", indexed: true },
    { name: "tokenId", type: "uint256", indexed: true },
  ],
} as const;

const STAKED_EVENT = {
  type: "event",
  name: "Staked",
  inputs: [
    { name: "tokenId", type: "uint256", indexed: true },
    { name: "staker", type: "address", indexed: true },
  ],
} as const;

/**
 * Every Word the player beneficially owns.
 *
 * Two things make this harder than `ownerOf`:
 *
 *  1. STAKING TRANSFERS THE NFT. `Words.ownerOf(tokenId)` returns the Staking contract for anything
 *     staked, so filtering on it silently drops exactly the words that earn yield and hold jackpot
 *     tickets. It presents as "my best words vanished" and looks like a claim bug. Ownership is
 *     resolved through `Staking.stakerOf`, falling back to `ownerOf` for unstaked ones.
 *
 *  2. tokenId IS keccak256(word), which is ONE-WAY. There is no on-chain path from an id back to its
 *     word, so the string has to come from the `Claimed` event — hence the unfiltered Claimed scan
 *     building an id→word map. A word acquired by transfer has no Claimed event naming this player,
 *     which is why the map is built from all of them rather than only the player's.
 */
export async function readOwnedWords(player: `0x${string}`): Promise<ChainWord[]> {
  const words = addressOf("words");
  const staking = addressOf("staking");
  const client = getPublicClient();
  const from = deployBlock();

  const [claimedAll, transfersIn, stakedByPlayer, now] = await Promise.all([
    client.getLogs({ address: words, event: CLAIMED_EVENT, fromBlock: from, toBlock: "latest" }),
    client.getLogs({ address: words, event: TRANSFER_EVENT, args: { to: player }, fromBlock: from, toBlock: "latest" }),
    client.getLogs({ address: staking, event: STAKED_EVENT, args: { staker: player }, fromBlock: from, toBlock: "latest" }),
    readChainTime(),
  ]);

  const wordById = new Map<string, string>();
  for (const l of claimedAll) wordById.set(String(l.args.tokenId), String(l.args.word).toUpperCase());

  const candidates = new Set<string>();
  for (const l of transfersIn) candidates.add(String(l.args.tokenId));
  for (const l of stakedByPlayer) candidates.add(String(l.args.tokenId));
  if (candidates.size === 0) return [];

  const ids = [...candidates].map((s) => BigInt(s));

  // Resolve current beneficial ownership. allowFailure because ownerOf REVERTS
  // (ERC721NonexistentToken) for a dissolved word, which would otherwise poison the whole aggregate.
  const ownership = await client.multicall({
    allowFailure: true,
    contracts: ids.flatMap((id) => [
      { address: staking, abi: stakingAbi, functionName: "stakerOf" as const, args: [id] },
      { address: words, abi: wordsAbi, functionName: "ownerOf" as const, args: [id] },
    ]),
  });

  const owned: bigint[] = [];
  const stakedFlag = new Map<string, boolean>();
  ids.forEach((id, i) => {
    const staker = ownership[i * 2];
    const owner = ownership[i * 2 + 1];
    const stakerAddr = staker.status === "success" ? String(staker.result) : ZERO;
    const ownerAddr = owner.status === "success" ? String(owner.result) : ZERO;
    const isStaked = stakerAddr.toLowerCase() === player.toLowerCase();
    const isHeld = ownerAddr.toLowerCase() === player.toLowerCase();
    if (isStaked || isHeld) {
      owned.push(id);
      stakedFlag.set(String(id), isStaked);
    }
  });
  if (owned.length === 0) return [];

  // Per-word detail. escrowLetter is 5 calls each because `escrows` is internal — there is no
  // whole-struct getter (Words.sol:44).
  const detail = await client.multicall({
    allowFailure: false,
    contracts: owned.flatMap((id) => [
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
  return owned.map((id, i) => {
    const base = i * PER;
    const prestigeLevel = Number(detail[base]);
    const lastFed = Number(detail[base + 1]);
    const upper = Array.from({ length: 5 }, (_, pos) => {
      const r = detail[base + 2 + pos] as unknown as readonly [number, boolean];
      return Boolean(r[1]);
    });
    return {
      word: wordById.get(String(id)) ?? "?????",
      tokenId: id,
      upper,
      staked: stakedFlag.get(String(id)) ?? false,
      // lastFed 0 means never fed; treat it as freshly claimed rather than infinitely starving.
      daysUnfed: lastFed === 0 ? 0 : Math.max(0, Math.floor((now - lastFed) / 86_400)),
      prestigeLevel,
    };
  });
}

/** The chain's current block timestamp — the only correct source for the UTC day boundary. */
export async function readChainTime(): Promise<number> {
  const block = await getPublicClient().getBlock();
  return Number(block.timestamp);
}
