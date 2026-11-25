"use client";
/**
 * The chain-backed implementation of GameApi.
 *
 * `useGame()` stays the single façade every screen imports; this provider swaps what's behind it, so
 * the mock and the real thing are interchangeable at the mount point (GameApp picks one).
 *
 * ── The honest part ───────────────────────────────────────────────────────────────────────────
 * GameApi is synchronous: `openPack()` returns five letters, `rollLoose()` returns a boolean. On
 * chain none of that is true — a pack is two transactions with a wallet prompt and a backend draw
 * between them, and either can be rejected. Rather than fake a synchronous answer (which is what the
 * mock's setTimeout does), the actions here START a flow and report through toasts and re-reads,
 * returning the empty/null value the signature demands.
 *
 * Actions that need a backend route that does not exist yet (roll and prestige reveals) say so
 * plainly instead of silently doing nothing. A no-op that looks like a success is the exact failure
 * this whole session has been about.
 *
 * ── Reads ─────────────────────────────────────────────────────────────────────────────────────
 * Nothing is optimistic. Every action re-reads afterwards, because sendCallsAttributed batches are
 * NOT atomic: an approval can land while the action reverts, and the returned batch id says nothing
 * about which calls succeeded.
 */
import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAccount } from "wagmi";
import {
  type GameApi,
  type GameState,
  type OwnedWord,
  type Sheet,
  type Toast,
  type View,
  type ChainStatus,
  type ActionOutcome,
  type PriceItem,
  MOCK_PRICE,
  canSpellAs,
  caseMask,
  chainPrice,
  jackpotEligible,
  mineLower,
  mineUpper,
  GameCtx,
  reducer,
  seedState,
  fmtWord,
  type MoveOutcome,
  type WordListing,
} from "./state";
import { rollSuccessProbability, prestigeSuccessProbability } from "@/lib/params";
import { HOLOGRAPHIC_LEVEL, stageFeeMultiple, stageName } from "@/lib/ascension";
import { REFRESH_RETRIES, useOnchain } from "./useOnchain";
import {
  readFeeBuckets,
  readOwnedWords,
  readWordsHeld,
  readLetterCounts,
  readOpenRolls,
  readWalletBalances,
  readCaretakers,
  readPity,
  readPendingCommits,
  readDayState,
  waitForNewCommit,
  readOpenRollCommits,
  waitForNewRollCommit,
  readOpenPrestigeCommits,
  waitForNewPrestigeCommit,
  readOpenRollFor,
  readOpenPrestigeFor,
} from "@/lib/onchain/reads";
import { dailyKeysFor } from "@/lib/onchain/verifications";
import { usePublicProfile } from "./useProfile";
import { unionEverHeld, unionWords, sumLetterCounts, type BagWord } from "@/lib/onchain/unionBag";
import { SEAPORT, seaportAbi, buildLetterSwapOrder, walletTypedDataJson, fulfillOrderCalls, cancelOrderCalls, type LetterSwapOrder } from "@/lib/onchain/seaport";
import { operatorApprovalCalls } from "@/lib/onchain/allowances";
import { erc1155ApprovalAbi, erc20Abi, wordsAbi } from "@/lib/onchain/abis";
import { buildWordSaleOrder, buyWordCalls, prepareListingCalls, MIN_WORD_PRICE, orderPriceWei, type SeaportOrder } from "@/lib/onchain/wordSale";
import { getPublicClient, toWordWei } from "@/lib/onchain/reads";
import { addressOf, wordTokenAddress } from "@/lib/onchain/addresses";
import { THEMES, themeForPeriod } from "@/lib/themes";
import { useViewer } from "./useViewer";
import {
  commitFreePackCalls,
  commitFreeDailyCalls,
  revealCalls,
  commitLooseRollCalls,
  commitWordRollCalls,
  rollRevealCalls,
  commitPrestigeCalls,
  setCaretakerCalls,
  prestigeRevealCalls,
  dissolveCalls,
  claimCalls,
  stakeCalls,
  unstakeCalls,
  feedCalls,
  feedManyCalls,
  feedWithSnackCalls,
  type SnackVoucher,
  faucetCalls,
  commitPackCalls,
  claimRewardCalls,
  type RewardClaim,
} from "@/lib/onchain/actions";
import { tokenIdOf } from "@/lib/onchain/tokenId";
import type { EarningsJson } from "@/lib/rewards/earnings";
import { earningsFromJson } from "./earnings";
import { lowercaseIndexesOf, moveCalls, movePlan, planIsEmpty } from "@/lib/onchain/move";
import { NETWORK, networkById } from "@/lib/onchain/network";
import { wordTier } from "@/lib/economy";
import { guardedAction, NOT_STARTED } from "@/lib/onchain/guardedAction";
import { createActionGate, type Busy, type SetPhase } from "@/lib/onchain/actionGate";
import type { Call, Eip1193Provider, SendResult } from "@/lib/onchain/sendCalls";
import { orThrowAfter, settleSend, shortHash, withTimeout, type SendTrace } from "@/lib/onchain/traceSend";
import { readUntil } from "@/lib/onchain/settle";
import { knownPityAfter, overlayPity, pruneNotes, type PityNote } from "@/lib/onchain/pityOverlay";
import { authedPostJson, maybeAuthedPostJson } from "./campaignClient";
import type { PublicFace } from "@/lib/profile/rules";
import { usePlayerWallets } from "./usePlayerWallets";

const EMPTY_26 = Array.from({ length: 26 }, () => 0);

/** Signing-route response shapes. */
// The two vouchers differ: the free pack is nonce-scoped, the daily is UTC-day-scoped.
interface PackVoucher { fid: string; nonce: string; deadline: string; signature: `0x${string}` }
interface DailyVoucher { fid: string; today: number; deadline: string; signature: `0x${string}` }
/** Pre-signed reveal for the predicted commitId — lets commit+reveal ride one send. */
interface DailyBundle { predictedCommitId: string; letterIndexes: number[]; revealSignature: `0x${string}` }
interface LetterReveal { letterIndexes: number[]; signature: `0x${string}` }
interface OutcomeReveal { success: boolean; signature: `0x${string}`; probability: number }
/** The ascension reveal also says which stage the attempt was paid at (Prestige commit `level`). */
interface PrestigeReveal extends OutcomeReveal { level?: number }
/** A roll's signed outcome, plus what the UI needs to show the new pity before the chain does. */
interface RollReveal extends OutcomeReveal {
  pityAtCommit: number;
  letterIndex: number;
  owner: string;
  /**
   * Set when we asked the server to finish the roll (decisions.md #14). "mined": done, with the
   * outcome and exact `pity` from the reveal's event. "pending"/"reverted": broadcast, the chain
   * finishes it. "already": revealed before. Absent: nothing was sent, so `signature` is here and
   * the player's wallet sends it, as before relaying existed.
   */
  relayed?: "mined" | "pending" | "reverted" | "already";
  pity?: number;
}

/**
 * Send one batch inside an action (see `track`): its label, and a builder for the calls. Each
 * action gets its own, bound to that action's status, so an abandoned action (dismissed with Hide,
 * then answered late by its wallet) can't drive a newer action's status.
 */
/**
 * `settles`: the caller re-reads until the change shows and says so itself (`sendAndSettle`), so
 * the send skips its generic "sent" toast and its background re-reads of the words.
 * `onSent`: hands the caller what the wallet returned (hashes or a batch id), to trace a send whose
 * effect never shows (`traceSend`).
 */
/** `sponsored`: ask the paymaster to pay the gas (only calls the CDP policy allows: see sendCalls). */
type RunOpts = { settles?: boolean; sponsored?: boolean; onSent?: (result: SendResult) => void };
type RunFn = (label: string, build: () => Call[], opts?: RunOpts) => Promise<boolean>;

/** Chain words → the shape screens already destructure. `careFor`: stakers that named this wallet. */
function toOwnedWord(w: BagWord, careFor?: ReadonlySet<string>): OwnedWord {
  return {
    word: w.word,
    tier: wordTier(w.word),
    upper: w.upper,
    staked: w.staked,
    daysUnfed: w.daysUnfed,
    lastFedAt: w.lastFedAt,
    prestigeLevel: w.prestigeLevel,
    // Prestige.prestigePity, read per word with the stage: the word sheet shows the next stage's
    // real odds (first try + 10 points per miss).
    prestigePity: w.prestigePity,
    // Union-bag attribution: only the connected wallet's words take actions; the rest display
    // with a "held by" note (the contracts act on msg.sender's assets, full stop).
    mine: w.mine,
    holder: w.mine ? undefined : w.holder,
    // A staked word whose staker named this wallet its caretaker: feed, roll, and ascend from here.
    care: !w.mine && w.staked && Boolean(careFor?.has(w.holder.toLowerCase())),
  };
}

/** Today's daily as this browser saw it go out (see `dailySeen` in the provider). */
interface DailySeen {
  /** The chain day it was claimed on. */
  day: number;
  /** The lowercase letter (0–25) it gave, when known before the reveal mined. */
  idx: number | null;
  /** When the claim went out (ms), for the trust window. */
  at: number;
}
/** How long the note alone counts as "claimed" before the chain's own read decides again. */
const DAILY_SEEN_TRUST_MS = 10 * 60_000;

function readDailySeen(key: string | null): DailySeen | null {
  if (!key) return null;
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? "null") as DailySeen | null;
    return v && typeof v.day === "number" && typeof v.at === "number" ? { day: v.day, idx: typeof v.idx === "number" ? v.idx : null, at: v.at } : null;
  } catch {
    return null; // private mode, or a bad value: the chain read still works
  }
}

function writeDailySeen(key: string | null, v: DailySeen) {
  if (!key) return;
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* storage blocked: the note lasts this page only */
  }
}

export function ChainGameProvider({ children }: { children: ReactNode }) {
  // The same reducer still owns nav/sheet/toast; the economy fields it computes are overridden
  // below by chain reads, so its money actions are simply never dispatched here.
  const [ui, dispatch] = useReducer(reducer, undefined, seedState);
  const chain = useOnchain();
  const { address, connector } = useAccount();
  const qc = useQueryClient();

  // What the player is waiting on (the BusyPill), from the tap to the last read. One action at a
  // time: see lib/onchain/actionGate for why a tap must never look ignored.
  const [busy, setBusy] = useState<Busy | null>(null);
  const gate = useRef(createActionGate(setBusy)).current;

  // ── THE UNION BAG ──────────────────────────────────────────────────────────────────────────
  // One collection per human: the connected wallet plus every wallet Farcaster links to the
  // account. Words and letter counts union for display; spending stays with the connected wallet
  // (the contracts act on msg.sender, full stop) — `mine` on each word carries the difference.
  const viewer = useViewer();
  // …plus every wallet linked into the player's profile (usePlayerWallets: one list app-wide).
  const bagWallets = usePlayerWallets();
  const bagKey = bagWallets.join(",");

  const wordsQ = useQuery({
    queryKey: ["ownedWords", NETWORK.id, bagKey],
    queryFn: async () => {
      const perWallet = await Promise.all(
        bagWallets.map(async (wallet) => ({ wallet, ...(await readWordsHeld(wallet)) })),
      );
      return { words: unionWords(perWallet, address), everHeld: unionEverHeld(perWallet) };
    },
    enabled: !!address && chain.deployed,
    staleTime: 10_000,
  });

  // Caretakers (Staking.setCaretaker): which stakers of words in the bag named THIS wallet, so it
  // may feed, roll, and ascend those words. One multicall; nothing to ask when every word is mine.
  const othersStaking = useMemo(
    () => [...new Set((wordsQ.data?.words ?? []).filter((w) => !w.mine && w.staked).map((w) => w.holder.toLowerCase()))].sort(),
    [wordsQ.data],
  );
  const careQ = useQuery({
    queryKey: ["careFor", NETWORK.id, address?.toLowerCase(), othersStaking.join(",")],
    queryFn: async () => {
      const flags = await readCaretakers(othersStaking.map((staker) => ({ staker, wallet: address!.toLowerCase() })));
      return othersStaking.filter((_, i) => flags[i]);
    },
    enabled: !!address && chain.deployed && othersStaking.length > 0,
    staleTime: 60_000,
  });
  const careFor = useMemo(() => new Set(careQ.data ?? []), [careQ.data]);

  // Linked wallets' letter counts (the connected wallet's ride in via chain.player). Display-only:
  // claim/roll spend gates on the connected counts, so a failed read here degrades the union
  // display to "just yours" rather than blocking anything.
  const othersLettersQ = useQuery({
    queryKey: ["linkedLetters", NETWORK.id, bagKey],
    queryFn: async () => {
      const others = bagWallets.filter((w) => w !== address?.toLowerCase());
      return sumLetterCounts(await Promise.all(others.map(readLetterCounts)));
    },
    enabled: !!address && chain.deployed && bagWallets.length > 1,
    staleTime: 30_000,
  });

  const pityQ = useQuery({
    queryKey: ["pity", NETWORK.id, address],
    queryFn: () => readPity(address as `0x${string}`),
    enabled: !!address && chain.deployed,
    staleTime: 30_000,
  });
  // The pity a resolved roll just set, shown until the (lagging) chain read agrees. See
  // lib/onchain/pityOverlay: a miss that kept showing the old odds read as "nothing happened".
  // Filed per wallet (the roll's owner, as the server reports it), so a wallet switch can't lay
  // one wallet's note over another's pity.
  const [pityNotes, setPityNotes] = useState<Readonly<Record<string, Readonly<Record<number, PityNote>>>>>({});
  const walletKey = address?.toLowerCase() ?? "";
  const myPityNotes = pityNotes[walletKey];
  useEffect(() => {
    if (!pityQ.data || !myPityNotes) return;
    const pruned = pruneNotes(pityQ.data, myPityNotes, Date.now());
    if (pruned !== myPityNotes) setPityNotes((all) => ({ ...all, [walletKey]: pruned }));
  }, [pityQ.data, myPityNotes, walletKey]);

  // The identity today's daily would be issued under, and every other key the player could claim
  // under — mirrors the server (free-daily route): the Farcaster fid, then an X account old enough
  // to count, then the wallet's synthetic 2^160 key, and "claimed" if ANY was used today. Getting
  // this wrong shows "Pull" to a player the contract or the server will refuse, and the refusal
  // reads as a bug (it did, on the first live test).
  const pubProfile = usePublicProfile();
  const { primary: dailyKey, all: dailyKeys } = dailyKeysFor({
    fid: viewer.fid,
    xUserId: pubProfile.profile?.x?.id ?? null,
    xCounts: pubProfile.xCounts,
    wallet: address ?? null,
  });

  const dayQ = useQuery({
    queryKey: ["dayState", NETWORK.id, dailyKeys.map(String).join(",")],
    queryFn: () => readDayState(dailyKeys),
    // Wait for the public profile: read before it lands, the keys miss the X one, and a player who
    // pulled on X would be offered Pull and then refused (Bugbot on #138).
    enabled: dailyKey !== null && chain.deployed && !pubProfile.loading,
    staleTime: 30_000,
    refetchInterval: 60_000, // the UTC rollover must flip the card without a reload
  });

  // Today's daily as THIS browser saw it go out, so every screen shows it claimed at once (starl3xx,
  // 2026-11-24: a pull on Today still showed Pull free on Mint). The chain read that follows a send
  // can lag, the public Sepolia RPC especially. The note also keeps the letter, for the tile beside
  // "Claimed today". It counts on its own only for DAILY_SEEN_TRUST_MS: if the chain still says
  // unused after that, the send never landed, and the chain is the truth again. Kept per wallet and
  // network in localStorage with the chain day, so a reload keeps it and tomorrow drops it.
  const dailySeenKey = address ? `lexigotchi:daily:${NETWORK.id}:${address.toLowerCase()}` : null;
  const [dailySeen, setDailySeen] = useState<DailySeen | null>(null);
  useEffect(() => {
    setDailySeen(readDailySeen(dailySeenKey));
  }, [dailySeenKey]);
  const chainDayNow = dayQ.data?.chainDay ?? Math.floor(Date.now() / 86_400_000);
  const noteDaily = useCallback(
    (idx: number | null) => {
      const seen: DailySeen = { day: chainDayNow, idx, at: Date.now() };
      setDailySeen(seen);
      writeDailySeen(dailySeenKey, seen);
      // Re-read on the usual stagger, so the chain catches up and takes over from the note.
      for (const delay of REFRESH_RETRIES) setTimeout(() => void dayQ.refetch({ cancelRefetch: false }), delay);
    },
    [chainDayNow, dailySeenKey, dayQ],
  );
  // The actions below are memoized without noteDaily in their deps; the ref always holds the
  // latest one, so a claim made right after the wallet connects still knows the wallet.
  const noteDailyRef = useRef(noteDaily);
  noteDailyRef.current = noteDaily;
  const seenToday = dailySeen && dailySeen.day === chainDayNow ? dailySeen : null;
  // Re-render when the note's trust window closes, so a send that never landed offers Pull again.
  const [, expireTick] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    if (!seenToday) return;
    const left = seenToday.at + DAILY_SEEN_TRUST_MS - Date.now();
    if (left <= 0) return;
    const t = setTimeout(expireTick, left + 50);
    return () => clearTimeout(t);
  }, [seenToday]);

  // The server's wider view: a pull today under a key this client can't see (another Farcaster
  // account that verified this wallet, or one of its other wallets) also counts, as it does when
  // the daily route refuses. Without it the web shows Pull after a mini-app pull (Bugbot on #138).
  const relatedDayQ = useQuery({
    queryKey: ["dailyStatus", NETWORK.id, address?.toLowerCase(), viewer.fid ?? null],
    queryFn: async () => {
      const r = await fetch(`/api/mint/daily-status?wallet=${address}${viewer.fid ? `&fid=${viewer.fid}` : ""}`);
      const d = (await r.json()) as { ok: boolean; claimed?: boolean };
      return d.ok ? Boolean(d.claimed) : false;
    },
    enabled: Boolean(address) && chain.deployed,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  // Paid-but-unrevealed letter commits. Nonzero means a pull is stranded — the first live daily
  // stranded exactly here (commit mined, reveal never sent) and the UI had no way to finish it.
  const pendingQ = useQuery({
    queryKey: ["pendingCommits", NETWORK.id, bagKey],
    // Union across the bag: reveal() is relayable (no caller check; letters mint to the BUYER),
    // so the connected wallet can rescue a linked wallet's stranded pull.
    queryFn: async () =>
      (await Promise.all(bagWallets.map(readPendingCommits))).flat(),
    enabled: !!address && chain.deployed,
    staleTime: 15_000,
  });

  // The real pots. Cheap multicall; the jackpot number on Home stops being a hardcoded zero.
  const bucketsQ = useQuery({
    queryKey: ["feeBuckets", NETWORK.id],
    queryFn: readFeeBuckets,
    enabled: chain.deployed,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  // What the bag's words have earned (lib/rewards/earnings.ts). The keeper pays every morning at
  // 00:05 UTC (decisions.md #16), so a few minutes' staleness is fine; a refocus reads it again.
  const earningsQ = useQuery({
    queryKey: ["earnings", NETWORK.id, bagKey],
    queryFn: async (): Promise<EarningsJson | null> => {
      const res = await fetch(`/api/rewards/earnings?wallets=${bagWallets.join(",")}`);
      const data = await res.json().catch(() => null);
      // A failed read is "unknown" (null), never "earned nothing".
      return data?.ok ? (data.earnings as EarningsJson) : null;
    },
    enabled: !!address && chain.deployed,
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
  });

  // Shares not paid out yet for the whole bag, from the keeper's published epochs. Polled like the
  // earnings, so a screen left open across the 00:05 UTC payout stops offering what it just paid
  // (Bugbot on #177); Collect also reads it fresh before sending.
  const claimablesQ = useQuery({
    queryKey: ["claimables", NETWORK.id, bagKey],
    queryFn: async () => {
      const res = await fetch(`/api/rewards/claimable?wallets=${bagWallets.join(",")}`);
      const data = await res.json().catch(() => null);
      // A failed read throws, so it's an error (the last good list stays), never "nothing waiting":
      // Collect would otherwise say everything was paid (Bugbot on #177).
      if (!data?.ok) throw new Error(data?.error ?? `claimable ${res.status}`);
      return data.claimables as {
        stream: "yield" | "bounty"; epochId: string; tokenId: string;
        account: `0x${string}`; amount: string; proof: `0x${string}`[];
      }[];
    },
    enabled: !!address && chain.deployed,
    staleTime: 30_000,
    refetchInterval: 5 * 60_000,
    retry: 1, // Collect waits on a refetch; don't make it sit through three retries
  });

  // The letter-swap board (Seaport bulletin). Rows are pre-filtered by the API against
  // getOrderStatus, so everything here is fillable as of the last read.
  const boardQ = useQuery({
    queryKey: ["swapBoard", NETWORK.id],
    queryFn: async () => {
      const res = await fetch("/api/swap/orders");
      const data = await res.json();
      if (!data?.ok) return [];
      // Each maker's profile face rides along (the route resolves it), so the board shows players.
      const faces = (data.profiles ?? {}) as Record<string, PublicFace>;
      return (data.orders as { maker: string; giveId: number; wantId: number; order: LetterSwapOrder; signature: `0x${string}`; orderHash: string }[]).map(
        (o) => ({ ...o, face: faces[o.maker] }),
      );
    },
    enabled: chain.deployed,
    staleTime: 15_000,
    // Other players' offers arrive while the board is on screen, without a reload; elsewhere it
    // doesn't poll (the route checks every order against Seaport).
    refetchInterval: ui.view === "swap" ? 15_000 : false,
  });

  // Words for sale (decisions.md #18). The route reads each word's state live and drops what can't
  // fill, so every row here could be bought as of the last read.
  const wordBoardQ = useQuery({
    queryKey: ["wordBoard", NETWORK.id],
    queryFn: async () => {
      const res = await fetch("/api/swap/words");
      const data = await res.json();
      if (!data?.ok) return [] as (WordListing & { order: SeaportOrder; signature: `0x${string}` })[];
      const faces = (data.profiles ?? {}) as Record<string, PublicFace>;
      return (data.listings as (Omit<WordListing, "price" | "face"> & { order: SeaportOrder; signature: `0x${string}` })[]).map((l) => ({
        ...l,
        price: Number(BigInt(l.priceWei) / 10n ** 18n),
        face: faces[l.maker],
      }));
    },
    enabled: chain.deployed,
    staleTime: 15_000,
    refetchInterval: ui.view === "swap" ? 15_000 : false,
  });

  const toast = useCallback(
    (text: string, tone: Toast["tone"] = "info", ms?: number) => dispatch({ t: "toast", text, tone, ms }),
    [],
  );

  const status: ChainStatus = !chain.deployed
    ? "error"
    : !chain.isConnected
      ? "no-wallet"
      : chain.error
        ? "error"
        : chain.loading || !chain.params || !chain.player
          ? "loading"
          : "ready";

  const chainSaysClaimed = (dayQ.data?.dailyUsed ?? false) || (relatedDayQ.data ?? false);
  const dailyClaimed = chainSaysClaimed || (seenToday !== null && Date.now() - seenToday.at < DAILY_SEEN_TRUST_MS);
  const state: GameState = useMemo(
    () => ({
      ...ui,
      status,
      chainBacked: true,
      error: chain.error,
      balance: chain.player?.balance ?? 0,
      // DISPLAY = the union bag (connected + linked wallets); SPEND = the connected wallet only.
      lower: chain.player
        ? sumLetterCounts([chain.player.letters, othersLettersQ.data ?? []]).slice(0, 26)
        : EMPTY_26,
      upper: chain.player
        ? sumLetterCounts([chain.player.letters, othersLettersQ.data ?? []]).slice(26, 52)
        : EMPTY_26,
      lowerMine: chain.player ? chain.player.letters.slice(0, 26) : EMPTY_26,
      upperMine: chain.player ? chain.player.letters.slice(26, 52) : EMPTY_26,
      pity: overlayPity(pityQ.data ?? EMPTY_26, myPityNotes ?? {}, Date.now()),
      words: (wordsQ.data?.words ?? []).map((w) => toOwnedWord(w, careFor)),
      wordsEverHeld: wordsQ.data?.everHeld ?? 0,
      // "No words yet, and a read in flight" is loading: the first read, and a retry after a failed one
      // (TanStack's isLoading stays false when refetching from an error; Bugbot on #164).
      wordsLoading: wordsQ.isLoading || (!wordsQ.data && wordsQ.isFetching),
      wordsError: wordsQ.isError && !wordsQ.data && !wordsQ.isFetching,
      // Off-chain / not-yet-wired surfaces. These are invented by the mock and have no chain
      // equivalent yet; they are zeroed rather than faked so nothing reads as real.
      streak: 0,
      day: 0,
      // Real, read from dailyUsed[dailyKey] — hardcoding false here showed "Pull" to a player the
      // contract was guaranteed to refuse, and the 409 toast read as a bug on the first live test.
      dailyMinted: dailyClaimed,
      dailyLetter: dailyClaimed && seenToday ? seenToday.idx : null,
      // Real pots + the keeper's actual theme rotation for the current weekly period.
      jackpotPot: bucketsQ.data?.jackpot ?? 0,
      bountyPool: bucketsQ.data?.bounty ?? 0,
      bountyTheme: dayQ.data ? themeForPeriod(Math.floor(dayQ.data.chainDay / 7)) : 0,
      mintCount: 0,
      freeSnackUsed: false,
      jackpotWord: "",
      jackpotRevealed: false,
    }),
    // careFor: the caretaker read lands after the words; `care` must follow it (Bugbot on #173).
    [ui, status, chain.error, chain.player, pityQ.data, myPityNotes, wordsQ.data, wordsQ.isLoading, wordsQ.isError, wordsQ.isFetching, dayQ.data, relatedDayQ.data, bucketsQ.data, dailyClaimed, seenToday, careFor],
  );

  /** Run a batch, surfacing the two outcomes that matter: rejected, and "sent but unconfirmed". */
  const sendBatch = useCallback(
    async (label: string, build: () => Call[], phase: SetPhase, opts?: RunOpts) => {
      try {
        phase("wallet");
        const sent = await chain.send(build(), { sponsored: opts?.sponsored });
        // The wallet has accepted: nothing after this may report the send as failed. A throwing
        // callback would have toasted "failed" and invited a second send while the first lands.
        try {
          opts?.onSent?.(sent);
        } catch (err) {
          console.warn("[send] onSent threw", err);
        }
        phase("working");
        await Promise.all([wordsQ.refetch(), pityQ.refetch(), dayQ.refetch(), relatedDayQ.refetch(), pendingQ.refetch()]);
        if (opts?.settles) return true;
        // The words are a log scan, the read that lags a write the most, and one read right after
        // the send usually misses it. Re-read on the same stagger as useOnchain's player state.
        for (const delay of REFRESH_RETRIES) {
          setTimeout(() => void wordsQ.refetch({ cancelRefetch: false }), delay);
        }
        toast(`${label} sent`, "good");
        return true;
      } catch (err) {
        const msg = (err as Error).message ?? "";
        // A user rejection is not a failure worth alarming anyone about.
        if (/reject|denied|4001/i.test(msg)) toast("Cancelled", "info");
        else toast(`${label} failed: ${msg.slice(0, 80)}`, "bad");
        return false;
      }
    },
    [chain, toast, wordsQ, pityQ, dayQ, pendingQ],
  );

  /**
   * Run a player action under the status pill; a tap while another is in flight only says so. The
   * flow gets its own `run` (sends bound to this action's status) and `phase` (for a step that is
   * not a send, such as a signature).
   */
  const track = useCallback(
    <T,>(label: string, flow: (run: RunFn, phase: SetPhase) => Promise<T>, refused: T) =>
      gate.run(
        label,
        (phase) => flow((l, build, opts) => sendBatch(l, build, phase, opts), phase),
        refused,
        (inFlight) => toast(`Still working on: ${inFlight}`, "info"),
      ),
    [gate, sendBatch, toast],
  );

  /**
   * Send, then keep re-reading the words until the change shows (lib/onchain/settle), and say what
   * happened in the player's terms. The status pill stays on "Waiting for the chain…" meanwhile.
   * Without this a claim, stake, or feed re-read the words once, right after the send, while the
   * RPC still had the old bag: the action looked like it did nothing until a later refocus.
   */
  const sendAndSettle = useCallback(
    async (
      run: RunFn,
      label: string,
      build: () => Call[],
      landed: (words: BagWord[]) => boolean,
      says: { done: (words: BagWord[]) => string; pending: string },
    ) => {
      if (!(await run(label, build, { settles: true }))) return false;
      let last: BagWord[] = [];
      const seen = await readUntil(
        async () => (last = (await wordsQ.refetch({ cancelRefetch: false })).data?.words ?? []),
        landed,
      );
      toast(seen ? says.done(last) : says.pending, seen ? "good" : "info");
      return seen;
    },
    [wordsQ, toast],
  );


  /**
   * POST to a signing route WITH the Quick Auth JWT.
   *
   * A plain fetch cannot reach these at all: every one derives the FID from a verified token and
   * 401s without it, so the whole commit→reveal flow silently dead-ends at the first request.
   */
  const postJson = useCallback(
    <T,>(url: string, body: unknown) => authedPostJson<T>(url, body),
    [],
  );

  /**
   * For the two routes that also serve the verified-wallet identity (daily voucher, letter
   * reveal): token attached when present, plain fetch when not. Everything else stays on
   * `postJson` — its `not_signed_in` pre-flight is load-bearing for the paid flows.
   */
  const openPostJson = useCallback(
    <T,>(url: string, body: unknown) => maybeAuthedPostJson<T>(url, body),
    [],
  );

  /** Server error codes → something a player can act on. */
  /** See lib/onchain/guardedAction — the classification logic lives there so it can be tested. */
  const guarded = useCallback(
    (flow: Parameters<typeof guardedAction>[0]) =>
      guardedAction(flow, { onError: (m) => toast(`Something went wrong: ${m.slice(0, 70)}`, "bad") }),
    [toast],
  );

  /**
   * Today's free snack voucher for `staker`'s profile (POST /api/care/free-snack), or null: the
   * profile used it today, or the server can't say. Null feeds paid, so a lookup never blocks a feed.
   */
  const snackVoucher = useCallback(
    async (staker: string | undefined): Promise<SnackVoucher | null> => {
      if (!address || !staker) return null;
      try {
        const res = await fetch("/api/care/free-snack", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ wallet: address, staker }),
        });
        const j = (await res.json()) as { ok?: boolean; voucher?: SnackVoucher };
        return j?.ok && j.voucher ? j.voucher : null;
      } catch {
        return null;
      }
    },
    [address],
  );

  const authError = useCallback((code: string | undefined, what: string) => {
    if (code === "not_signed_in" || code === "no_farcaster_host" || code === "unauthorized") {
      // Reachable on the web now that SIWF exists, so this asks for a sign-in rather than telling
      // the player to go somewhere else. The older code is still matched: an in-flight response can
      // predate a deploy.
      return `${what} needs a Farcaster sign-in. Tap Connect to sign in`;
    }
    if (code === "rate_limited") return `Too many tries. Give it a moment, then tap ${what} again`;
    // A server-side hiccup (a database write the free claims need, lib/db/freeClaims.ts): nothing was
    // spent, and the same tap works once it clears.
    if (code === "try_again") return `${what} hit a snag on our side. Nothing was spent. Try again in a minute`;
    return `${what} unavailable: ${code ?? "unknown"}`;
  }, []);

  /**
   * The free pack's own refusals, which are mostly NOT errors — they are the campaign telling the
   * player what they still have to do. Routing them through `authError` printed the wire code
   * ("Pack unavailable: share_required"), which names the rule without naming the action.
   */
  const packError = useCallback(
    (code?: string) => {
      switch (code) {
        case "add_required":
          return "Add Lexigotchi first: that’s step one of earning the free pack";
        case "share_required":
          return "Share your cast to unlock the free pack";
        case "eligibility_unavailable":
          // Configured-but-unreachable campaign DB. Nothing was spent and nothing was lost.
          return "Can’t check your free pack right now. Try again in a minute";
        case "already_claimed":
          return "You’ve already opened your free pack";
        case "campaign_closed":
          return "The free-pack campaign has ended";
        default:
          return authError(code, "Pack");
      }
    },
    [authError],
  );

  const dailyError = useCallback(
    (code?: string) => {
      switch (code) {
        case "already_claimed_today":
          return "You’ve already taken today’s letter. It resets at UTC midnight";
        case "verification_required":
          // A wallet with no attestation and no Farcaster session. The screens surface the verify
          // CTA; this copy is the fallback for a claim raced past a stale status.
          return "The daily needs a linked account or a Coinbase-verified wallet. Open your profile";
        case "x_too_young":
          return "Your X account unlocks the daily once it’s 90 days old";
        case "verification_unavailable":
          return "Can’t check your verification right now. Try again in a minute";
        default:
          return authError(code, "The daily");
      }
    },
    [authError],
  );

  /**
   * Second half of a Letters commit→reveal: discover the commit, get the draw, send the reveal.
   *
   * `stranded` is the important branch. The contracts have NO reveal expiry, so a commit that is
   * paid for but never revealed stays open forever. The draw is deterministic in commitId, so
   * retrying later yields the identical letters — which is why it is honest to tell the player it
   * is waiting for them rather than that it failed.
   */
  /**
   * Reveal a KNOWN commit: fetch the deterministic draw, send the reveal, show the letters.
   * Shared by the normal flow and the stranded-commit recovery — the only difference between them
   * is how the commitId was learned.
   */
  const revealCommit = useCallback(
    async (commitId: bigint, run: RunFn): Promise<boolean> => {
      // openPostJson, not postJson: the verified-wallet daily reaches here with no Farcaster
      // session, and the reveal route accepts anonymous callers (buyer-bound + idempotent).
      const draw = await openPostJson<{ reveal: LetterReveal }>("/api/mint/reveal", { commitId: String(commitId) });
      if (!draw?.ok) {
        toast(authError(draw?.error, "Draw"), "bad");
        return false;
      }
      const ok = await run("Reveal", () =>
        revealCalls(commitId, draw.reveal.letterIndexes, draw.reveal.signature),
      );
      if (!ok) return false;
      dispatch({ t: "sheet", sheet: { kind: "pack", letters: draw.reveal.letterIndexes } });
      return true;
    },
    [openPostJson, toast, authError],
  );

  const finishLetterCommit = useCallback(
    async (before: readonly bigint[], strandedMsg: string, run: RunFn) => {
      if (!address) return;
      toast("Opening…", "info");
      const commit = await waitForNewCommit(address, before);
      if (!commit) return void toast("Committed but slow to appear. It’ll be waiting for you", "info");
      if (!(await revealCommit(commit.commitId, run))) return void toast(strandedMsg, "info");
    },
    [address, toast, revealCommit],
  );

  /** Lay a pity value the client KNOWS over the lagging chain read, for that roll's owner. */
  const notePity = useCallback((owner: string, letterIndex: number, value: number) => {
    const key = owner.toLowerCase();
    setPityNotes((all) => ({ ...all, [key]: { ...all[key], [letterIndex]: { value, at: Date.now() } } }));
  }, []);

  /**
   * Roll commits the server has CONFIRMED revealed (relayed "mined" or "already"; never a wallet-sent
   * reveal, which may not be mined yet). "Roll again" commits a new roll seconds after a reveal, and
   * an RPC node a block behind can still read the old commit as open then: picked up as "your
   * unfinished roll" or as the "new" commit, it would replay the old result and leave the new paid
   * roll open. These ids are never open again, so every search for an open roll skips them.
   */
  const revealedRolls = useRef(new Set<string>());

  /**
   * Reveal a KNOWN, already-paid roll commit. The server finishes it (sends the reveal from its
   * relayer key, decisions.md #14), so the wallet never previews the result; when the server can't
   * send, it returns the signature and the player's wallet sends it, as before.
   */
  const revealRoll = useCallback(
    async (id: bigint, run: RunFn): Promise<ActionOutcome> => {
      // openPostJson: the reveal is owner-bound and idempotent, so it needs no Farcaster session.
      const draw = await openPostJson<{ reveal: RollReveal }>("/api/roll/reveal", { commitId: String(id), relay: true });
      if (!draw?.ok) {
        toast(authError(draw?.error, "Roll"), "bad");
        return { status: "stranded", note: "Your roll is paid for. Reopen to finish it" };
      }
      const r = draw.reveal;
      if (r.relayed) {
        // No send of ours to refresh after, so re-read everything a reveal changes, on a stagger.
        const reread = () => {
          void chain.refresh();
          void Promise.all([pityQ.refetch(), wordsQ.refetch(), pendingQ.refetch()]);
        };
        reread();
        for (const delay of [2_000, 6_000, 15_000]) setTimeout(reread, delay);
        if (r.relayed === "mined") {
          revealedRolls.current.add(String(id));
          if (Number.isInteger(r.pity) && Number.isInteger(r.letterIndex)) notePity(r.owner, r.letterIndex, r.pity!);
          return { status: "resolved", success: r.success };
        }
        if (r.relayed === "already") {
          revealedRolls.current.add(String(id));
          return { status: "resolved", success: r.success };
        }
        // Broadcast but not yet mined: the chain finishes it; a second reveal would only revert.
        return { status: "stranded", note: "Your roll is finishing onchain. It’ll show in a moment." };
      }
      const ok = await run("Reveal", () => rollRevealCalls(id, draw.reveal.success, draw.reveal.signature));
      if (!ok) return { status: "stranded", note: "Your roll is paid for. Reopen to finish it" };
      // Show the new pity now (the reveal is sent, so this is what the chain will say), and re-read
      // on a stagger so the real value replaces it as soon as a node has it.
      const { letterIndex, pityAtCommit, success, owner } = draw.reveal;
      const known = Number.isInteger(pityAtCommit) ? knownPityAfter(success, pityAtCommit) : null;
      if (known !== null && Number.isInteger(letterIndex) && typeof owner === "string") notePity(owner, letterIndex, known);
      for (const delay of [2_000, 6_000, 15_000]) setTimeout(() => void pityQ.refetch(), delay);
      return { status: "resolved", success };
    },
    [openPostJson, toast, authError, pityQ, wordsQ, pendingQ, chain, notePity],
  );

  /** Second half of a roll. Distinguishes a real miss from a stale no-op via the pity streak. */
  const finishRoll = useCallback(
    async (before: readonly bigint[], run: RunFn, owner?: `0x${string}`): Promise<ActionOutcome> => {
      if (!address) return { status: "not-started" };
      toast("Rolling…", "info");
      // Everything past this point follows a PAID commit, so no failure here is "safe to retry".
      // A caretaker's word roll is committed in the STAKER's name (Rolls keys it on the owner).
      // Skip confirmed reveals too: a lagging read of one is not the commit just sent.
      const id = await waitForNewRollCommit(owner ?? address, [...before, ...[...revealedRolls.current].map(BigInt)]);
      if (id === null) {
        return { status: "stranded", note: "Roll committed but slow to appear. Reopen to finish it" };
      }
      return revealRoll(id, run);
    },
    [address, toast, revealRoll],
  );

  /**
   * Rolls allows ONE unrevealed roll per (owner, letter) (the audit fix: no banking signed successes
   * at capped pity), so a new commit on a letter with an open roll would revert. Finish the open
   * one instead: it is already paid for, and finishing it is the only way that letter rolls again.
   */
  const resumeOpenRoll = useCallback(
    async (letterIndex: number, markPaid: () => void, run: RunFn, owner?: `0x${string}`): Promise<ActionOutcome | null> => {
      if (!address) return null;
      // Confirmed reveals are skipped INSIDE the scan, so a lagging read of one can't hide a later
      // commit that really is open.
      const open = await readOpenRollFor(owner ?? address, letterIndex, revealedRolls.current);
      if (open === null) return null;
      toast("Finishing your unfinished roll on this letter first", "info");
      markPaid(); // paid at its commit; a failure from here leaves it open, never "try again for free"
      return revealRoll(open, run);
    },
    [address, toast, revealRoll],
  );

  /** Too few letters left for a commit of `count`: the contract would revert SoldOut. */
  const soldOutFor = useCallback(
    (count: number) => {
      const left = chain.params?.unreservedSupply;
      if (left == null || left >= count) return false;
      toast("Sold out: every letter is minted or spoken for", "info");
      return true;
    },
    [chain.params, toast],
  );


  const api: GameApi = useMemo(
    () => ({
      state,
      nav: (view: View) => dispatch({ t: "nav", view }),
      openSheet: (sheet: Sheet) => dispatch({ t: "sheet", sheet }),
      closeSheet: () => dispatch({ t: "sheet", sheet: null }),
      toast,
      dismissToast: (id: number) => dispatch({ t: "untoast", id }),

      // Affordability is answered from the live balance; while it's unknown the answer is NO, and
      // ChainGate keeps those screens off-screen entirely so nobody sees a false "you're broke".
      canAfford: (amount: number) => (chain.player ? chain.player.balance >= amount : false),
      // The contract's own prices (chain.params, re-read after every repeg). Until they load, the
      // mock table stands in as a label only: canAfford is false without chain.player, and every
      // send builds its calldata from chain.params, never from this number.
      lettersLeft: chain.params?.unreservedSupply ?? null,
      // Until params load, assume OFF: better a hidden button for a moment than one that reverts.
      maxPrestigeLevel: chain.params?.maxPrestigeLevel ?? 0,
      price: (item: PriceItem) => (chain.params ? chainPrice(chain.params.word, item) : MOCK_PRICE[item]),
      // The word ladder: a stage-N attempt costs N × Prestige.prestigeFee (the contract's stageFee).
      prestigePrice: (level: number) =>
        (chain.params ? chainPrice(chain.params.word, "prestige") : MOCK_PRICE.prestige) * stageFeeMultiple(level),

      /**
       * The free daily. Two identities can earn the voucher — a Farcaster FID, or a Coinbase-
       * verified wallet — so this goes through openPostJson: token when present, plain when the
       * attestation is the identity.
       *
       * With a bundle (the normal case) commit + reveal go out as ONE send: a single prompt on
       * 5792 wallets, two back-to-back prompts on the fallback — no polling gap between them,
       * because the gap is where the first live daily lost its reveal. Without a bundle it falls
       * back to the original two-phase discover-then-reveal.
       */
      dailyMint: () =>
        track("Minting your daily letter", (run) => guarded(async (markPaid) => {
          if (!address) { toast("Connect a wallet first", "bad"); return { status: "not-started" as const }; }
          if (soldOutFor(1)) return { status: "not-started" as const };
          const res = await openPostJson<{ voucher: DailyVoucher; bundle: DailyBundle | null }>(
            "/api/mint/free-daily",
            { wallet: address },
          );
          if (!res?.ok) { toast(dailyError(res?.error), "bad"); return { status: "not-started" as const }; }
          const v = res.voucher;
          const commitCalls = () =>
            commitFreeDailyCalls({ fid: BigInt(v.fid), deadline: BigInt(v.deadline), signature: v.signature });

          if (res.bundle) {
            const b = res.bundle;
            const sent = await run("Daily", () => [
              ...commitCalls(),
              ...revealCalls(BigInt(b.predictedCommitId), b.letterIndexes, b.revealSignature),
            ]);
            if (sent) {
              markPaid();
              noteDailyRef.current(b.letterIndexes[0] ?? null);
              // The letters are safe to show before mining confirms: the draw is (identity, day)-
              // deterministic, so whatever finishes this commit — this send or the recovery card
              // after a commitId race — mints exactly these.
              dispatch({ t: "sheet", sheet: { kind: "pack", letters: b.letterIndexes } });
              return { status: "resolved" as const, success: true };
            }
            // The send failed somewhere. On the two-prompt fallback that can mean "commit went
            // out, reveal was declined" — check the chain rather than guess, so a mere cancel at
            // the first prompt isn't reported as money moved.
            const day = await dayQ.refetch();
            void pendingQ.refetch();
            if (day.data?.dailyUsed) {
              markPaid();
              noteDailyRef.current(null);
              return { status: "stranded" as const, note: "Your letter is committed. Tap Open to reveal it" };
            }
            return { status: "not-started" as const };
          }

          // No bundle — the original two-phase flow.
          const before = (await readPendingCommits(address)).map((c) => c.commitId);
          if (!(await run("Daily", commitCalls))) return { status: "not-started" as const };
          markPaid();
          noteDailyRef.current(null); // claimed; the letter shows in the pack sheet once revealed
          await finishLetterCommit(before, "Your daily letter is paid for. Reopen to finish it", run);
          // Letters arrive via the pack sheet; the caller only needs "don't call this again".
          return { status: "resolved", success: true };
        }), NOT_STARTED),

      /**
       * The full two-transaction pack: voucher → commit → discover the commitId from the log →
       * backend draw → reveal. Returns [] because the letters genuinely do not exist yet; the sheet
       * opens when they do.
       */
      openPack: () => {
        void track("Opening your free pack", async (run) => {
          if (!address) return void toast("Connect a wallet first", "bad");
          if (soldOutFor(5)) return;

          const res = await postJson<{ voucher: PackVoucher }>("/api/mint/free-pack", { wallet: address });
          if (!res?.ok) return void toast(packError(res?.error), "bad");

          // Snapshot what was already outstanding so the new commit can be told apart from a
          // previously stranded one.
          const before = (await readPendingCommits(address)).map((c) => c.commitId);

          const v = res.voucher;
          const sent = await run("Pack", () =>
            commitFreePackCalls({
              fid: BigInt(v.fid),
              nonce: BigInt(v.nonce),
              deadline: BigInt(v.deadline),
              signature: v.signature,
            }),
          );
          if (!sent) return;

          // Logs are not queryable the instant a tx mines, so poll. A timeout here means UNKNOWN,
          // never failed — the commit may well exist, and the pack is recoverable either way.
          toast("Opening…", "info");
          const commit = await waitForNewCommit(address, before);
          if (!commit) {
            return void toast("Pack is committed but slow to appear. It’ll be waiting for you", "info");
          }

          const draw = await postJson<{ reveal: LetterReveal }>("/api/mint/reveal", { commitId: String(commit.commitId) });
          if (!draw?.ok) return void toast(authError(draw?.error, "Draw"), "bad");

          const revealed = await run("Reveal", () =>
            revealCalls(commit.commitId, draw.reveal.letterIndexes, draw.reveal.signature),
          );
          if (!revealed) {
            // The draw is deterministic, so retrying later yields the identical letters.
            return void toast("Your pack is paid for. Reopen to finish it", "info");
          }
          dispatch({ t: "sheet", sheet: { kind: "pack", letters: draw.reveal.letterIndexes } });
        }, undefined);
        return [];
      },

      /**
       * A PAID pack: approve + commitPack, then the signed reveal. Any wallet can buy one; the
       * reveal route needs no sign-in. Same money rule as the rolls: once the commit is sent, every
       * later failure is "stranded" (paid, and recoverable from PendingReveal), never "try again".
       */
      buyPack: () =>
        track("Buying a pack", (run) => guarded(async (markPaid) => {
          if (!chain.params || !chain.player || !address) {
            toast("Connect a wallet first", "bad");
            return { status: "not-started" as const };
          }
          if (soldOutFor(5)) return { status: "not-started" as const };
          const before = (await readPendingCommits(address)).map((c) => c.commitId);
          if (!(await run("Pack", () => commitPackCalls(chain.params!, chain.player!)))) {
            return { status: "not-started" as const };
          }
          markPaid(); // the pack price is spent from here on
          toast("Opening…", "info");
          const commit = await waitForNewCommit(address, before);
          if (!commit) return { status: "stranded" as const, note: "Your pack is paid for. It’ll be waiting for you." };
          // revealCommit opens the pack sheet itself once the letters exist.
          if (!(await revealCommit(commit.commitId, run))) {
            return { status: "stranded" as const, note: "Your pack is paid for. Reopen it to finish." };
          }
          return { status: "resolved" as const, success: true };
        }), NOT_STARTED),

      rollLoose: (idx: number) =>
        track(`Rolling your ${String.fromCharCode(97 + idx)}`, (run) => guarded(async (markPaid) => {
          if (!chain.params || !chain.player || !address) return { status: "not-started" as const };
          // No sign-in pre-check: the roll reveal serves any wallet (see /api/roll/reveal), so a
          // wallet-only player can always finish a roll they paid for.
          const resumed = await resumeOpenRoll(idx, markPaid, run);
          if (resumed) return resumed;
          const before = await readOpenRollCommits(address);
          if (!(await run("Roll", () => commitLooseRollCalls(idx, chain.params!, chain.player!)))) return { status: "not-started" as const };
          markPaid(); // the fee is taken from here on — no failure past this point is retryable
          return finishRoll(before, run);
        }), NOT_STARTED),

      rollWord: (word: string, pos: number) =>
        track(`Rolling a letter in ${word}`, (run) => guarded(async (markPaid) => {
          if (!chain.params || !chain.player || !address) return { status: "not-started" as const };
          // No sign-in pre-check: the roll reveal serves any wallet (see /api/roll/reveal), so a
          // wallet-only player can always finish a roll they paid for.
          // The pity key is (owner, letter), so a word slot shares it with the loose letter.
          // A caretaker rolls in the staker's name: the open-roll slot and the commit are the staker's.
          const target = state.words.find((x) => x.word === word);
          const owner = (target?.care && target.holder ? target.holder : address) as `0x${string}`;
          // A caretaker's roll moves the STAKER's pity: re-read it after any reveal (a resumed one
          // too), since the chain lags a fresh reveal (Bugbot on #173).
          const refreshOwnerPity = () => {
            if (owner.toLowerCase() === address.toLowerCase()) return;
            for (const ms of [0, 4_000, 10_000]) setTimeout(() => void qc.invalidateQueries({ queryKey: ["pity", NETWORK.id, owner.toLowerCase()] }), ms);
          };
          const resumed = await resumeOpenRoll(word.toUpperCase().charCodeAt(pos) - 65, markPaid, run, owner);
          if (resumed) {
            refreshOwnerPity();
            return resumed;
          }
          const before = await readOpenRollCommits(owner);
          if (!(await run("Roll", () => commitWordRollCalls(tokenIdOf(word), pos, chain.params!, chain.player!)))) return { status: "not-started" as const };
          markPaid(); // the fee is taken from here on — no failure past this point is retryable
          const outcome = await finishRoll(before, run, owner);
          refreshOwnerPity();
          return outcome;
        }), NOT_STARTED),

      prestige: (word: string) =>
        track(`Ascending ${word}`, (run) => guarded(async (markPaid) => {
          if (!chain.params || !chain.player || !address) return { status: "not-started" as const };
          // One unrevealed ascension per Word (Prestige.attemptOpen): finish an open one, never pay twice.
          let id = await readOpenPrestigeFor(tokenIdOf(word));
          // The stage this attempt aims past (the word ladder: price and odds both depend on it).
          const level = state.words.find((x) => x.word === word)?.prestigeLevel ?? 0;
          if (id !== null) {
            toast("Finishing your unfinished ascension first", "info");
            markPaid(); // paid at its commit
          } else {
            // A caretaker's ascension is committed in the staker's name (Prestige names the staker).
            const target = state.words.find((x) => x.word === word);
            const owner = (target?.care && target.holder ? target.holder : address) as `0x${string}`;
            const before = await readOpenPrestigeCommits(owner);
            if (!(await run("Ascension", () => commitPrestigeCalls(tokenIdOf(word), level, chain.params!, chain.player!)))) return { status: "not-started" as const };
            markPaid(); // fee + burned snack are gone from here on
            toast("Ascending…", "info");
            id = await waitForNewPrestigeCommit(owner, before);
            if (id === null) {
              return { status: "stranded", note: "Ascension committed but slow to appear. Reopen to finish it" };
            }
          }
          const commitId = id;
          const draw = await openPostJson<{ reveal: PrestigeReveal }>("/api/prestige/reveal", { commitId: String(commitId) });
          if (!draw?.ok) {
            toast(authError(draw?.error, "Ascension"), "bad");
            return { status: "stranded", note: "Ascension is paid for. Reopen to finish it" };
          }
          if (!(await run("Reveal", () => prestigeRevealCalls(commitId, draw.reveal.success, draw.reveal.signature)))) {
            return { status: "stranded", note: "Ascension is paid for. Reopen to finish it" };
          }
          // Announce it here: WordSheet returns early on a promise, so nothing else reports this.
          const reached = (draw.reveal.level ?? level) + 1;
          toast(draw.reveal.success
                  ? reached >= HOLOGRAPHIC_LEVEL ? `${word} turned Holographic!` : `${word} reached ${stageName(reached)}`
                  : `${word} held its ground. Next try’s odds are higher`,
                draw.reveal.success ? "good" : "info");
          return { status: "resolved", success: draw.reveal.success };
        }), NOT_STARTED),

      claim: (word: string, cases: boolean[]) => {
        void track(`Claiming ${word}`, async (run) => {
          if (!chain.params || !chain.player) return void toast("Still loading", "info");
          // Words.claim takes the letters from THIS wallet, each in the case named: a case this
          // wallet doesn't hold reverts onchain, so say it here instead of sending.
          if (!canSpellAs(word, cases, mineLower(state), mineUpper(state))) return void toast(`Can’t claim ${word} with these letters`, "bad");
          const proof = await fetch(`/api/dictionary/proof?word=${encodeURIComponent(word)}`).then((r) => r.json());
          if (!proof.ok) {
            // The word list was updated and the contract hasn't caught up (setDictionaryRoot).
            if (proof.error === "dictionary_mismatch") {
              return void toast("The word list was just updated. Claims reopen shortly.", "info");
            }
            return void toast(`${word} isn’t claimable`, "bad");
          }
          const W = word.toUpperCase();
          const landed = await sendAndSettle(
            run,
            `Claim ${word}`,
            () => claimCalls(proof.word, proof.proof, caseMask(cases), chain.params!, chain.player!),
            (ws) => ws.some((x) => x.word === W),
            {
              done: () => `${W} is yours. It’s in your Bag.`,
              pending: `Sent. ${W} will show in your Bag once the chain confirms it.`,
            },
          );
          // The new word celebrates once it reads back (sheets/CelebrateSheet).
          if (landed) dispatch({ t: "sheet", sheet: { kind: "celebrate", word: W } });
        }, undefined);
      },

      toggleStake: (word: string) => {
        const w = state.words.find((x) => x.word === word);
        if (!w || !chain.player) return;
        const staking = !w.staked;
        void track(staking ? `Staking ${word}` : `Unstaking ${word}`, (run) =>
          sendAndSettle(
            run,
            staking ? `Stake ${word}` : `Unstake ${word}`,
            () => (staking ? stakeCalls(tokenIdOf(word), chain.player!) : unstakeCalls(tokenIdOf(word))),
            (ws) => ws.some((x) => x.word === word && x.staked === staking),
            {
              done: (ws) => {
                if (!staking) return `${word} is unstaked. It’s out of the daily jackpot.`;
                // Hunger survives an unstake (the clock keeps running), so a restaked word can be
                // staked and still too hungry to enter the jackpot.
                const now = ws.find((x) => x.word === word);
                return now && jackpotEligible(toOwnedWord(now))
                  ? `${word} is staked. It’s in the daily jackpot.`
                  : `${word} is staked. Feed it to enter the daily jackpot.`;
              },
              pending: `Sent. ${word} will show as ${staking ? "staked" : "unstaked"} once the chain confirms it.`,
            },
          ), false);
      },

      feed: (word: string) => {
        if (!chain.params || !chain.player) return;
        // A feed moves Staking.lastFed, which the word's card reads (via the words list) for its mood.
        const w = state.words.find((x) => x.word === word);
        const before = w?.lastFedAt ?? 0;
        // The day's free snack is the staker's profile's: ask for its voucher, else feed paid.
        const staker = w?.mine ? address : w?.holder;
        void track(`Feeding ${word}`, async (run) => {
          const voucher = await snackVoucher(staker);
          return sendAndSettle(
            run,
            `Feed ${word}`,
            () =>
              voucher
                ? feedWithSnackCalls([tokenIdOf(word)], voucher, chain.params!, chain.player!)
                : feedCalls(tokenIdOf(word), chain.params!, chain.player!),
            (ws) => ws.some((x) => x.word === word && x.lastFedAt > before),
            {
              done: () => `${word} is fed.`,
              pending: `Sent. ${word} will show as fed once the chain confirms it.`,
            },
          );
        }, false);
      },

      feedAll: () => {
        if (!chain.params || !chain.player) return;
        // Only words that are actually hungry — feed() has no on-chain guard, so feeding a fed word
        // burns a snack for nothing and there is no revert to catch.
        // Mine, or a staker's word this wallet cares for (Staking.setCaretaker): feed() accepts both.
        // Any other linked wallet's word would revert the batch.
        const hungryWords = state.words.filter((w) => (w.mine || w.care) && w.staked && w.daysUnfed > 0);
        const hungry = hungryWords.map((w) => tokenIdOf(w.word));
        if (hungry.length === 0) return void toast("Nobody’s hungry", "info");
        const before = new Map(hungryWords.map((w) => [w.word, w.lastFedAt ?? 0]));
        // One voucher, for the first word's staker's profile: it frees that word, the rest are paid.
        const first = hungryWords[0];
        const firstStaker = first.mine ? address : first.holder;
        void track("Feeding your words", async (run) => {
          const voucher = await snackVoucher(firstStaker);
          return sendAndSettle(
            run,
            "Feed all",
            () =>
              voucher
                ? feedWithSnackCalls(hungry, voucher, chain.params!, chain.player!)
                : feedManyCalls(hungry, chain.params!, chain.player!),
            (ws) => [...before].every(([w, t]) => ws.some((x) => x.word === w && x.lastFedAt > t)),
            {
              done: () => (before.size === 1 ? `${[...before.keys()][0]} is fed.` : "Your words are fed."),
              pending: "Sent. Your words will show as fed once the chain confirms it.",
            },
          );
        }, false);
      },

      reloadWords: () => void wordsQ.refetch(),

      // Any wallet's pity with this browser's fresh reveal notes laid over it (the chain read lags):
      // the roll sheet reads the STAKER's this way for a word this wallet cares for.
      pityOf: (wallet: string, chainPity: readonly number[]) =>
        overlayPity(chainPity, pityNotes[wallet.toLowerCase()] ?? {}, Date.now()),

      setCaretaker: (wallet: string, allowed: boolean) =>
        track(allowed ? "Adding a caretaker" : "Removing a caretaker", async (run) => {
          if (!address) return false;
          const w = wallet.toLowerCase() as `0x${string}`;
          if (w === address.toLowerCase()) return false;
          const ok = await run(allowed ? "Let it care for your words" : "Stop it caring for your words", () => setCaretakerCalls(w, allowed));
          if (ok) for (const key of ["caretakers", "careFor"]) void qc.invalidateQueries({ queryKey: [key] });
          return ok;
        }, false),

      moveToWallet: (to: string, opts?: { includeWord?: boolean }) =>
        track<MoveOutcome>(`Moving to ${to.slice(0, 6)}…${to.slice(-4)}`, async (run) => {
          if (!address) return "no_wallet";
          const from = address.toLowerCase() as `0x${string}`;
          const dest = to.toLowerCase() as `0x${string}`;
          // The destination must be in THIS wallet's account right now: read the account fresh
          // (past every cache), never trusting a list the page held. A move can't be undone.
          try {
            const r = await fetch(`/api/profile/public?address=${from}&t=${Date.now()}`, { cache: "no-store" });
            const d = (await r.json()) as { profile?: { wallets?: string[] } };
            const wallets = (d.profile?.wallets ?? []).map((w) => w.toLowerCase());
            if (dest === from || !wallets.includes(dest)) {
              toast("That wallet isn’t in your account anymore", "bad");
              return "not_linked";
            }
          } catch {
            toast("Couldn’t check your wallets. Try again.", "bad");
            return "failed";
          }
          // What this wallet holds now, from the chain (the bag on screen may be a minute old).
          const [counts, held, balances] = await Promise.all([
            readLetterCounts(from),
            readOwnedWords(from),
            opts?.includeWord ? readWalletBalances([from]) : Promise.resolve(null),
          ]);
          // $WORD only when the player ticked it: all of it, read now (it pays for everything).
          const plan = movePlan(counts, held, balances?.[from]?.word ?? 0n);
          if (planIsEmpty(plan)) {
            toast(plan.staked ? "Only staked words here, and they stay staked" : "Nothing here to move", "info");
            return "empty";
          }
          if ((await readOpenRolls(from, lowercaseIndexesOf(plan))).length > 0) {
            toast("A roll is still open on this wallet. Move after it finishes.", "info");
            return "open_roll";
          }
          // Moves are free where the wallet and the paymaster can sponsor them (smart wallets).
          const ok = await run(`Move to ${dest.slice(0, 6)}…${dest.slice(-4)}`, () => moveCalls(from, dest, plan), { sponsored: true });
          // Refresh after ANY attempt that reached the wallet, not just a full success: without a
          // wallet that batches, the calls go one by one, so the letters can land while a word
          // transfer is declined, and the rows would keep showing the old counts. Both wallets'
          // bags, the world, and every per-wallet holdings line read again.
          for (const key of ["playerState", "ownedWords", "linkedLetters", "walletHoldings", "world"]) {
            void qc.invalidateQueries({ queryKey: [key] });
          }
          return ok ? "sent" : "failed";
        }, "busy"),

      dissolve: (word: string) => {
        void track(`Dissolving ${word}`, async (run) => {
          const w = state.words.find((x) => x.word === word);
          if (!w) return;
          const id = tokenIdOf(word);
          // Words.dissolve requires msg.sender to be the ERC-721 owner. Staking HOLDS the NFT, so a
          // staked word reverts NotOwner. Unstake in the same batch first.
          const ok = await run(`Dissolve ${word}`, () =>
            w.staked ? [...unstakeCalls(id), ...dissolveCalls(id, word)] : dissolveCalls(id, word),
          );
          if (!ok) return;
          dispatch({ t: "sheet", sheet: null });
        }, undefined);
      },
      revealJackpot: () => null,
      skipDay: () => toast("Time moves on its own here", "info"),

      // The faucet replaces addDemoBalance — real tokens on a testnet, nothing on mainnet.
      //
      // It waits for the MINT, not the send. A send returns when the wallet accepts: on 2026-11-24 a
      // tester saw "Faucet sent" over a balance that never moved, and no transaction from their
      // wallet ever reached Base Sepolia (it held Base Sepolia ETH). So "arrived" needs the mint's
      // own result (`settleSend`: its receipt, or the wallet's batch status), and anything else is
      // named to the player. Watching the balance instead both missed real mints and passed off
      // earlier ones as new, so the balance is only the fallback for a send nobody can trace. It
      // never refuses to send for want of ETH: sponsored smart wallets mint holding none.
      addDemoBalance: () => {
        if (!NETWORK.isTestnet) return void toast("No faucet on mainnet", "bad");
        if (!address) return void toast("Connect a wallet first", "bad");
        void track("Getting test $WORD", async (run) => {
          const FAUCET = 50_000_000;
          /** Every read is capped: the action gate waits on all of it, and viem retries each read. */
          const READ_MS = 5_000;
          const client = getPublicClient();
          const balanceOf = () =>
            orThrowAfter(
              client.readContract({
                address: wordTokenAddress(), abi: erc20Abi, functionName: "balanceOf", args: [address],
              }) as Promise<bigint>,
              READ_MS,
            );
          // Only the fallback below uses this, so the send never waits on it. A FRESH read, never the
          // cached balance: a cache from before a spend set a target the mint could never reach.
          const before = await balanceOf().catch(() => undefined);
          let sent: SendResult | undefined;
          const ok = await run("Faucet", () => faucetCalls(address, FAUCET), {
            settles: true,
            onSent: (r) => (sent = r),
          });
          if (!ok) return;

          // A read that FAILS must not pass for "not found": only viem's not-found errors mean that.
          const notFound = (e: unknown, name: string) => {
            if ((e as { name?: string })?.name === name) return null;
            throw e;
          };
          // The mint's own result decides (receipt, or the wallet's batch status). The balance counts
          // only for a send nobody can trace, and only the whole mint from the fresh start.
          const last: { trace: SendTrace } = { trace: { kind: "unknown" } };
          const settled = await withTimeout(
            settleSend(
              sent,
              {
                chainId: NETWORK.id,
                walletTimeoutMs: READ_MS,
                receipt: (hash) =>
                  orThrowAfter(client.getTransactionReceipt({ hash }), READ_MS).then(
                    (r) => ({ status: r.status }),
                    (e) => notFound(e, "TransactionReceiptNotFoundError"),
                  ),
                known: (hash) =>
                  orThrowAfter(client.getTransaction({ hash }), READ_MS).then(
                    () => true,
                    (e) => notFound(e, "TransactionNotFoundError") ?? false,
                  ),
                callsStatus: async (id) => {
                  const provider = (await connector?.getProvider?.()) as Eip1193Provider | undefined;
                  if (!provider) throw new Error("no provider");
                  return provider.request({ method: "wallet_getCallsStatus", params: [id] });
                },
              },
              {
                onTrace: (t) => (last.trace = t),
                changed: before === undefined ? undefined : async () => (await balanceOf()) >= before + toWordWei(FAUCET),
              },
            ),
            45_000,
            null,
          );
          const trace = settled ?? last.trace;
          void chain.refresh();
          if (trace.kind === "landed" || trace.kind === "seen") {
            return void toast(`Test $WORD arrived: ${fmtWord(FAUCET)}`, "good");
          }

          // For a desktop tester's console, and for us when they share it.
          console.warn("[faucet] no test $WORD arrived", { address, sent, trace });
          // These come up to ~45 s after the tap, often while the player is in their wallet app, and
          // they are the only explanation the player gets: they stay up for 15 s (a hidden tab also
          // holds them, see ToastItem).
          const say = (text: string, tone: Toast["tone"]) => toast(text, tone, 15_000);
          const at = "hash" in trace ? ` (${shortHash(trace.hash)})` : "";
          const here = NETWORK.name;
          switch (trace.kind) {
            case "reverted":
              return void say(`The faucet transaction failed on ${here}${at}. Try again.`, "bad");
            case "pending":
              return void say(`Your faucet transaction is still waiting on ${here}${at}.`, "info");
            case "unseen":
              // Base's mempool is private, so a transaction still queued in the wallet looks like this.
              return void say(
                `Your wallet says it sent the faucet transaction${at}, but ${here} hasn’t seen it. Your wallet may be holding it behind an earlier transaction, or sent it on another network.`,
                "bad",
              );
            case "other_chain": {
              const there = networkById(trace.chainId)?.name ?? `another network (chain ${trace.chainId})`;
              return void say(`Your wallet ran the faucet on ${there}, not ${here}. Nothing was minted.`, "bad");
            }
            case "wallet_failed":
              return void say("Your wallet says the faucet transaction failed. Try again.", "bad");
            case "wallet_pending":
              return void say("Your wallet says the faucet transaction is still pending.", "info");
            case "unknown": {
              // Sponsored smart wallets hold no ETH and need none, so this only says "if". The sheet
              // may be closed by now, so it says where the link is rather than "below".
              const eth = await withTimeout(client.getBalance({ address }).catch(() => null), READ_MS, null);
              return void say(
                eth === 0n
                  ? `No test $WORD yet. If your wallet pays its own gas, it needs ${here} ETH: Your $WORD has a link to get some free.`
                  : "Your wallet accepted it, but no test $WORD has arrived yet. Check your wallet’s activity.",
                "info",
              );
            }
          }
        }, undefined);
      },

      earnings: earningsQ.data
        ? earningsFromJson(earningsQ.data, (id) => state.words.find((w) => tokenIdOf(w.word).toString() === id)?.word)
        : null,
      claimables: (claimablesQ.data ?? []).map((c) => ({
        stream: c.stream,
        tokenId: c.tokenId,
        amount: Number(BigInt(c.amount) / 10n ** 12n) / 1e6, // wei → whole $WORD for display
      })),
      claimEarnings: () => {
        if ((claimablesQ.data ?? []).length === 0) return;
        // "Collect", never "Claim": claiming is what spelling a word does.
        void track("Collecting your earnings", async (run) => {
          // Read the list fresh before sending: the keeper may have paid some of it since the screen
          // last looked, and a claim of a paid share reverts the whole send (Bugbot on #177).
          const fresh = await claimablesQ.refetch();
          if (fresh.isError) {
            toast("Couldn’t check what’s waiting. Try again in a moment.", "bad");
            return;
          }
          const raw = fresh.data ?? [];
          if (raw.length === 0) {
            void earningsQ.refetch();
            toast("Already paid out: nothing left to collect", "good");
            return;
          }
          const claims: RewardClaim[] = raw.map((c) => ({
            stream: c.stream,
            epochId: BigInt(c.epochId),
            tokenId: BigInt(c.tokenId),
            account: c.account,
            amount: BigInt(c.amount),
            proof: c.proof,
          }));
          if (await run("Collect", () => claimRewardCalls(claims))) {
            void claimablesQ.refetch();
            void earningsQ.refetch();
          }
        }, undefined);
      },

      spendable: (w: OwnedWord) =>
        !!chain.params && !!chain.player && chain.player.balance >= chain.params.word.roll && !w.upper.every(Boolean),
      rollProb: (pity: number) => rollSuccessProbability(pity),
      prestigeProb: (level: number, pity: number) => prestigeSuccessProbability(pity, level),

      swapBoard: (boardQ.data ?? []).map(({ maker, giveId, wantId, orderHash, face }) => ({ maker, giveId, wantId, orderHash, face })),

      /**
       * List an offer: one-time Seaport approval if missing (a real tx), then a FREE EIP-712
       * signature, then the bulletin POST. The signature is the order; the DB is just where it
       * waits. Fixed 1⇄1 letter shape — the server rejects anything else.
       */
      createSwapOffer: (giveId: number, wantId: number) => {
        void track("Listing your offer", async (run, phase) => {
          if (!address) return void toast("Connect a wallet first", "bad");
          const letters = addressOf("letters");
          const client = getPublicClient();
          try {
            const approved = (await client.readContract({
              address: letters, abi: erc1155ApprovalAbi, functionName: "isApprovedForAll",
              args: [address, SEAPORT],
            })) as boolean;
            if (!approved) {
              if (!(await run("Approve swap", () => operatorApprovalCalls({ collection: letters, operator: SEAPORT, approved: false })))) return;
            }
            const counter = (await client.readContract({
              address: SEAPORT, abi: seaportAbi, functionName: "getCounter", args: [address],
            })) as bigint;
            const saltBytes = new Uint8Array(16);
            crypto.getRandomValues(saltBytes);
            const salt = BigInt("0x" + [...saltBytes].map((b) => b.toString(16).padStart(2, "0")).join(""));
            const order = buildLetterSwapOrder({
              maker: address, giveId, wantId, counter,
              nowSeconds: Math.floor(Date.now() / 1000) - 60, salt,
            });
            // A SIGNATURE, not a transaction — free, instant, and Seaport judges it at fill time.
            const provider = (await connector?.getProvider()) as { request: (a: { method: string; params: unknown[] }) => Promise<unknown> } | undefined;
            if (!provider) return void toast("This wallet can’t sign offers", "bad");
            phase("wallet");
            const signature = (await provider.request({
              method: "eth_signTypedData_v4",
              params: [address, walletTypedDataJson(order)],
            })) as `0x${string}`;
            phase("working");
            const res = await fetch("/api/swap/orders", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ order, signature }),
            }).then((r) => r.json());
            if (res?.ok) {
              toast("Offer listed. It fills the moment someone takes it", "good");
              void boardQ.refetch();
            } else {
              toast(`Offer rejected: ${res?.error ?? "unknown"}`, "bad");
            }
          } catch (err) {
            const msg = String((err as Error).message ?? "");
            if (/reject|denied|4001/i.test(msg)) toast("Cancelled", "info");
            else toast(`Offer failed: ${msg.slice(0, 70)}`, "bad");
          }
        }, undefined);
      },

      fillSwapOffer: (orderHash: string) => {
        void track("Swapping letters", async (run) => {
          const row = (boardQ.data ?? []).find((r) => r.orderHash === orderHash);
          if (!row || !address) return;
          const letters = addressOf("letters");
          const approved = (await getPublicClient().readContract({
            address: letters, abi: erc1155ApprovalAbi, functionName: "isApprovedForAll",
            args: [address, SEAPORT],
          })) as boolean;
          const ok = await run("Swap", () => [
            ...operatorApprovalCalls({ collection: letters, operator: SEAPORT, approved }),
            ...fulfillOrderCalls(row.order, row.signature),
          ]);
          if (ok) void boardQ.refetch();
        }, undefined);
      },

      cancelSwapOffer: (orderHash: string) => {
        void track("Cancelling your offer", async (run) => {
          const row = (boardQ.data ?? []).find((r) => r.orderHash === orderHash);
          if (!row) return;
          if (await run("Cancel offer", () => cancelOrderCalls(row.order))) void boardQ.refetch();
        }, undefined);
      },

      wordBoard: (wordBoardQ.data ?? []).map(({ order: _o, signature: _s, ...l }) => l),

      /**
       * Sell a word (decisions.md #18). At most one send, then a free signature: the send cancels
       * this wallet's earlier orders for the word (a new price must never leave an old one
       * fillable) and approves this word alone to Seaport. Either part is skipped when not needed.
       */
      listWord: async (word: string, price: number) => {
        const w = state.words.find((x) => x.word === word);
        if (!address || !w || !w.mine) return false;
        if (w.staked) {
          toast(`Unstake ${word} first: a staked word can’t be sold`, "info");
          return false;
        }
        if (!Number.isFinite(price) || price < MIN_WORD_PRICE) {
          toast(`The lowest price is ${fmtWord(MIN_WORD_PRICE)} $WORD`, "bad");
          return false;
        }
        const listed = await track(`Listing ${word}`, async (run, phase) => {
          const tokenId = tokenIdOf(word);
          const client = getPublicClient();
          try {
            const [staleRes, approvedTo] = await Promise.all([
              fetch(`/api/swap/words?stale=${address.toLowerCase()}:${tokenId}`).then((r) => r.json()),
              client.readContract({ address: addressOf("words"), abi: wordsAbi, functionName: "getApproved", args: [tokenId] }),
            ]);
            const stale = ((staleRes?.ok ? staleRes.stale : []) as { order: SeaportOrder }[]).map((s) => s.order);
            const approved = String(approvedTo).toLowerCase() === SEAPORT.toLowerCase();
            const prep = prepareListingCalls(tokenId, stale, approved);
            if (prep.length > 0 && !(await run(stale.length > 0 ? "Replace your listing" : "Approve this word", () => prep))) return false;
            const counter = (await client.readContract({
              address: SEAPORT, abi: seaportAbi, functionName: "getCounter", args: [address],
            })) as bigint;
            const saltBytes = new Uint8Array(16);
            crypto.getRandomValues(saltBytes);
            const salt = BigInt("0x" + [...saltBytes].map((b) => b.toString(16).padStart(2, "0")).join(""));
            const order = buildWordSaleOrder({
              maker: address, tokenId, priceWei: BigInt(Math.floor(price)) * 10n ** 18n, counter,
              nowSeconds: Math.floor(Date.now() / 1000) - 60, salt,
            });
            const provider = (await connector?.getProvider()) as { request: (a: { method: string; params: unknown[] }) => Promise<unknown> } | undefined;
            if (!provider) {
              toast("This wallet can’t sign listings", "bad");
              return false;
            }
            phase("wallet");
            const signature = (await provider.request({
              method: "eth_signTypedData_v4",
              params: [address, walletTypedDataJson(order)],
            })) as `0x${string}`;
            phase("working");
            const res = await fetch("/api/swap/words", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ order, signature, word }),
            }).then((r) => r.json());
            if (res?.ok) {
              toast(`${word} is for sale. It sells the moment someone buys it`, "good");
              void wordBoardQ.refetch();
              return true;
            }
            const why: Record<string, string> = {
              cancel_first: "Your earlier listing is still being cancelled. Try again in a minute",
              not_approved: "The approval hasn’t landed yet. Try again in a minute",
              not_owner: `This wallet doesn’t hold ${word} right now`,
              price_too_low: `The lowest price is ${fmtWord(MIN_WORD_PRICE)} $WORD`,
              bad_signature: "Your wallet’s signature didn’t check out. Try again, and tell us if it keeps happening",
            };
            toast(why[res?.error] ?? `Listing failed: ${res?.error ?? "unknown"}`, "bad");
            return false;
          } catch (err) {
            const msg = String((err as Error).message ?? "");
            if (/reject|denied|4001/i.test(msg)) toast("Cancelled", "info");
            else toast(`Listing failed: ${msg.slice(0, 70)}`, "bad");
            return false;
          }
        }, false);
        return listed === true;
      },

      buyWord: (orderHash: string) => {
        const row = (wordBoardQ.data ?? []).find((r) => r.orderHash === orderHash);
        if (!row || !address || !chain.player) return;
        const price = orderPriceWei(row.order);
        if (chain.player.balanceWei < price) return void toast(`You need ${fmtWord(row.price)} $WORD to buy ${row.word}`, "bad");
        void track(`Buying ${row.word}`, async (run) => {
          const allowance = (await getPublicClient().readContract({
            address: wordTokenAddress(), abi: erc20Abi, functionName: "allowance", args: [address, SEAPORT],
          })) as bigint;
          return sendAndSettle(
            run,
            `Buy ${row.word}`,
            () => buyWordCalls(row.order, row.signature, allowance),
            (ws) => ws.some((x) => x.word === row.word && x.mine),
            {
              done: () => `${row.word} is yours.`,
              pending: `Sent. ${row.word} will show in your bag once the chain confirms it.`,
            },
          ).then((ok) => {
            void wordBoardQ.refetch();
            return ok;
          });
        }, false);
      },

      cancelWordListing: (orderHash: string) => {
        void track("Taking your word off sale", async (run) => {
          const row = (wordBoardQ.data ?? []).find((r) => r.orderHash === orderHash);
          if (!row) return;
          if (await run("Cancel listing", () => cancelOrderCalls(row.order))) void wordBoardQ.refetch();
        }, undefined);
      },

      // Stranded-commit recovery. The first live daily mined its commit and then lost its reveal
      // (page state died between the two wallet prompts) — the letter sat unopened with no way to
      // claim it. The reveal is deterministic and free, so finishing is always safe.
      busy,
      dismissBusy: gate.dismiss,
      pendingReveals: (pendingQ.data ?? []).length,
      openPending: () => {
        const oldest = (pendingQ.data ?? [])[0];
        if (!oldest) return;
        void track("Opening your letters", async (run) => {
          if (await revealCommit(oldest.commitId, run)) void pendingQ.refetch();
        }, undefined);
      },
    }),
    [state, chain, address, connector, qc, pityNotes, track, gate, busy, toast, postJson, openPostJson, authError, dailyError, packError, finishLetterCommit, finishRoll, resumeOpenRoll, soldOutFor, revealCommit, guarded, pendingQ, claimablesQ, earningsQ, boardQ, wordBoardQ, sendAndSettle, snackVoucher],
  );

  return <GameCtx.Provider value={api}>{children}</GameCtx.Provider>;
}

