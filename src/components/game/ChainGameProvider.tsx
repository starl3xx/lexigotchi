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
import { useCallback, useMemo, useReducer, useRef, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
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
  chainPrice,
  GameCtx,
  reducer,
  seedState,
} from "./state";
import { rollSuccessProbability } from "@/lib/params";
import { useOnchain } from "./useOnchain";
import {
  readFeeBuckets,
  readOwnedWords,
  readLetterCounts,
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
import { verifiedDailyKey } from "@/lib/onchain/verifications";
import { bagWalletsOf, unionWords, sumLetterCounts, type BagWord } from "@/lib/onchain/unionBag";
import { SEAPORT, seaportAbi, buildLetterSwapOrder, orderTypedData, fulfillOrderCalls, cancelOrderCalls, type LetterSwapOrder } from "@/lib/onchain/seaport";
import { operatorApprovalCalls } from "@/lib/onchain/allowances";
import { erc1155ApprovalAbi } from "@/lib/onchain/abis";
import { getPublicClient } from "@/lib/onchain/reads";
import { addressOf } from "@/lib/onchain/addresses";
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
  prestigeRevealCalls,
  dissolveCalls,
  claimCalls,
  stakeCalls,
  unstakeCalls,
  feedCalls,
  feedManyCalls,
  faucetCalls,
  commitPackCalls,
  claimRewardCalls,
  type RewardClaim,
} from "@/lib/onchain/actions";
import { tokenIdOf } from "@/lib/onchain/tokenId";
import { NETWORK } from "@/lib/onchain/network";
import { wordTier } from "@/lib/economy";
import { guardedAction, NOT_STARTED } from "@/lib/onchain/guardedAction";
import { createActionGate, type Busy, type SetPhase } from "@/lib/onchain/actionGate";
import type { Call } from "@/lib/onchain/sendCalls";
import { authedPostJson, maybeAuthedPostJson } from "./campaignClient";

const EMPTY_26 = Array.from({ length: 26 }, () => 0);

/** Signing-route response shapes. */
// The two vouchers differ: the free pack is nonce-scoped, the daily is UTC-day-scoped.
interface PackVoucher { fid: string; nonce: string; deadline: string; signature: `0x${string}` }
interface DailyVoucher { fid: string; today: number; deadline: string; signature: `0x${string}` }
/** Pre-signed reveal for the predicted commitId — lets commit+reveal ride one send. */
interface DailyBundle { predictedCommitId: string; letterIndexes: number[]; revealSignature: `0x${string}` }
interface LetterReveal { letterIndexes: number[]; signature: `0x${string}` }
interface OutcomeReveal { success: boolean; signature: `0x${string}`; probability: number }

/**
 * Send one batch inside an action (see `track`): its label, and a builder for the calls. Each
 * action gets its own, bound to that action's status, so an abandoned action (dismissed with Hide,
 * then answered late by its wallet) can't drive a newer action's status.
 */
type RunFn = (label: string, build: () => Call[]) => Promise<boolean>;

/** Chain words → the shape screens already destructure. */
function toOwnedWord(w: BagWord): OwnedWord {
  return {
    word: w.word,
    tier: wordTier(w.word),
    upper: w.upper,
    staked: w.staked,
    daysUnfed: w.daysUnfed,
    prestigeLevel: w.prestigeLevel,
    // Prestige pity is a per-token mapping with no batch getter; not surfaced yet, so the UI shows
    // base odds rather than an invented streak.
    prestigePity: 0,
    // Union-bag attribution: only the connected wallet's words take actions; the rest display
    // with a "held by" note (the contracts act on msg.sender's assets, full stop).
    mine: w.mine,
    holder: w.mine ? undefined : w.holder,
  };
}

export function ChainGameProvider({ children }: { children: ReactNode }) {
  // The same reducer still owns nav/sheet/toast; the economy fields it computes are overridden
  // below by chain reads, so its money actions are simply never dispatched here.
  const [ui, dispatch] = useReducer(reducer, undefined, seedState);
  const chain = useOnchain();
  const { address, connector } = useAccount();

  // What the player is waiting on (the BusyPill), from the tap to the last read. One action at a
  // time: see lib/onchain/actionGate for why a tap must never look ignored.
  const [busy, setBusy] = useState<Busy | null>(null);
  const gate = useRef(createActionGate(setBusy)).current;

  // ── THE UNION BAG ──────────────────────────────────────────────────────────────────────────
  // One collection per human: the connected wallet plus every wallet Farcaster links to the
  // account. Words and letter counts union for display; spending stays with the connected wallet
  // (the contracts act on msg.sender, full stop) — `mine` on each word carries the difference.
  const viewer = useViewer();
  const bagWallets = useMemo(
    () => bagWalletsOf(address, viewer.linkedWallets),
    [address, viewer.linkedWallets],
  );
  const bagKey = bagWallets.join(",");

  const wordsQ = useQuery({
    queryKey: ["ownedWords", NETWORK.id, bagKey],
    queryFn: async () => {
      const perWallet = await Promise.all(
        bagWallets.map(async (wallet) => ({ wallet, words: await readOwnedWords(wallet) })),
      );
      return unionWords(perWallet, address);
    },
    enabled: !!address && chain.deployed,
    staleTime: 10_000,
  });

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

  // The identity today's daily would be issued under — mirrors the server's JWT-wins ordering
  // (free-daily route): the Farcaster fid when signed in, else the wallet's synthetic 2^160 key.
  // Getting this wrong shows "Pull" to a player the contract will refuse, and the refusal reads
  // as a bug (it did, on the first live test).
  const dailyKey = viewer.fid ? BigInt(viewer.fid) : address ? verifiedDailyKey(address) : null;

  const dayQ = useQuery({
    queryKey: ["dayState", NETWORK.id, dailyKey?.toString()],
    queryFn: () => readDayState(dailyKey!),
    enabled: dailyKey !== null && chain.deployed,
    staleTime: 30_000,
    refetchInterval: 60_000, // the UTC rollover must flip the card without a reload
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

  // Unclaimed reward leaves for the whole bag, from the keeper's published epochs.
  const claimablesQ = useQuery({
    queryKey: ["claimables", NETWORK.id, bagKey],
    queryFn: async () => {
      const res = await fetch(`/api/rewards/claimable?wallets=${bagWallets.join(",")}`);
      const data = await res.json();
      return data?.ok ? (data.claimables as {
        stream: "yield" | "bounty"; epochId: string; tokenId: string;
        account: `0x${string}`; amount: string; proof: `0x${string}`[];
      }[]) : [];
    },
    enabled: !!address && chain.deployed,
    staleTime: 30_000,
  });

  // The letter-swap board (Seaport bulletin). Rows are pre-filtered by the API against
  // getOrderStatus, so everything here is fillable as of the last read.
  const boardQ = useQuery({
    queryKey: ["swapBoard", NETWORK.id],
    queryFn: async () => {
      const res = await fetch("/api/swap/orders");
      const data = await res.json();
      return data?.ok
        ? (data.orders as { maker: string; giveId: number; wantId: number; order: LetterSwapOrder; signature: `0x${string}`; orderHash: string }[])
        : [];
    },
    enabled: chain.deployed,
    staleTime: 15_000,
  });

  const toast = useCallback(
    (text: string, tone: Toast["tone"] = "info") => dispatch({ t: "toast", text, tone }),
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
      pity: pityQ.data ?? EMPTY_26,
      words: (wordsQ.data ?? []).map(toOwnedWord),
      // Off-chain / not-yet-wired surfaces. These are invented by the mock and have no chain
      // equivalent yet; they are zeroed rather than faked so nothing reads as real.
      streak: 0,
      day: 0,
      // Real, read from dailyUsed[dailyKey] — hardcoding false here showed "Pull" to a player the
      // contract was guaranteed to refuse, and the 409 toast read as a bug on the first live test.
      dailyMinted: dayQ.data?.dailyUsed ?? false,
      // Real pots + the keeper's actual theme rotation for the current weekly period.
      jackpotPot: bucketsQ.data?.jackpot ?? 0,
      bountyPool: bucketsQ.data?.bounty ?? 0,
      bountyTheme: dayQ.data ? themeForPeriod(Math.floor(dayQ.data.chainDay / 7)) : 0,
      mintCount: 0,
      freeSnackUsed: false,
      jackpotWord: "",
      jackpotRevealed: false,
    }),
    [ui, status, chain.error, chain.player, pityQ.data, wordsQ.data, dayQ.data, bucketsQ.data],
  );

  /** Run a batch, surfacing the two outcomes that matter: rejected, and "sent but unconfirmed". */
  const sendBatch = useCallback(
    async (label: string, build: () => Call[], phase: SetPhase) => {
      try {
        phase("wallet");
        await chain.send(build());
        phase("working");
        await Promise.all([wordsQ.refetch(), pityQ.refetch(), dayQ.refetch(), pendingQ.refetch()]);
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
        (phase) => flow((l, build) => sendBatch(l, build, phase), phase),
        refused,
        (inFlight) => toast(`Still working on: ${inFlight}`, "info"),
      ),
    [gate, sendBatch, toast],
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
  /**
   * Does this player still have today's free snack?
   *
   * Requires BOTH the contract-wide toggle and this address not having used today's — using only
   * the toggle (which is permanently true) skips the approval and reverts every feed after the
   * first one each day.
   */
  /** See lib/onchain/guardedAction — the classification logic lives there so it can be tested. */
  const guarded = useCallback(
    (flow: Parameters<typeof guardedAction>[0]) =>
      guardedAction(flow, { onError: (m) => toast(`Something went wrong: ${m.slice(0, 70)}`, "bad") }),
    [toast],
  );

  /**
   * Whether to SIZE a feed batch as free.
   *
   * Deliberately always false. PlayerState.freeSnackAvailable is read before the send and goes stale the
   * moment the free snack is spent — and this code already documents that reads lag writes. Trusting
   * it to SKIP the approval turns one stale read into a reverted transaction. Sizing conservatively
   * costs a single max-approval, once, and then erc20ApprovalCalls returns [] forever.
   */
  const feedSizingFree = false;

  const authError = useCallback((code: string | undefined, what: string) => {
    if (code === "not_signed_in" || code === "no_farcaster_host" || code === "unauthorized") {
      // Reachable on the web now that SIWF exists, so this asks for a sign-in rather than telling
      // the player to go somewhere else. The older code is still matched: an in-flight response can
      // predate a deploy.
      return `${what} needs a Farcaster sign-in — tap Connect to sign in`;
    }
    if (code === "rate_limited") return `Too many tries — give it a moment, then tap ${what} again`;
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
          return "Add Lexigotchi first — that's step one of earning the free pack";
        case "share_required":
          return "Share your cast to unlock the free pack";
        case "eligibility_unavailable":
          // Configured-but-unreachable campaign DB. Nothing was spent and nothing was lost.
          return "Can't check your free pack right now — try again in a minute";
        case "already_claimed":
          return "You've already opened your free pack";
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
          return "You've already taken today's letter — it resets at UTC midnight";
        case "verification_required":
          // A wallet with no attestation and no Farcaster session. The screens surface the verify
          // CTA; this copy is the fallback for a claim raced past a stale status.
          return "The daily needs Farcaster or a Coinbase-verified wallet";
        case "verification_unavailable":
          return "Can't check your verification right now — try again in a minute";
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
      if (!commit) return void toast("Committed but slow to appear — it'll be waiting for you", "info");
      if (!(await revealCommit(commit.commitId, run))) return void toast(strandedMsg, "info");
    },
    [address, toast, revealCommit],
  );

  /** Reveal a KNOWN, already-paid roll commit: fetch the signed outcome and send it. */
  const revealRoll = useCallback(
    async (id: bigint, run: RunFn): Promise<ActionOutcome> => {
      // openPostJson: the reveal is owner-bound and idempotent, so it needs no Farcaster session.
      const draw = await openPostJson<{ reveal: OutcomeReveal }>("/api/roll/reveal", { commitId: String(id) });
      if (!draw?.ok) {
        toast(authError(draw?.error, "Roll"), "bad");
        return { status: "stranded", note: "Your roll is paid for — reopen to finish it" };
      }
      const ok = await run("Reveal", () => rollRevealCalls(id, draw.reveal.success, draw.reveal.signature));
      if (!ok) return { status: "stranded", note: "Your roll is paid for — reopen to finish it" };
      return { status: "resolved", success: draw.reveal.success };
    },
    [openPostJson, toast, authError],
  );

  /** Second half of a roll. Distinguishes a real miss from a stale no-op via the pity streak. */
  const finishRoll = useCallback(
    async (before: readonly bigint[], run: RunFn): Promise<ActionOutcome> => {
      if (!address) return { status: "not-started" };
      toast("Rolling…", "info");
      // Everything past this point follows a PAID commit, so no failure here is "safe to retry".
      const id = await waitForNewRollCommit(address, before);
      if (id === null) {
        return { status: "stranded", note: "Roll committed but slow to appear — reopen to finish it" };
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
    async (letterIndex: number, markPaid: () => void, run: RunFn): Promise<ActionOutcome | null> => {
      if (!address) return null;
      const open = await readOpenRollFor(address, letterIndex);
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
              return { status: "stranded" as const, note: "Your letter is committed — tap Open to reveal it" };
            }
            return { status: "not-started" as const };
          }

          // No bundle — the original two-phase flow.
          const before = (await readPendingCommits(address)).map((c) => c.commitId);
          if (!(await run("Daily", commitCalls))) return { status: "not-started" as const };
          markPaid();
          await finishLetterCommit(before, "Your daily letter is paid for — reopen to finish it", run);
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
            return void toast("Pack is committed but slow to appear — it'll be waiting for you", "info");
          }

          const draw = await postJson<{ reveal: LetterReveal }>("/api/mint/reveal", { commitId: String(commit.commitId) });
          if (!draw?.ok) return void toast(authError(draw?.error, "Draw"), "bad");

          const revealed = await run("Reveal", () =>
            revealCalls(commit.commitId, draw.reveal.letterIndexes, draw.reveal.signature),
          );
          if (!revealed) {
            // The draw is deterministic, so retrying later yields the identical letters.
            return void toast("Your pack is paid for — reopen to finish it", "info");
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
          const resumed = await resumeOpenRoll(word.toUpperCase().charCodeAt(pos) - 65, markPaid, run);
          if (resumed) return resumed;
          const before = await readOpenRollCommits(address);
          if (!(await run("Roll", () => commitWordRollCalls(tokenIdOf(word), pos, chain.params!, chain.player!)))) return { status: "not-started" as const };
          markPaid(); // the fee is taken from here on — no failure past this point is retryable
          return finishRoll(before, run);
        }), NOT_STARTED),

      prestige: (word: string) =>
        track(`Ascending ${word}`, (run) => guarded(async (markPaid) => {
          if (!chain.params || !chain.player || !address) return { status: "not-started" as const };
          // One unrevealed ascension per Word (Prestige.attemptOpen): finish an open one, never pay twice.
          let id = await readOpenPrestigeFor(tokenIdOf(word));
          if (id !== null) {
            toast("Finishing your unfinished ascension first", "info");
            markPaid(); // paid at its commit
          } else {
            const before = await readOpenPrestigeCommits(address);
            if (!(await run("Ascension", () => commitPrestigeCalls(tokenIdOf(word), chain.params!, chain.player!)))) return { status: "not-started" as const };
            markPaid(); // fee + burned snack are gone from here on
            toast("Ascending…", "info");
            id = await waitForNewPrestigeCommit(address, before);
            if (id === null) {
              return { status: "stranded", note: "Ascension committed but slow to appear — reopen to finish it" };
            }
          }
          const commitId = id;
          const draw = await openPostJson<{ reveal: OutcomeReveal }>("/api/prestige/reveal", { commitId: String(commitId) });
          if (!draw?.ok) {
            toast(authError(draw?.error, "Ascension"), "bad");
            return { status: "stranded", note: "Ascension is paid for — reopen to finish it" };
          }
          if (!(await run("Reveal", () => prestigeRevealCalls(commitId, draw.reveal.success, draw.reveal.signature)))) {
            return { status: "stranded", note: "Ascension is paid for — reopen to finish it" };
          }
          // Announce it here: WordSheet returns early on a promise, so nothing else reports this.
          toast(draw.reveal.success ? `${word} ascended — a gilded glow-up` : `${word} held its ground`,
                draw.reveal.success ? "good" : "info");
          return { status: "resolved", success: draw.reveal.success };
        }), NOT_STARTED),

      claim: (word: string, useUpper: boolean) => {
        void track(`Claiming ${word}`, async (run) => {
          if (!chain.params || !chain.player) return void toast("Still loading", "info");
          const proof = await fetch(`/api/dictionary/proof?word=${encodeURIComponent(word)}`).then((r) => r.json());
          if (!proof.ok) {
            // The word list was updated and the contract hasn't caught up (setDictionaryRoot).
            if (proof.error === "dictionary_mismatch") {
              return void toast("The word list was just updated. Claims reopen shortly.", "info");
            }
            return void toast(`${word} isn't claimable`, "bad");
          }
          await run(`Claim ${word}`, () =>
            claimCalls(proof.word, proof.proof, useUpper, chain.params!, chain.player!),
          );
        }, undefined);
      },

      toggleStake: (word: string) => {
        const w = state.words.find((x) => x.word === word);
        if (!w || !chain.player) return;
        void track(w.staked ? `Unstaking ${word}` : `Staking ${word}`, (run) =>
          run(w.staked ? `Unstake ${word}` : `Stake ${word}`, () =>
            w.staked ? unstakeCalls(tokenIdOf(word)) : stakeCalls(tokenIdOf(word), chain.player!),
          ), false);
      },

      feed: (word: string) => {
        if (!chain.params || !chain.player) return;
        void track(`Feeding ${word}`, (run) =>
          run(`Feed ${word}`, () =>
            feedCalls(tokenIdOf(word), chain.params!, chain.player!, feedSizingFree),
          ), false);
      },

      feedAll: () => {
        if (!chain.params || !chain.player) return;
        // Only words that are actually hungry — feed() has no on-chain guard, so feeding a fed word
        // burns a snack for nothing and there is no revert to catch.
        // mine only: feed() is staker-only on-chain, so a linked wallet's word would revert the batch.
        const hungry = state.words.filter((w) => w.mine && w.staked && w.daysUnfed > 0).map((w) => tokenIdOf(w.word));
        if (hungry.length === 0) return void toast("Nobody's hungry", "info");
        void track("Feeding your words", (run) =>
          run("Feed all", () =>
            feedManyCalls(hungry, chain.params!, chain.player!, feedSizingFree),
          ), false);
      },

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
      addDemoBalance: () => {
        if (!NETWORK.isTestnet || !address) return void toast("No faucet on mainnet", "bad");
        void track("Getting test $WORD", (run) => run("Faucet", () => faucetCalls(address, 50_000_000)), false);
      },

      claimables: (claimablesQ.data ?? []).map((c) => ({
        stream: c.stream,
        tokenId: c.tokenId,
        amount: Number(BigInt(c.amount) / 10n ** 12n) / 1e6, // wei → whole $WORD for display
      })),
      claimEarnings: () => {
        const raw = claimablesQ.data ?? [];
        if (raw.length === 0) return;
        const claims: RewardClaim[] = raw.map((c) => ({
          stream: c.stream,
          epochId: BigInt(c.epochId),
          tokenId: BigInt(c.tokenId),
          account: c.account,
          amount: BigInt(c.amount),
          proof: c.proof,
        }));
        void track("Claiming your rewards", async (run) => {
          if (await run("Claim", () => claimRewardCalls(claims))) void claimablesQ.refetch();
        }, undefined);
      },

      spendable: (w: OwnedWord) =>
        !!chain.params && !!chain.player && chain.player.balance >= chain.params.word.roll && !w.upper.every(Boolean),
      rollProb: (pity: number) => rollSuccessProbability(pity),

      swapBoard: (boardQ.data ?? []).map(({ maker, giveId, wantId, orderHash }) => ({ maker, giveId, wantId, orderHash })),

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
            if (!provider) return void toast("This wallet can't sign offers", "bad");
            phase("wallet");
            const signature = (await provider.request({
              method: "eth_signTypedData_v4",
              params: [address, JSON.stringify(orderTypedData(order))],
            })) as `0x${string}`;
            phase("working");
            const res = await fetch("/api/swap/orders", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ order, signature }),
            }).then((r) => r.json());
            if (res?.ok) {
              toast("Offer listed — it fills the moment someone takes it", "good");
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
    [state, chain, address, connector, track, gate, busy, toast, postJson, openPostJson, authError, dailyError, packError, finishLetterCommit, finishRoll, resumeOpenRoll, soldOutFor, revealCommit, guarded, pendingQ, claimablesQ, boardQ],
  );

  return <GameCtx.Provider value={api}>{children}</GameCtx.Provider>;
}

