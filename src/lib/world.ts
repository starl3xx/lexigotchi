/**
 * The whole game in one read, for the leaderboard and the Dictionary's owners: every claimed word
 * and its owner, every wallet's letters, and every jackpot win.
 *
 * - Words: the keeper's scan (lib/keeper/scan), so the owner is the BENEFICIAL one (the staker of a
 *   staked word, else the holder) exactly as rewards treat it.
 * - Letters: rebuilt from the Letters contract's own transfer events (ERC-1155 TransferSingle /
 *   TransferBatch), which record every mint, burn, upgrade, and escrow. No per-wallet reads, and the
 *   game's contracts (Words holds escrowed letters) are left out: they aren't players.
 * - Wins: Jackpot's JackpotWon events.
 *
 * Like the keeper's scan, this reads every event since deploy on each call, so the API route caches
 * it. Fine for months; later it belongs on the event indexer (decisions.md #10).
 */
import { parseAbiItem } from "viem";
import { getPublicClient } from "@/lib/onchain/reads";
import { addressOf, allAddresses, deployBlock } from "@/lib/onchain/addresses";
import { scanAllWords } from "@/lib/keeper/scan";
import { yieldWeight } from "@/lib/keeper/shares";
import { feeRouterAbi } from "@/lib/onchain/abis";
import { DEFAULT_PARAMS } from "@/lib/params";

const TRANSFER_SINGLE = parseAbiItem(
  "event TransferSingle(address indexed operator, address indexed from, address indexed to, uint256 id, uint256 value)",
);
const TRANSFER_BATCH = parseAbiItem(
  "event TransferBatch(address indexed operator, address indexed from, address indexed to, uint256[] ids, uint256[] values)",
);
const JACKPOT_WON = parseAbiItem(
  "event JackpotWon(uint32 indexed day, uint256 indexed tokenId, address indexed winner, uint256 amount)",
);
const WORD_REVEALED = parseAbiItem("event WordRevealed(uint32 indexed day, string word, bytes32 next)");
const ZERO = "0x0000000000000000000000000000000000000000";
const WEI = 10n ** 18n;

export interface WorldWord {
  word: string;
  /** Beneficial owner, lowercase. */
  owner: string;
  staked: boolean;
  /** UPPERCASE letters in the word, 0..5. */
  raised: number;
}

export interface WorldSnapshot {
  words: WorldWord[];
  /** Loose letters per wallet (lowercase address): lowercase and UPPERCASE counts. */
  letters: Record<string, { lower: number; upper: number }>;
  /** Jackpot wins per wallet: how many, and the whole $WORD they paid. */
  wins: Record<string, { count: number; amount: number }>;
  /** The keeper's total yield weight right now (Σ `yieldWeight` over every word). */
  yieldWeight: number;
}

/** One ERC-1155 movement: `ids[i]` moved `values[i]` from `from` to `to`. */
export interface LetterTransfer {
  from: string;
  to: string;
  ids: readonly bigint[];
  values: readonly bigint[];
}

/**
 * Each wallet's loose letters from the transfer log. Ids 0-25 are lowercase, 26-51 UPPERCASE.
 * `skip` holds addresses that aren't players (the zero address, the game's own contracts).
 */
export function letterTotals(transfers: readonly LetterTransfer[], skip: ReadonlySet<string>) {
  const bal = new Map<string, { lower: bigint; upper: bigint }>();
  const move = (addr: string, id: bigint, delta: bigint) => {
    const a = addr.toLowerCase();
    if (skip.has(a)) return;
    const cur = bal.get(a) ?? { lower: 0n, upper: 0n };
    if (id < 26n) cur.lower += delta;
    else cur.upper += delta;
    bal.set(a, cur);
  };
  for (const t of transfers) {
    t.ids.forEach((id, i) => {
      move(t.from, id, -t.values[i]);
      move(t.to, id, t.values[i]);
    });
  }
  const out: Record<string, { lower: number; upper: number }> = {};
  for (const [a, b] of bal) {
    if (b.lower > 0n || b.upper > 0n) out[a] = { lower: Number(b.lower), upper: Number(b.upper) };
  }
  return out;
}

export async function scanWorld(): Promise<WorldSnapshot> {
  const client = getPublicClient();
  const fromBlock = deployBlock();
  const letters = addressOf("letters");
  const [keeperWords, singles, batches, won] = await Promise.all([
    scanAllWords(),
    client.getLogs({ address: letters, event: TRANSFER_SINGLE, fromBlock, toBlock: "latest" }),
    client.getLogs({ address: letters, event: TRANSFER_BATCH, fromBlock, toBlock: "latest" }),
    client.getLogs({ address: addressOf("jackpot"), event: JACKPOT_WON, fromBlock, toBlock: "latest" }),
  ]);

  const skip = new Set<string>([ZERO, ...Object.values(allAddresses()).map((a) => a.toLowerCase())]);
  const transfers: LetterTransfer[] = [
    ...singles.map((l) => ({ from: l.args.from!, to: l.args.to!, ids: [l.args.id!], values: [l.args.value!] })),
    ...batches.map((l) => ({ from: l.args.from!, to: l.args.to!, ids: l.args.ids!, values: l.args.values! })),
  ];

  const wins: WorldSnapshot["wins"] = {};
  for (const l of won) {
    const w = String(l.args.winner).toLowerCase();
    const cur = wins[w] ?? { count: 0, amount: 0 };
    cur.count += 1;
    cur.amount += Number((l.args.amount ?? 0n) / WEI);
    wins[w] = cur;
  }

  return {
    words: keeperWords.map((w) => ({
      word: w.word,
      owner: w.owner.toLowerCase(),
      staked: w.staked,
      raised: w.raised ?? (w.upperAll ? 5 : 0),
    })),
    letters: letterTotals(transfers, skip),
    wins,
    yieldWeight: keeperWords.reduce((a, w) => a + yieldWeight(w), 0),
  };
}

/**
 * Today's yield pot in whole $WORD: the Rewards Pool × the daily rate, the same pot the keeper's
 * `yield` job opens (lib/keeper/jobs.ts). It moves through the day as fees come in.
 */
export async function readYieldPot(): Promise<number> {
  const pool = (await getPublicClient().readContract({
    address: addressOf("feeRouter"),
    abi: feeRouterAbi,
    functionName: "poolBalance",
  })) as bigint;
  return (Number(pool / 10n ** 12n) / 1e6) * DEFAULT_PARAMS.staking.dailyDistributionRate;
}

/**
 * Every secret word revealed so far (AnswerChain's WordRevealed), keyed by word, with its UTC day.
 * The locked schedule never repeats a word (answerChain.ts seededSchedule), so a revealed word can't
 * be drawn again: a buyer should know that before paying for one.
 */
export async function scanDrawn(): Promise<Record<string, number>> {
  const logs = await getPublicClient().getLogs({
    address: addressOf("answerChain"),
    event: WORD_REVEALED,
    fromBlock: deployBlock(),
    toBlock: "latest",
  });
  const out: Record<string, number> = {};
  for (const l of logs) if (l.args.word) out[String(l.args.word).toUpperCase()] = Number(l.args.day);
  return out;
}

export type BoardKey = "words" | "letters" | "raised" | "wins";
export interface BoardRow {
  /** The player: their account (its first wallet), which is the wallet itself when nothing is linked. */
  address: string;
  value: number;
  /** Wins only: the $WORD those wins paid. */
  amount?: number;
  /** How many of the account's wallets count toward this row, when more than one. */
  wallets?: number;
}

/**
 * The leaderboards, most first, at most `top` rows each, one row per PLAYER: every wallet in an
 * account (Link another wallet, lib/db/walletLinks.ts) counts toward the account's row, summed
 * before the cut, so two wallets that each miss the top 25 can make it together.
 * - words: words owned (staked or held).
 * - letters: every letter a wallet has, loose or spelled into its words (5 per word).
 * - raised: UPPERCASE letters, loose or in words.
 * - wins: jackpot wins; ties broken by the $WORD won.
 */
export function buildLeaderboards(
  s: WorldSnapshot,
  top = 25,
  accountOf: (address: string) => string = (a) => a.toLowerCase(),
): Record<BoardKey, BoardRow[]> {
  const words = new Map<string, number>();
  const letters = new Map<string, number>();
  const raised = new Map<string, number>();
  const contributors = new Map<string, Set<string>>(); // board:account → wallets with a nonzero part
  const add = (board: string, m: Map<string, number>, wallet: string, n: number) => {
    if (n <= 0) return;
    const a = accountOf(wallet);
    m.set(a, (m.get(a) ?? 0) + n);
    const key = `${board}:${a}`;
    const set = contributors.get(key) ?? new Set<string>();
    set.add(wallet.toLowerCase());
    contributors.set(key, set);
  };
  for (const w of s.words) {
    add("words", words, w.owner, 1);
    add("letters", letters, w.owner, 5);
    add("raised", raised, w.owner, w.raised);
  }
  for (const [a, l] of Object.entries(s.letters)) {
    add("letters", letters, a, l.lower + l.upper);
    add("raised", raised, a, l.upper);
  }
  const winsBy = new Map<string, { count: number; amount: number }>();
  for (const [a, w] of Object.entries(s.wins)) {
    if (w.count <= 0) continue;
    const acct = accountOf(a);
    const cur = winsBy.get(acct) ?? { count: 0, amount: 0 };
    winsBy.set(acct, { count: cur.count + w.count, amount: cur.amount + w.amount });
    const key = `wins:${acct}`;
    const set = contributors.get(key) ?? new Set<string>();
    set.add(a.toLowerCase());
    contributors.set(key, set);
  }
  const many = (board: string, address: string) => {
    const n = contributors.get(`${board}:${address}`)?.size ?? 1;
    return n > 1 ? { wallets: n } : {};
  };
  const rank = (board: string, m: Map<string, number>) =>
    [...m.entries()]
      .filter(([, v]) => v > 0)
      .sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]))
      .slice(0, top)
      .map(([address, value]) => ({ address, value, ...many(board, address) }));
  const wins = [...winsBy.entries()]
    .sort((x, y) => y[1].count - x[1].count || y[1].amount - x[1].amount || x[0].localeCompare(y[0]))
    .slice(0, top)
    .map(([address, w]) => ({ address, value: w.count, amount: w.amount, ...many("wins", address) }));
  return { words: rank("words", words), letters: rank("letters", letters), raised: rank("raised", raised), wins };
}
