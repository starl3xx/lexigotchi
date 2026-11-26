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
import { encodeFunctionData } from "viem";
import {
  type FreeLetterView,
  type GameApi,
  type GameState,
  type OwnedWord,
  type Sheet,
  type Toast,
  type View,
  type ViewSection,
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
import { stageFeeMultiple } from "@/lib/ascension";
import { resultToast, strandedToast } from "./ascendFlow";
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
  readPrestigeAttempt,
  type PrestigeAttempt,
} from "@/lib/onchain/reads";
import { dailyKeysFor } from "@/lib/onchain/verifications";
import { useProfileSession, usePublicProfile } from "./useProfile";
import { unionEverHeld, unionWords, sumLetterCounts, type BagWord } from "@/lib/onchain/unionBag";
import { SEAPORT, seaportAbi, walletTypedDataJson, cancelOrderCalls, type SeaportOrder } from "@/lib/onchain/seaport";
import { erc1155ApprovalAbi, erc20Abi, lettersAbi, mockUsdcAbi, shopAbi, wordsAbi } from "@/lib/onchain/abis";
import { buildWordSaleOrder, buyWordCalls, prepareListingCalls, MIN_WORD_PRICE, orderPriceWei } from "@/lib/onchain/wordSale";
import { buildLetterSaleOrder, buyLettersCalls, lettersPriceWei, prepareLetterListingCalls, MIN_LETTER_PRICE } from "@/lib/onchain/letterSale";
import { letterLabel } from "@/lib/market/deals";
import { fetchLetterOrder, fetchWordOrder, useChainMarket } from "./market/useChainMarket";
import { getPublicClient, toWordWei } from "@/lib/onchain/reads";
import { addressOf, shopAddress, usdcAddress, wordTokenAddress } from "@/lib/onchain/addresses";
import { approveCall, buyCall, buyRoute, buyWithPermitCall, isUnsupported, permitTypedDataJson, type BuyRoute } from "@/lib/shop/buy";
import { TEST_USDC_FAUCET, fmtUsdc } from "@/lib/shop/rules";
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
import { overlayStage, pruneStageNotes, pruneUnfinished, type Stage, type StageNote } from "@/lib/onchain/stageOverlay";
import { answerLost, ascendResult, revealPlan, type RevealAnswer } from "@/lib/onchain/ascendResult";
import { authedPostJson, maybeAuthedPostJson } from "./campaignClient";
import type { DailyStatus } from "@/app/api/mint/daily-status/route";
import type { PublicFace } from "@/lib/profile/rules";
import { usePlayerWallets } from "./usePlayerWallets";
import { wordsToFeed } from "./feedAll";

const EMPTY_26 = Array.from({ length: 26 }, () => 0);

/**
 * When to ask the chain whether an ascension's reveal has landed, from the moment the wallet took
 * it. Tighter than SETTLE_OFFSETS_MS: the word's letters are standing there with their eyes shut,
 * the read is one small multicall, and Base makes a block every 2 s.
 */
const ASCEND_SETTLE_MS: readonly number[] = [0, 1_000, 2_000, 3_500, 5_000, 7_500, 10_000, 15_000, 20_000, 30_000];

/** Signing-route response shapes. */
// The two vouchers differ: the free pack is nonce-scoped, the daily is UTC-day-scoped.
interface PackVoucher { fid: string; nonce: string; deadline: string; signature: `0x${string}` }
interface DailyVoucher { fid: string; today: number; deadline: string; signature: `0x${string}` }
/** Pre-signed reveal for the predicted commitId — lets commit+reveal ride one send. */
interface DailyBundle { predictedCommitId: string; letterIndexes: number[]; revealSignature: `0x${string}` }
interface LetterReveal { letterIndexes: number[]; signature: `0x${string}` }
interface OutcomeReveal { success: boolean; signature: `0x${string}`; probability: number }
/**
 * /api/prestige/reveal's answer. `level` and `owner` are the COMMIT's (the stage the attempt was
 * paid at, and who it is for). `relayed`: the server sent the reveal itself, or found it done:
 * - "mined": on chain. `success`, `stage` (the word's level now, or null if it couldn't be read at
 *   the reveal's block) and `pity` are what the chain did.
 * - "already": revealed before the game asked. "pending" / "reverted": broadcast, not seen to land.
 *   None of the three claims an outcome: the game reads it from the chain.
 * Absent: nothing was broadcast, and `success` + `signature` are for the player's wallet to send.
 */
interface PrestigeReveal extends RevealAnswer {
  level?: number;
  owner?: string;
}
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

/** A word's unfinished ascension attempt: the stage it was made at, and its commit when known. */
type UnfinishedMark = Stage & { commitId?: string };

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
  // The open sheet as it is NOW, for an action that finishes long after its tap: an ascension says
  // its result in a toast only when its own sheet is no longer there to show it.
  const sheetNow = useRef(ui.sheet);
  sheetNow.current = ui.sheet;
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

  // The stage and pity an ascension attempt just left on a word, read from the chain with the
  // reveal (readPrestigeAttempt) and shown until the slower words read agrees. See
  // lib/onchain/stageOverlay: without it a word that just hit kept its old gold, and "try again"
  // priced and sized its approval from the stage before. Filed by word: a stage belongs to the
  // word, whichever of the player's wallets is connected.
  const [stageNotes, setStageNotes] = useState<Readonly<Record<string, StageNote>>>({});
  /**
   * Words with an attempt this browser knows is PAID and not known to be finished (a try that
   * ended stranded), each with the stage it stood at when that try was made. The word sheet and
   * the ascend sheet say so, so a spent, open attempt never sits with no cue (Bugbot on #229: the
   * old inline button kept an "Unfinished" mark; a sheet that has been closed keeps nothing). A
   * mark goes when a reveal is read back for the word, or when the words read shows the word past
   * the stage it was marked at (the reveal landed on its own: pruneUnfinished). For this session
   * only: after a reload the next try still finishes an open attempt first.
   *
   * A mark also keeps the attempt's commit id when it is known. The server finishes attempts now,
   * and holds the request while it does, so "finished, and the answer never arrived" is the usual
   * way a try ends unfinished: with the commit id, "Finish your attempt" can read that attempt's
   * own result from the chain and say it, where it could only have said "nothing is open".
   */
  const [unfinishedMarks, setUnfinishedMarks] = useState<Readonly<Record<string, UnfinishedMark>>>({});
  /** Words with an ascension action in flight: that action will say how its attempt ends, so nothing else does. */
  const ascending = useRef(new Set<string>());
  const unfinishedAscents = useMemo(() => new Set(Object.keys(unfinishedMarks)), [unfinishedMarks]);
  /** Mark `word` as having an unfinished attempt made at `at`, or clear its mark (null). */
  const markAscent = useCallback((word: string, at: UnfinishedMark | null) => {
    setUnfinishedMarks((all) => {
      if (at) return { ...all, [word]: at };
      if (!(word in all)) return all;
      const { [word]: _gone, ...rest } = all;
      return rest;
    });
  }, []);
  useEffect(() => {
    const read = wordsQ.data?.words;
    if (!read) return;
    const chainStages = Object.fromEntries(read.map((w) => [w.word, { level: w.prestigeLevel, pity: w.prestigePity }]));
    setStageNotes((notes) => pruneStageNotes(chainStages, notes, Date.now()));
    // An unfinished attempt whose reveal has since landed on its own (the server finished it and
    // its answer was lost, or a slow transaction arrived): the words read shows the word past the
    // stage it was marked at. Its result was never said, so say it now, and drop the mark. A word
    // with an action in flight is left alone: that action says its own ending.
    const idle = Object.fromEntries(Object.entries(unfinishedMarks).filter(([word]) => !ascending.current.has(word)));
    const kept = pruneUnfinished(chainStages, idle);
    if (kept === idle) return;
    for (const [word, mark] of Object.entries(idle)) {
      const now = chainStages[word];
      if (word in kept || !now) continue; // still unfinished, or the word left the bag
      const rose = prestigeSuccessProbability(now.pity, now.level) > prestigeSuccessProbability(mark.pity, mark.level);
      const said = resultToast(word, now.level > mark.level, now.level, rose);
      dispatch({ t: "toast", text: said.text, tone: said.tone });
    }
    setUnfinishedMarks((marks) => {
      const next = { ...marks };
      for (const word of Object.keys(idle)) if (!(word in kept)) delete next[word];
      return next;
    });
  }, [wordsQ.data, unfinishedMarks]);

  // The identity today's daily would be issued under, and every other key the player could claim
  // under — mirrors the server (free-daily route): the Farcaster fid, then an X account old enough
  // to count, then the wallet's synthetic 2^160 key, and "claimed" if ANY was used today. Getting
  // this wrong shows "Pull" to a player the contract or the server will refuse, and the refusal
  // reads as a bug (it did, on the first live test).
  const pubProfile = usePublicProfile();
  // The FID is left out of this browser's own read: it counts only for a profile it belongs to, which
  // the server decides (lib/onchain/freeIdentity.ts). daily-status walks the FIDs that verified this
  // profile's wallets and the keys recorded on it, so an owned FID's pull still shows; a Farcaster
  // account that doesn't own this wallet no longer reads as "pulled today" (Bugbot on #199).
  const { primary: dailyKey, all: walletDailyKeys } = dailyKeysFor({
    fid: null,
    xUserId: pubProfile.profile?.x?.id ?? null,
    xCounts: pubProfile.xCounts,
    wallet: address ?? null,
  });
  // …plus the key the server last signed this wallet's daily under (a FID it decided belongs to this
  // profile, say), so a pull under it shows at once and a failed send can tell whether it landed
  // (Bugbot on #199). An unowned FID never gets here: the server never signs under it. Kept with the
  // wallet it was signed for: the provider stays mounted across account switches, and another
  // wallet must not read as claimed under this one's key.
  const [lastVoucher, setLastVoucher] = useState<{ wallet: string; key: bigint } | null>(null);
  const voucherKey = lastVoucher && address && lastVoucher.wallet === address.toLowerCase() ? lastVoucher.key : null;
  const dailyKeys = useMemo(
    () => (voucherKey !== null && !walletDailyKeys.includes(voucherKey) ? [...walletDailyKeys, voucherKey] : walletDailyKeys),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [voucherKey, walletDailyKeys.map(String).join(",")],
  );

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
    queryKey: ["dailyStatus", NETWORK.id, address?.toLowerCase()],
    queryFn: async () => {
      const r = await fetch(`/api/mint/daily-status?wallet=${address}`);
      const d = (await r.json()) as Partial<DailyStatus> & { ok: boolean };
      if (!d.ok) return null;
      const view: FreeLetterView = {
        dailyLeft: d.dailyTaken == null ? null : Math.max(0, (d.dailyLimit ?? 10) - d.dailyTaken),
        dailyLimit: d.dailyLimit ?? 10,
        done: Boolean(d.done),
        packTaken: Boolean(d.packTaken),
        stop: d.stop ?? null,
        packStop: d.packStop ?? null,
        dictionaryFull: Boolean(d.dictionaryFull),
      };
      return { claimed: Boolean(d.claimed), view };
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
    queryFn: async (): Promise<{ earnings: EarningsJson; share: string | null } | null> => {
      const res = await fetch(`/api/rewards/earnings?wallets=${bagWallets.join(",")}`);
      const data = await res.json().catch(() => null);
      // A failed read is "unknown" (null), never "earned nothing". `share` is the server's signed
      // snapshot of these same numbers, for the share card (lib/earningsShare.ts).
      return data?.ok ? { earnings: data.earnings as EarningsJson, share: typeof data.share === "string" ? data.share : null } : null;
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

  // Words for sale (decisions.md #18). The route reads each word's state live and drops what can't
  // fill, so every row here could be bought as of the last read. It carries no orders: the signed
  // order is fetched when the player buys or takes one off sale (fetchWordOrder).
  const freshWords = useRef(false);
  const wordBoardQ = useQuery({
    queryKey: ["wordBoard", NETWORK.id],
    queryFn: async () => {
      const fresh = freshWords.current;
      freshWords.current = false;
      const res = await fetch(fresh ? "/api/swap/words?fresh=1" : "/api/swap/words");
      const data = await res.json();
      // A refused or failed read throws, so the last good board stays up: an empty list here would
      // say "no words are for sale" when the truth is "couldn't read" (a rate limit, an RPC hiccup).
      if (!data?.ok) throw new Error(`words board: ${data?.error ?? res.status}`);
      const faces = (data.profiles ?? {}) as Record<string, PublicFace>;
      return (data.listings as Omit<WordListing, "price" | "face">[]).map((l) => ({
        ...l,
        price: Number(BigInt(l.priceWei) / 10n ** 18n),
        face: faces[l.maker],
      }));
    },
    enabled: chain.deployed,
    staleTime: 15_000,
    retry: 1,
    // Other players' listings arrive while the Market is on screen, without a reload; elsewhere it
    // doesn't poll (the route checks every listing against the chain).
    refetchInterval: ui.view === "swap" ? 15_000 : false,
  });
  const refetchWords = wordBoardQ.refetch;
  /**
   * After this player lists, buys, or cancels a word: read the board from the chain, not from the
   * server's few-second-old copy, at once and again at 4 and 10 seconds (an RPC may show a write a
   * moment late).
   */
  const refreshWords = useCallback(() => {
    const read = () => {
      freshWords.current = true;
      void refetchWords();
    };
    read();
    for (const ms of [4_000, 10_000]) setTimeout(read, ms);
  }, [refetchWords]);

  // Letters for sale, recent sales, and the player's own listings (decisions.md #30).
  const market = useChainMarket({ enabled: chain.deployed, onMarket: ui.view === "swap", wallets: bagWallets });

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

  const chainSaysClaimed = (dayQ.data?.dailyUsed ?? false) || (relatedDayQ.data?.claimed ?? false);
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
      words: (wordsQ.data?.words ?? []).map((w) => {
        const owned = toOwnedWord(w, careFor);
        const note = stageNotes[w.word];
        if (!note) return owned;
        const shown = overlayStage({ level: owned.prestigeLevel, pity: owned.prestigePity }, note, Date.now());
        return { ...owned, prestigeLevel: shown.level, prestigePity: shown.pity };
      }),
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
      // The chain's day when it's been read, else the clock's (chainDayNow): the daily read runs only for
      // a wallet with a daily key, and without this a visitor or an unverified wallet saw theme 0
      // ("contains a rare letter") whatever the week was.
      bountyTheme: themeForPeriod(Math.floor(chainDayNow / 7)),
      mintCount: 0,
      freeSnackUsed: false,
      jackpotWord: "",
      jackpotRevealed: false,
    }),
    // careFor: the caretaker read lands after the words; `care` must follow it (Bugbot on #173).
    [ui, status, chain.error, chain.player, pityQ.data, myPityNotes, stageNotes, wordsQ.data, wordsQ.isLoading, wordsQ.isError, wordsQ.isFetching, dayQ.data, chainDayNow, relatedDayQ.data, bucketsQ.data, dailyClaimed, seenToday, careFor],
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
      // `done` answers null when the caller says it another way (a bought word gets a sheet).
      says: { done: (words: BagWord[]) => string | null; pending: string },
    ) => {
      if (!(await run(label, build, { settles: true }))) return false;
      let last: BagWord[] = [];
      const seen = await readUntil(
        async () => (last = (await wordsQ.refetch({ cancelRefetch: false })).data?.words ?? []),
        landed,
      );
      const said = seen ? says.done(last) : says.pending;
      if (said !== null) toast(said, seen ? "good" : "info");
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
   * For the routes that also serve the verified-wallet identity (the free daily and pack vouchers,
   * the letter reveal): token attached when present, plain fetch when not. The wallet's profile
   * session rides along too when the player has one: it proves this wallet is theirs, so a Farcaster
   * sign-in that hasn't verified the wallet still counts (lib/onchain/freeIdentity.ts). Everything
   * else stays on `postJson` — its `not_signed_in` pre-flight is load-bearing for the paid flows.
   */
  const { token: profileToken } = useProfileSession();
  const openPostJson = useCallback(
    <T,>(url: string, body: unknown) =>
      maybeAuthedPostJson<T>(url, body, profileToken ? { "x-lexigotchi-session": profileToken } : {}),
    [profileToken],
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
        case "verification_required":
          return "The free pack needs a linked account or a Coinbase-verified wallet. Open your profile";
        case "farcaster_wallet_unverified":
          return "Your Farcaster account hasn’t verified this wallet. Verify it in Farcaster, or sign in with this wallet in your profile";
        case "x_too_young":
          return "Your X account unlocks the free pack once it’s 90 days old";
        case "verification_unavailable":
          return "Can’t check your verification right now. Try again in a minute";
        case "already_claimed":
          return "You’ve already opened your free pack";
        case "campaign_closed":
          return "Free packs have ended";
        case "free_letters_gone":
          return "All the free letters have been given out. Packs are still for sale";
        case "free_letters_closed":
          return "The dictionary is nearly full, so free letters have ended. Packs are still for sale";
        case "try_again":
          return "Can’t open your free pack right now. Try again in a minute";
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
        case "farcaster_wallet_unverified":
          return "Your Farcaster account hasn’t verified this wallet. Verify it in Farcaster, or sign in with this wallet in your profile";
        case "verification_unavailable":
          return "Can’t check your verification right now. Try again in a minute";
        case "daily_limit_reached":
          return "You’ve had all 10 free daily letters. Packs are still for sale";
        case "free_letters_gone":
          return "All the free letters have been given out. Packs are still for sale";
        case "free_letters_closed":
          return "The dictionary is nearly full, so free letters have ended. Packs are still for sale";
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
   * Ascension attempts this browser has READ as revealed (`settleAscension`). "Try again" commits
   * seconds after a reveal, and a node a block behind can still read the finished attempt as open:
   * taken for "your unfinished attempt", it would ask for a reveal that already happened. These ids
   * are never open again, so every search for an open attempt skips them.
   */
  const revealedAttempts = useRef(new Set<string>());

  /**
   * A reveal of `commitId` is KNOWN to have landed, and left the word at `stage`. The bookkeeping
   * every such moment owes, in one place, so no path can skip a part of it (the server's relayed
   * reveal and the game's own chain read both end here):
   * - the attempt is never open again, so later searches for an open one skip it;
   * - the stage shows at once, over the slower words read (stageNotes);
   * - the word has nothing unfinished any more;
   * - the words are read again on a stagger, to replace the note with the read itself.
   */
  const noteAscension = useCallback(
    (word: string, commitId: bigint, stage: Stage) => {
      revealedAttempts.current.add(String(commitId));
      setStageNotes((notes) => ({ ...notes, [word]: { level: stage.level, pity: stage.pity, at: Date.now() } }));
      markAscent(word, null);
      for (const delay of [0, 2_000, 6_000, 15_000]) setTimeout(() => void wordsQ.refetch({ cancelRefetch: false }), delay);
    },
    [wordsQ, markAscent],
  );

  /**
   * Wait for an ascension's reveal to be ON CHAIN, then show where it left the word: its stage and
   * pity, read in one block with the commit's `revealed` flag (readPrestigeAttempt), laid over the
   * slower words read (`stageNotes`). Null when the reveal never showed in the wait: that is
   * "unknown", so the caller must not offer another try.
   *
   * It waits because the reveal is sent by the player's wallet, and a send returns when the wallet
   * accepts. Reporting the signed outcome at that moment let "try again" find the finished attempt
   * still open, show a miss's old odds, and price the next stage from the stage before.
   */
  const settleAscension = useCallback(
    async (word: string, commitId: bigint): Promise<PrestigeAttempt | null> => {
      const got: { attempt: PrestigeAttempt | null } = { attempt: null };
      const seen = await readUntil(
        // Capped: the action gate waits on this, and a read that never answers must not hold it.
        async () => (got.attempt = await orThrowAfter(readPrestigeAttempt(commitId, tokenIdOf(word)), 5_000)),
        (attempt) => attempt.revealed,
        ASCEND_SETTLE_MS,
      );
      if (!seen || !got.attempt) {
        // The words read may still show something of it later; nothing is noted for a reveal not seen.
        for (const delay of [0, 2_000, 6_000, 15_000]) setTimeout(() => void wordsQ.refetch({ cancelRefetch: false }), delay);
        return null;
      }
      noteAscension(word, commitId, got.attempt);
      return got.attempt;
    },
    [wordsQ, noteAscension],
  );

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


  /**
   * A testnet faucet send, settled on the mint's OWN result (lib/onchain/traceSend), then said plainly.
   *
   * It waits for the MINT, not the send. A send returns when the wallet accepts: on 2026-11-24 a
   * tester saw "Faucet sent" over a balance that never moved, and no transaction from their wallet
   * ever reached Base Sepolia (it held Base Sepolia ETH). So "arrived" needs the mint's own result
   * (`settleSend`: its receipt, or the wallet's batch status), and anything else is named to the
   * player. Watching the balance instead both missed real mints and passed off earlier ones as new,
   * so the balance is only the fallback for a send nobody can trace. It never refuses to send for
   * want of ETH: sponsored smart wallets mint holding none. Shared by test $WORD and test USDC.
   */
  /**
   * What became of a send, from its OWN result: the receipt on this chain, or the wallet's batch
   * status (whose "failed" beats a bundler receipt that succeeded). `changed` is only the fallback
   * for a send nobody can trace. Capped at 45 s; every read is capped too (the action gate waits).
   */
  const traceSent = useCallback(
    async (sent: SendResult | undefined, changed?: () => Promise<boolean>): Promise<SendTrace> => {
      const READ_MS = 5_000;
      const client = getPublicClient();
      // A read that FAILS must not pass for "not found": only viem's not-found errors mean that.
      const notFound = (e: unknown, name: string) => {
        if ((e as { name?: string })?.name === name) return null;
        throw e;
      };
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
          { onTrace: (t) => (last.trace = t), changed },
        ),
        45_000,
        null,
      );
      return settled ?? last.trace;
    },
    [connector],
  );

  const runFaucet = useCallback(
    async (
      run: RunFn,
      f: { what: string; calls: () => Call[]; token: `0x${string}`; amount: bigint; arrived: string },
    ): Promise<boolean> => {
      if (!address) return false;
      /** Every read is capped: the action gate waits on all of it, and viem retries each read. */
      const READ_MS = 5_000;
      const client = getPublicClient();
      const balanceOf = () =>
        orThrowAfter(
          client.readContract({ address: f.token, abi: erc20Abi, functionName: "balanceOf", args: [address] }) as Promise<bigint>,
          READ_MS,
        );
      // Only the fallback below uses this, so the send never waits on it. A FRESH read, never a
      // cached balance: a cache from before a spend set a target the mint could never reach.
      const before = await balanceOf().catch(() => undefined);
      let sent: SendResult | undefined;
      const ok = await run("Faucet", f.calls, { settles: true, onSent: (r) => (sent = r) });
      if (!ok) return false;

      const trace = await traceSent(sent, before === undefined ? undefined : async () => (await balanceOf()) >= before + f.amount);
      void chain.refresh();
      if (trace.kind === "landed" || trace.kind === "seen") {
        toast(f.arrived, "good");
        return true;
      }

      // For a desktop tester's console, and for us when they share it.
      console.warn(`[faucet] no ${f.what} arrived`, { address, sent, trace });
      // These come up to ~45 s after the tap, often while the player is in their wallet app, and
      // they are the only explanation the player gets: they stay up for 15 s (a hidden tab also
      // holds them, see ToastItem).
      const say = (text: string, tone: Toast["tone"]) => toast(text, tone, 15_000);
      const at = "hash" in trace ? ` (${shortHash(trace.hash)})` : "";
      const here = NETWORK.name;
      switch (trace.kind) {
        case "reverted":
          say(`The faucet transaction failed on ${here}${at}. Try again.`, "bad");
          break;
        case "pending":
          say(`Your faucet transaction is still waiting on ${here}${at}.`, "info");
          break;
        case "unseen":
          // Base's mempool is private, so a transaction still queued in the wallet looks like this.
          say(
            `Your wallet says it sent the faucet transaction${at}, but ${here} hasn’t seen it. Your wallet may be holding it behind an earlier transaction, or sent it on another network.`,
            "bad",
          );
          break;
        case "other_chain": {
          const there = networkById(trace.chainId)?.name ?? `another network (chain ${trace.chainId})`;
          say(`Your wallet ran the faucet on ${there}, not ${here}. Nothing was minted.`, "bad");
          break;
        }
        case "wallet_failed":
          say("Your wallet says the faucet transaction failed. Try again.", "bad");
          break;
        case "wallet_pending":
          say("Your wallet says the faucet transaction is still pending.", "info");
          break;
        case "unknown": {
          // Sponsored smart wallets hold no ETH and need none, so this only says "if". The sheet
          // may be closed by now, so it says where the link is rather than "below".
          const eth = await withTimeout(client.getBalance({ address }).catch(() => null), READ_MS, null);
          say(
            eth === 0n
              ? `No ${f.what} yet. If your wallet pays its own gas, it needs ${here} ETH: Your $WORD has a link to get some free.`
              : `Your wallet accepted it, but no ${f.what} has arrived yet. Check your wallet’s activity.`,
            "info",
          );
          break;
        }
      }
      return false;
    },
    [address, chain, toast, traceSent],
  );

  const api: GameApi = useMemo(
    () => ({
      state,
      nav: (view: View, section?: ViewSection) => dispatch({ t: "nav", view, section }),
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
      freeLetters: relatedDayQ.data?.view ?? null,
      // Until params load, assume OFF: better a hidden button for a moment than one that reverts.
      maxPrestigeLevel: chain.params?.maxPrestigeLevel ?? 0,
      unfinishedAscents,
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
          setLastVoucher({ wallet: address.toLowerCase(), key: BigInt(v.fid) });
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
            // Read the exact key this voucher was signed under: whichever identity the server chose.
            const landed = await readDayState([BigInt(v.fid)]).then((d) => d.dailyUsed).catch(() => false);
            void dayQ.refetch();
            void pendingQ.refetch();
            if (landed) {
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

          // Any verified identity (Farcaster, X, or Coinbase): the token rides along when there is one.
          const res = await openPostJson<{ voucher: PackVoucher }>("/api/mint/free-pack", { wallet: address });
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
          void relatedDayQ.refetch(); // the pack is taken: the Mint card stops offering it
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

      prestige: (word: string, opts?: { finishOnly?: boolean }) =>
        // "Attempting", never "Ascending" (starl3xx, 2026-11-25): a try may miss, and the status
        // must not read as if the word were on its way up.
        track(`Attempting ascension: ${word}`, async (run) => {
          // The sheet this try was made in: only that one is waiting to show how it ends. "That
          // sheet" is the same sheet object, not any ascend sheet on this word: one closed and
          // opened again mid-try is a new sheet with no try of its own to hear from.
          const sheetAtTap = sheetNow.current;
          const sheetShows = () => {
            const open = sheetNow.current;
            return open === sheetAtTap && open?.kind === "ascend" && open.word === word;
          };
          // The stage this attempt aims past (the word ladder: price and odds both depend on it).
          const target = state.words.find((x) => x.word === word);
          const tap: Stage = { level: target?.prestigeLevel ?? 0, pity: target?.prestigePity ?? 0 };
          // An earlier try on this word that ended paid and unfinished, if this browser knows of one.
          const mark = unfinishedMarks[word];
          // What a stranded end must remember: the stage the attempt was made at, and its commit.
          const left: { at: Stage; commitId?: string } = { at: tap };

          // How the attempt ended, said to the sheet (and in a toast when that sheet has gone).
          // `from` is the stage the attempt was made at: the result is measured from there.
          const tell = (came: ReturnType<typeof ascendResult>, from: Stage): ActionOutcome => {
            if (came.kind === "unfinished") return { status: "stranded", note: "Your attempt is finishing onchain. It’ll show in a moment." };
            if (came.kind === "foreign") {
              // Nothing was spent by this tap and nothing is left open: ready again, never "missed".
              toast(`Finished an earlier attempt on ${word}. Try again for yours`, "info");
              return { status: "not-started" };
            }
            // The ascend sheet the try was made in shows the result. Say it here when that sheet is
            // gone, so the outcome is said once, and always said.
            if (!sheetShows()) {
              const rose = prestigeSuccessProbability(came.pity, came.level) > prestigeSuccessProbability(from.pity, from.level);
              const said = resultToast(word, came.hit, came.level, rose);
              toast(said.text, said.tone);
            }
            return { status: "resolved", success: came.hit, stage: { level: came.level, pity: came.pity } };
          };

          // While this runs, it alone says how the attempt ends (the words effect stays quiet).
          ascending.current.add(word);
          const outcome = await guarded(async (markPaid) => {
            if (!chain.params || !chain.player || !address) return { status: "not-started" as const };
            const tokenId = tokenIdOf(word);
            // A caretaker's ascension is committed in the staker's name (Prestige names the staker).
            const owner = (target?.care && target.holder ? target.holder : address) as `0x${string}`;
            // One unrevealed ascension per Word (Prestige.attemptOpen): finish an open one, never pay
            // twice. Attempts this browser has read as revealed are skipped (a lagging node can still
            // call one open seconds later).
            let id = await readOpenPrestigeFor(tokenId, revealedAttempts.current);
            // Asked to finish the attempt this browser marked, and the search finds nothing open.
            // The usual reason: the server finished it and its answer never arrived. The mark knows
            // the commit, so go by that: the server says what became of it ("already"), and its
            // result, which was never said, is read and said. (If the search was only behind, the
            // attempt is open after all, and the server finishes it.)
            if (id === null && opts?.finishOnly && mark?.commitId) id = BigInt(mark.commitId);
            const resumed = id !== null;
            // Asked only to finish a paid attempt, and there is none to go by. Never pay for a new
            // one from the "finish" button, which showed no price.
            if (id === null && opts?.finishOnly) {
              // Nothing is open and nothing is known of it: it finished some other way, or never
              // reached the chain. Clear the mark; the sheet goes back to its priced try. The toast
              // says what was read and no more. If an attempt does turn up later, the next try
              // finishes it first (Prestige allows one open attempt a word).
              markAscent(word, null);
              for (const delay of [0, 2_000, 6_000]) setTimeout(() => void wordsQ.refetch({ cancelRefetch: false }), delay);
              toast(`No attempt is open on ${word} now`, "info");
              return { status: "not-started" as const };
            }
            if (id !== null) {
              // The "finish" button asked for exactly this, so there is nothing to explain.
              if (!opts?.finishOnly) toast("Finishing your unfinished attempt first", "info");
              markPaid(); // paid at its commit
            } else {
              const before = await readOpenPrestigeCommits(owner);
              // `settles`: no generic "sent" toast. A green "sent" over a try that may miss reads as
              // a result, and the sheet (or the toast below) says what is happening.
              if (!(await run("Ascension attempt", () => commitPrestigeCalls(tokenId, tap.level, chain.params!, chain.player!), { settles: true }))) return { status: "not-started" as const };
              markPaid(); // fee + burned snack are gone from here on
              toast("Attempting ascension…", "info");
              id = await waitForNewPrestigeCommit(owner, [...before, ...[...revealedAttempts.current].map(BigInt)]);
              if (id === null) {
                return { status: "stranded", note: "Your attempt is paid for but slow to appear. Reopen to finish it" };
              }
            }
            const commitId = id;
            left.commitId = String(commitId);
            // The open attempt is the one this browser marked: its result is owed whatever the
            // server finds, and it is measured from the stage it was made at.
            const own = resumed && mark !== undefined && (mark.commitId === undefined || mark.commitId === String(commitId));
            const from: Stage = own ? mark : tap;
            if (own) left.at = mark;

            // The server finishes it (decisions.md #14): it sends the reveal from its relayer key
            // and answers with what the chain did, so the only wallet prompt is the paid attempt.
            const draw = await openPostJson<{ reveal: PrestigeReveal }>("/api/prestige/reveal", { commitId: String(commitId), relay: true });
            let after: Stage | null;
            let already = false;
            if (draw.ok) {
              // lib/onchain/ascendResult, revealPlan: what each answer means, and why only an
              // answer with nothing broadcast ever reaches the wallet.
              const plan = revealPlan(draw.reveal);
              if (plan.do === "use") {
                // On chain, and the server read where it left the word from the reveal itself.
                after = plan.stage;
                noteAscension(word, commitId, after);
              } else if (plan.do === "read") {
                // The reveal is broadcast, or was done before we asked. Read the chain.
                already = plan.already;
                after = await settleAscension(word, commitId);
              } else if (plan.do === "wallet") {
                // Nothing was broadcast (no relayer key, or its send was refused): the wallet sends
                // the reveal, as before the server could.
                if (!(await run("Reveal", () => prestigeRevealCalls(commitId, plan.success, plan.signature), { settles: true }))) {
                  return { status: "stranded", note: "Your attempt is paid for. Reopen to finish it" };
                }
                // What the CHAIN did with it, read once it has landed. Never the signed outcome at
                // the moment the wallet took the send: see settleAscension.
                after = await settleAscension(word, commitId);
              } else {
                return { status: "stranded", note: "Your attempt is paid for. Reopen to finish it" };
              }
            } else if (draw.error === "already_revealed") {
              // A server from before the relay answers a finished attempt this way.
              already = true;
              after = await settleAscension(word, commitId);
            } else if (answerLost(draw.error)) {
              // No answer came back, which says nothing about whether the server acted: it holds
              // the request while it sends the reveal and waits for its block. Ask the chain
              // before calling the attempt unfinished (lib/onchain/ascendResult, answerLost).
              after = await settleAscension(word, commitId);
              // Not on chain after the wait: the request most likely never arrived, and the attempt
              // is open. "Finishing onchain" would promise a result nobody has sent for.
              if (!after) return { status: "stranded", note: "Your attempt is paid for. Reopen to finish it" };
            } else {
              // The server said no before sending anything (rate limit, an unknown commit).
              toast(authError(draw.error, "Ascension"), "bad");
              return { status: "stranded", note: "Your attempt is paid for. Reopen to finish it" };
            }
            // lib/onchain/ascendResult says what each of these is, and why none of them is a guess.
            return tell(ascendResult({ level: from.level, owner, resumed, own, already, commit: draw.ok ? draw.reveal : null, after }), from);
          });
          ascending.current.delete(word);
          // Paid, and not known to be finished. The sheet says so if it is still there; if not,
          // say it here, or the last word on a spent fee is silence. Either way the word carries
          // the mark, with the attempt's commit when it is known, until a reveal is read back.
          if (outcome.status === "stranded") {
            markAscent(word, { ...left.at, commitId: left.commitId });
            if (!sheetShows()) toast(strandedToast(word, outcome.note), "info");
          }
          return outcome;
        }, NOT_STARTED),

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
        const hungryWords = wordsToFeed(state.words);
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

      // The faucet replaces addDemoBalance — real tokens on a testnet, nothing on mainnet. The flow
      // (wait for the mint itself, then say plainly what happened) is `runFaucet`, shared with test USDC.
      addDemoBalance: () => {
        if (!NETWORK.isTestnet) return void toast("No faucet on mainnet", "bad");
        if (!address) return void toast("Connect a wallet first", "bad");
        const FAUCET = 50_000_000;
        void track("Getting test $WORD", (run) =>
          runFaucet(run, {
            what: "test $WORD",
            calls: () => faucetCalls(address, FAUCET),
            token: wordTokenAddress(),
            amount: toWordWei(FAUCET),
            arrived: `Test $WORD arrived: ${fmtWord(FAUCET)}`,
          }),
        false);
      },

      getTestUsdc: async () => {
        const usdc = usdcAddress();
        if (!NETWORK.isTestnet || !usdc) {
          toast("No test USDC on this network", "bad");
          return false;
        }
        if (!address) {
          toast("Connect a wallet first", "bad");
          return false;
        }
        return track(
          "Getting test USDC",
          async (run) => {
            // The server vouches for one tap per profile per UTC day (it alone knows the profile).
            const r = await fetch("/api/faucet/usdc", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ wallet: address }),
            }).catch(() => null);
            const d = (await r?.json().catch(() => null)) as
              | { ok: boolean; error?: string; voucher?: { profile: `0x${string}`; deadline: string; sig: `0x${string}` } }
              | null;
            if (!d?.ok || !d.voucher) {
              toast(
                d?.error === "used_today"
                  ? "You’ve had today’s test USDC. There’s more tomorrow."
                  : d?.error === "rate_limited"
                    ? "Too many taps. Try again in a few minutes."
                    : "Couldn’t get test USDC just now. Try again.",
                "info",
              );
              return false;
            }
            const v = d.voucher;
            return runFaucet(run, {
              what: "test USDC",
              calls: () => [
                {
                  to: usdc,
                  data: encodeFunctionData({
                    abi: mockUsdcAbi,
                    functionName: "faucet",
                    args: [v.profile, BigInt(v.deadline), v.sig],
                  }),
                },
              ],
              token: usdc,
              amount: TEST_USDC_FAUCET,
              arrived: `Test USDC arrived: ${fmtUsdc(TEST_USDC_FAUCET)} test USDC`,
            });
          },
          false,
        );
      },

      earningsShare: earningsQ.data?.share ?? null,
      earnings: earningsQ.data
        ? earningsFromJson(earningsQ.data.earnings, (id) => state.words.find((w) => tokenIdOf(w.word).toString() === id)?.word)
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

      market: {
        letterBook: market.letterBook,
        myLetters: market.myLetters,
        sales: market.sales,
        letterStats: market.letterStats,
        tierStats: market.tierStats,
        faces: market.faces,
        loading: market.loading || (ui.view === "swap" && wordBoardQ.isPending),
        unavailable: market.unavailable || (wordBoardQ.isError && !wordBoardQ.data),
        lettersClosed: market.lettersClosed,
        oldSwaps: market.oldSwaps.map(({ maker, giveId, wantId, orderHash }) => ({ maker, giveId, wantId, orderHash })),
        isMine: (maker: string) => bagWallets.some((w) => w.toLowerCase() === maker.toLowerCase()),
        isHere: (maker: string) => !!address && address.toLowerCase() === maker.toLowerCase(),
        moreAsks: market.moreAsks,

        /**
         * Sell letters (decisions.md #30). At most one send, then a free signature: the send cancels
         * this wallet's earlier orders for the letter (the approval covers every letter for good, so
         * an old order would fill at its old price the next time the wallet held one) and approves
         * Letters to Seaport. Either part is skipped when not needed.
         */
        listLetters: async (letterId: number, qty: number, unitPrice: number) => {
          if (!address) return false;
          const name = letterLabel(letterId);
          if (!Number.isInteger(qty) || qty < 1) return false;
          // Before the wallet is asked to approve or sign anything it couldn't use.
          if (market.lettersClosed) {
            toast("Letters aren’t open for sale yet. Try again soon", "info");
            return false;
          }
          if (!Number.isFinite(unitPrice) || unitPrice < MIN_LETTER_PRICE) {
            toast(`The lowest price is ${fmtWord(MIN_LETTER_PRICE)} $WORD for a letter`, "bad");
            return false;
          }
          const listed = await track(`Listing ${qty} × ${name}`, async (run, phase) => {
            const letters = addressOf("letters");
            const client = getPublicClient();
            try {
              const [staleRes, approved, held] = await Promise.all([
                fetch(`/api/market/letters?stale=${address.toLowerCase()}:${letterId}`).then((r) => r.json()),
                client.readContract({ address: letters, abi: erc1155ApprovalAbi, functionName: "isApprovedForAll", args: [address, SEAPORT] }) as Promise<boolean>,
                client.readContract({ address: letters, abi: lettersAbi, functionName: "balanceOf", args: [address, BigInt(letterId)] }) as Promise<bigint>,
              ]);
              if (held < BigInt(qty)) {
                toast(`This wallet holds ${held} × ${name}`, "bad");
                return false;
              }
              const stale = ((staleRes?.ok ? staleRes.stale : []) as { order: SeaportOrder }[]).map((x) => x.order);
              const prep = prepareLetterListingCalls(stale, approved);
              if (prep.length > 0 && !(await run(stale.length > 0 ? "Replace your listing" : "Approve your letters", () => prep))) return false;
              const counter = (await client.readContract({
                address: SEAPORT, abi: seaportAbi, functionName: "getCounter", args: [address],
              })) as bigint;
              const saltBytes = new Uint8Array(16);
              crypto.getRandomValues(saltBytes);
              const salt = BigInt("0x" + [...saltBytes].map((b) => b.toString(16).padStart(2, "0")).join(""));
              const order = buildLetterSaleOrder({
                maker: address, letterId, qty, unitPriceWei: BigInt(Math.floor(unitPrice)) * 10n ** 18n, counter,
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
              const res = await fetch("/api/market/letters", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ order, signature }),
              }).then((r) => r.json());
              if (res?.ok) {
                toast(`${qty} × ${name} for sale. They sell the moment someone buys them`, "good");
                void market.refresh(true);
                return true;
              }
              const why: Record<string, string> = {
                cancel_first: "Your earlier listing is still being cancelled. Try again in a minute",
                not_approved: "The approval hasn’t landed yet. Try again in a minute",
                not_enough_letters: `This wallet doesn’t hold ${qty} × ${name} right now`,
                price_too_low: `The lowest price is ${fmtWord(MIN_LETTER_PRICE)} $WORD for a letter`,
                bad_signature: "Your wallet’s signature didn’t check out. Try again, and tell us if it keeps happening",
                not_configured: "Letters aren’t open for sale yet. Try again soon",
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

        /**
         * Buy letters from one listing. The signed order is fetched now, with how many are left, so a
         * listing that sold while the page was open says so instead of failing in the wallet. Then it
         * waits for the letters to show in this wallet, as a claim waits for its word.
         */
        buyLetters: async (ask, count: number) => {
          if (!address || !chain.player) return false;
          const name = letterLabel(ask.letterId);
          const bought = await track(`Buying ${count} × ${name}`, async (run) => {
            const row = await fetchLetterOrder(ask.orderHash);
            if (!row || row.available < 1) {
              toast("That listing just sold out", "info");
              void market.refresh(true);
              return false;
            }
            // The order must still be the one the player tapped: this letter, at the price shown.
            if (Number(row.order.offer[0].identifierOrCriteria) !== ask.letterId || lettersPriceWei(row.order, 1) !== BigInt(ask.unitPrice) * 10n ** 18n) {
              toast("That listing changed. Take another look at it", "info");
              void market.refresh(true);
              return false;
            }
            const take = Math.min(count, row.available);
            const price = lettersPriceWei(row.order, take);
            if (chain.player!.balanceWei < price) {
              toast(`You need ${fmtWord(Number(price / 10n ** 18n))} $WORD for ${take} × ${name}`, "bad");
              return false;
            }
            const client = getPublicClient();
            const letters = addressOf("letters");
            const heldNow = () => client.readContract({ address: letters, abi: lettersAbi, functionName: "balanceOf", args: [address, BigInt(ask.letterId)] }) as Promise<bigint>;
            const [allowance, before] = await Promise.all([
              client.readContract({ address: wordTokenAddress(), abi: erc20Abi, functionName: "allowance", args: [address, SEAPORT] }) as Promise<bigint>,
              heldNow(),
            ]);
            if (!(await run(`Buy ${take} × ${name}`, () => buyLettersCalls(row.order, row.signature, take, allowance), { settles: true }))) return false;
            let held = before;
            const seen = await readUntil(async () => (held = await heldNow()), (now) => now > before);
            void market.refresh(true);
            if (!seen) {
              toast(`Sent. Your ${name} will show in your bag once the chain confirms it.`, "info");
              void chain.refresh();
              return false;
            }
            // The bag first, then the sheet: it says what these letters now spell, from the bag
            // (sheets/BoughtLettersSheet). A refresh that fails still celebrates what the chain
            // showed; the sheet names no word until the bag shows `had` + `count` (Bugbot on #223).
            await chain.refresh().catch(() => {});
            // What ARRIVED, never what was asked for: Seaport trims a fill when another buyer took
            // part of the listing first, and the wallet then gets (and pays for) fewer.
            const got = Math.min(take, Number(held - before));
            dispatch({
              t: "arrive",
              sheet: { kind: "boughtLetters", letterId: ask.letterId, count: got, unitPrice: ask.unitPrice, had: Number(before) },
              text: `${got} × ${name} in your bag`,
            });
            return true;
          }, false);
          return bought === true;
        },

        cancelLetterListing: (orderHash: string) => {
          void track("Taking your letters off sale", async (run) => {
            const row = await fetchLetterOrder(orderHash);
            if (!row) return void market.refresh(true);
            // The refresh re-reads at 0, 4, and 10 s: the route reads Seaport, which an RPC may show a moment late.
            if (await run("Cancel listing", () => cancelOrderCalls(row.order))) void market.refresh(true);
          }, undefined);
        },

        cancelOldSwap: (orderHash: string) => {
          void track("Cancelling your offer", async (run) => {
            const row = market.oldSwaps.find((r) => r.orderHash === orderHash);
            if (!row) return;
            if (await run("Cancel offer", () => cancelOrderCalls(row.order))) {
              for (const ms of [0, 4_000, 10_000]) setTimeout(() => void market.refresh(), ms);
            }
          }, undefined);
        },
      },

      wordBoard: wordBoardQ.data ?? [],

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
              refreshWords();
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
        if (chain.player.balanceWei < BigInt(row.priceWei)) return void toast(`You need ${fmtWord(row.price)} $WORD to buy ${row.word}`, "bad");
        void track(`Buying ${row.word}`, async (run) => {
          const [signed, allowance] = await Promise.all([
            fetchWordOrder(orderHash),
            getPublicClient().readContract({ address: wordTokenAddress(), abi: erc20Abi, functionName: "allowance", args: [address, SEAPORT] }) as Promise<bigint>,
          ]);
          // The board said this price a moment ago; the order must still say it.
          if (!signed || orderPriceWei(signed.order) !== BigInt(row.priceWei)) {
            toast(`${row.word} just sold, or came off sale`, "info");
            refreshWords();
            return false;
          }
          return sendAndSettle(
            run,
            `Buy ${row.word}`,
            () => buyWordCalls(signed.order, signed.signature, allowance),
            (ws) => ws.some((x) => x.word === row.word && x.mine),
            {
              done: () => null,
              pending: `Sent. ${row.word} will show in your bag once the chain confirms it.`,
            },
          ).then((ok) => {
            // It read back as this wallet's: the word stands up in its scene (sheets/CelebrateSheet).
            if (ok) dispatch({ t: "arrive", sheet: { kind: "celebrate", word: row.word, bought: { price: row.price } }, text: `${row.word} is yours.` });
            refreshWords();
            void market.refresh(true);
            return ok;
          });
        }, false);
      },

      cancelWordListing: (orderHash: string) => {
        void track("Taking your word off sale", async (run) => {
          const signed = await fetchWordOrder(orderHash);
          if (!signed) return void refreshWords();
          if (await run("Cancel listing", () => cancelOrderCalls(signed.order))) refreshWords();
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

      // The Shop (decisions.md #22). Never sponsored: a refused paymaster call fails the whole send in
      // Coinbase Wallet, and the CDP policy doesn't cover the Shop yet (web3-runtime-plan.md).
      buyShopItem: async (item: { id: number; priceUsdc: bigint }) => {
        const shop = shopAddress();
        const usdc = usdcAddress();
        if (!shop || !usdc) {
          toast("The Shop isn’t open on this network", "bad");
          return false;
        }
        if (!address) {
          toast("Connect a wallet first", "bad");
          return false;
        }
        const me = address;
        return track(
          "Buying",
          async (run, phase) => {
            const client = getPublicClient();
            // Read fresh, in one block: the price may have changed since the sheet loaded.
            const [onchain, balance, allowance, nonce, name, version] = await client.multicall({
              allowFailure: false,
              contracts: [
                { address: shop, abi: shopAbi, functionName: "item", args: [BigInt(item.id)] },
                { address: usdc, abi: erc20Abi, functionName: "balanceOf", args: [me] },
                { address: usdc, abi: erc20Abi, functionName: "allowance", args: [me, shop] },
                { address: usdc, abi: mockUsdcAbi, functionName: "nonces", args: [me] },
                { address: usdc, abi: mockUsdcAbi, functionName: "name" },
                { address: usdc, abi: mockUsdcAbi, functionName: "version" },
              ],
            });
            const price = (onchain as { priceUsdc: bigint }).priceUsdc;
            if (price !== item.priceUsdc) {
              toast("This item’s price just changed. Have another look.", "info");
              return false;
            }
            if ((balance as bigint) < price) {
              toast(NETWORK.isTestnet ? "Not enough test USDC. Tap Get test USDC first." : "Not enough USDC in this wallet.", "info");
              return false;
            }
            const provider = (await connector?.getProvider?.()) as Eip1193Provider | undefined;
            const batch = provider
              ? await provider
                  .request({ method: "wallet_getCapabilities", params: [me, [NETWORK.idHex]] })
                  .then(() => true, () => false)
              : false;
            let route: BuyRoute = buyRoute({ allowance: allowance as bigint, price, batch });
            let calls: Call[] = [buyCall(shop, item.id, me)];
            if (route === "batch") calls = [approveCall(usdc, shop, price), buyCall(shop, item.id, me)];
            if (route === "permit" && provider) {
              phase("wallet");
              const deadline = BigInt(Math.floor(Date.now() / 1000) + 30 * 60);
              const sig = await provider
                .request({
                  method: "eth_signTypedData_v4",
                  params: [
                    me,
                    permitTypedDataJson({
                      usdc, name: name as string, version: version as string, chainId: NETWORK.id,
                      owner: me, spender: shop, value: price, nonce: nonce as bigint, deadline,
                    }),
                  ],
                })
                .then(
                  (r) => r as `0x${string}`,
                  (err) => {
                    if (isUnsupported(err)) return null; // can't sign a permit: approve, then buy
                    throw err; // the player said no
                  },
                )
                .catch((err) => {
                  toast(/reject|denied|4001/i.test(String((err as Error)?.message)) ? "Cancelled" : "Couldn’t sign the payment", "info");
                  return undefined;
                });
              if (sig === undefined) return false;
              if (sig === null) route = "approve-then-buy";
              else calls = [buyWithPermitCall(shop, item.id, me, deadline, sig)];
            }
            if (route === "approve-then-buy") {
              let approved: SendResult | undefined;
              if (!(await run("Approve", () => [approveCall(usdc, shop, price)], { settles: true, onSent: (r) => (approved = r) }))) return false;
              const t = await traceSent(approved);
              if (t.kind !== "landed" && t.kind !== "seen") {
                toast("The USDC approval didn’t land, so nothing was bought. Try again.", "bad");
                return false;
              }
            }

            let sent: SendResult | undefined;
            if (!(await run("Buy", () => calls, { settles: true, onSent: (r) => (sent = r) }))) return false;
            // For a send nobody can trace, the fallback is the buyer's own USDC: down by the price
            // from the fresh read above means the purchase landed.
            const before = balance as bigint;
            const trace = await traceSent(sent, async () => {
              const now = (await client.readContract({ address: usdc, abi: erc20Abi, functionName: "balanceOf", args: [me] })) as bigint;
              return now <= before - price;
            });
            if (trace.kind !== "landed" && trace.kind !== "seen") {
              toast(
                trace.kind === "reverted" || trace.kind === "wallet_failed"
                  ? "The purchase failed, and nothing was charged. Try again."
                  : "Your purchase hasn’t landed yet. It shows here once it does.",
                trace.kind === "reverted" || trace.kind === "wallet_failed" ? "bad" : "info",
                15_000,
              );
              return false;
            }
            // Record it now so it's in the wardrobe at once; the wardrobe's own catch-up is the backstop.
            if ("hash" in trace) {
              await fetch("/api/shop/record", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ txHash: trace.hash }),
              }).catch(() => null);
            }
            void qc.invalidateQueries({ queryKey: ["shop"] });
            void chain.refresh();
            toast("Bought. It’s in your wardrobe.", "good");
            return true;
          },
          false,
        );
      },
    }),
    [state, chain, address, connector, qc, pityNotes, settleAscension, noteAscension, unfinishedAscents, unfinishedMarks, markAscent, wordsQ, track, gate, busy, toast, postJson, openPostJson, authError, dailyError, packError, finishLetterCommit, finishRoll, resumeOpenRoll, soldOutFor, revealCommit, guarded, pendingQ, claimablesQ, earningsQ, market, bagWallets, wordBoardQ, refreshWords, ui.view, sendAndSettle, snackVoucher, runFaucet, traceSent],
  );

  return <GameCtx.Provider value={api}>{children}</GameCtx.Provider>;
}

