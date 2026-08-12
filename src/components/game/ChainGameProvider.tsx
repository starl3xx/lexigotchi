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
import { useCallback, useMemo, useReducer, type ReactNode } from "react";
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
  GameCtx,
  reducer,
  seedState,
} from "./state";
import { rollSuccessProbability } from "@/lib/params";
import { useOnchain } from "./useOnchain";
import {
  readOwnedWords,
  readPity,
  readPendingCommits,
  waitForNewCommit,
  readOpenRollCommits,
  waitForNewRollCommit,
  readOpenPrestigeCommits,
  waitForNewPrestigeCommit,
  type ChainWord,
} from "@/lib/onchain/reads";
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
} from "@/lib/onchain/actions";
import { tokenIdOf } from "@/lib/onchain/tokenId";
import { NETWORK } from "@/lib/onchain/network";
import { wordTier } from "@/lib/economy";
import { authedPostJson } from "./campaignClient";

const EMPTY_26 = Array.from({ length: 26 }, () => 0);

/** Signing-route response shapes. */
// The two vouchers differ: the free pack is nonce-scoped, the daily is UTC-day-scoped.
interface PackVoucher { fid: string; nonce: string; deadline: string; signature: `0x${string}` }
interface DailyVoucher { fid: string; today: number; deadline: string; signature: `0x${string}` }
interface LetterReveal { letterIndexes: number[]; signature: `0x${string}` }
interface OutcomeReveal { success: boolean; signature: `0x${string}`; probability: number }

/** Chain words → the shape screens already destructure. */
function toOwnedWord(w: ChainWord): OwnedWord {
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
  };
}

export function ChainGameProvider({ children }: { children: ReactNode }) {
  // The same reducer still owns nav/sheet/toast; the economy fields it computes are overridden
  // below by chain reads, so its money actions are simply never dispatched here.
  const [ui, dispatch] = useReducer(reducer, undefined, seedState);
  const chain = useOnchain();
  const { address } = useAccount();

  const wordsQ = useQuery({
    queryKey: ["ownedWords", NETWORK.id, address],
    queryFn: () => readOwnedWords(address as `0x${string}`),
    enabled: !!address && chain.deployed,
    staleTime: 10_000,
  });

  const pityQ = useQuery({
    queryKey: ["pity", NETWORK.id, address],
    queryFn: () => readPity(address as `0x${string}`),
    enabled: !!address && chain.deployed,
    staleTime: 30_000,
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
      lower: chain.player ? chain.player.letters.slice(0, 26) : EMPTY_26,
      upper: chain.player ? chain.player.letters.slice(26, 52) : EMPTY_26,
      pity: pityQ.data ?? EMPTY_26,
      words: (wordsQ.data ?? []).map(toOwnedWord),
      // Off-chain / not-yet-wired surfaces. These are invented by the mock and have no chain
      // equivalent yet; they are zeroed rather than faked so nothing reads as real.
      streak: 0,
      day: 0,
      dailyMinted: false,
      mintCount: 0,
      freeSnackUsed: false,
      jackpotWord: "",
      jackpotPot: 0,
      jackpotRevealed: false,
      bountyTheme: 0,
    }),
    [ui, status, chain.error, chain.player, pityQ.data, wordsQ.data],
  );

  /** Run a batch, surfacing the two outcomes that matter: rejected, and "sent but unconfirmed". */
  const run = useCallback(
    async (label: string, build: () => Parameters<typeof chain.send>[0]) => {
      try {
        await chain.send(build());
        await Promise.all([wordsQ.refetch(), pityQ.refetch()]);
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
    [chain, toast, wordsQ, pityQ],
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

  /** Server error codes → something a player can act on. */
  /**
   * Does this player still have today's free snack?
   *
   * Requires BOTH the contract-wide toggle and this address not having used today's — using only
   * the toggle (which is permanently true) skips the approval and reverts every feed after the
   * first one each day.
   */
  const freeSnackAvailable = useCallback(
    () => !!chain.params?.freeDailySnack && !!chain.player?.freeSnackAvailable,
    [chain.params, chain.player],
  );

  const authError = useCallback((code: string | undefined, what: string) => {
    if (code === "no_farcaster_host" || code === "unauthorized") {
      return `${what} needs a Farcaster sign-in — open Lexigotchi in Farcaster or Base App`;
    }
    return `${what} unavailable: ${code ?? "unknown"}`;
  }, []);

  const dailyError = useCallback(
    (code?: string) =>
      code === "already_claimed_today"
        ? "You've already taken today's letter — it resets at UTC midnight"
        : authError(code, "The daily"),
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
  const finishLetterCommit = useCallback(
    async (before: readonly bigint[], strandedMsg: string) => {
      if (!address) return;
      toast("Opening…", "info");
      const commit = await waitForNewCommit(address, before);
      if (!commit) return void toast("Committed but slow to appear — it'll be waiting for you", "info");
      const draw = await postJson<{ reveal: LetterReveal }>("/api/mint/reveal", { commitId: String(commit.commitId) });
      if (!draw?.ok) return void toast(authError(draw?.error, "Draw"), "bad");
      const ok = await run("Reveal", () =>
        revealCalls(commit.commitId, draw.reveal.letterIndexes, draw.reveal.signature),
      );
      if (!ok) return void toast(strandedMsg, "info");
      dispatch({ t: "sheet", sheet: { kind: "pack", letters: draw.reveal.letterIndexes } });
    },
    [address, postJson, run, toast, authError],
  );

  /** Second half of a roll. Distinguishes a real miss from a stale no-op via the pity streak. */
  const finishRoll = useCallback(
    async (before: readonly bigint[]) => {
      if (!address) return;
      toast("Rolling…", "info");
      const id = await waitForNewRollCommit(address, before);
      if (id === null) return void toast("Roll committed but slow to appear — it'll be waiting", "info");
      const draw = await postJson<{ reveal: OutcomeReveal }>("/api/roll/reveal", { commitId: String(id) });
      if (!draw?.ok) return void toast(authError(draw?.error, "Roll"), "bad");
      const ok = await run("Reveal", () => rollRevealCalls(id, draw.reveal.success, draw.reveal.signature));
      if (!ok) return void toast("Your roll is paid for — reopen to finish it", "info");
      toast(draw.reveal.success ? "Raised!" : "Missed — your odds go up next time", draw.reveal.success ? "good" : "info");
    },
    [address, postJson, run, toast, authError],
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

      /** The FID-gated free daily: voucher → commit → discover → draw → reveal. */
      dailyMint: () => {
        void (async () => {
          if (!address) return void toast("Connect a wallet first", "bad");
          const res = await postJson<{ voucher: DailyVoucher }>("/api/mint/free-daily", { wallet: address });
          if (!res?.ok) return void toast(dailyError(res?.error), "bad");
          const v = res.voucher;
          const before = (await readPendingCommits(address)).map((c) => c.commitId);
          if (!(await run("Daily", () =>
            commitFreeDailyCalls({ fid: BigInt(v.fid), deadline: BigInt(v.deadline), signature: v.signature }),
          ))) return;
          await finishLetterCommit(before, "Your daily letter is paid for — reopen to finish it");
        })();
        return null;
      },

      /**
       * The full two-transaction pack: voucher → commit → discover the commitId from the log →
       * backend draw → reveal. Returns [] because the letters genuinely do not exist yet; the sheet
       * opens when they do.
       */
      openPack: () => {
        void (async () => {
          if (!address) return void toast("Connect a wallet first", "bad");

          const res = await postJson<{ voucher: PackVoucher }>("/api/mint/free-pack", { wallet: address });
          if (!res?.ok) return void toast(authError(res?.error, "Pack"), "bad");

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
        })();
        return [];
      },

      rollLoose: (idx: number) => {
        void (async () => {
          if (!chain.params || !chain.player || !address) return;
          const before = await readOpenRollCommits(address);
          if (!(await run("Roll", () => commitLooseRollCalls(idx, chain.params!, chain.player!)))) return;
          await finishRoll(before);
        })();
        return null;
      },

      rollWord: (word: string, pos: number) => {
        void (async () => {
          if (!chain.params || !chain.player || !address) return;
          const before = await readOpenRollCommits(address);
          if (!(await run("Roll", () => commitWordRollCalls(tokenIdOf(word), pos, chain.params!, chain.player!)))) return;
          await finishRoll(before);
        })();
        return null;
      },

      prestige: (word: string) => {
        void (async () => {
          if (!chain.params || !chain.player || !address) return;
          const before = await readOpenPrestigeCommits(address);
          if (!(await run("Ascension", () => commitPrestigeCalls(tokenIdOf(word), chain.params!, chain.player!)))) return;
          toast("Ascending…", "info");
          const id = await waitForNewPrestigeCommit(address, before);
          if (id === null) return void toast("Ascension committed but slow to appear — it'll be waiting", "info");
          const draw = await postJson<{ reveal: OutcomeReveal }>("/api/prestige/reveal", { commitId: String(id) });
          if (!draw?.ok) return void toast(authError(draw?.error, "Ascension"), "bad");
          if (!(await run("Reveal", () => prestigeRevealCalls(id, draw.reveal.success, draw.reveal.signature)))) {
            return void toast("Ascension is paid for — reopen to finish it", "info");
          }
          toast(draw.reveal.success ? `${word} ascended!` : `${word} held its ground`, draw.reveal.success ? "good" : "info");
        })();
        return null;
      },

      claim: (word: string, useUpper: boolean) => {
        void (async () => {
          if (!chain.params || !chain.player) return void toast("Still loading", "info");
          const proof = await fetch(`/api/dictionary/proof?word=${encodeURIComponent(word)}`).then((r) => r.json());
          if (!proof.ok) return void toast(`${word} isn't claimable`, "bad");
          await run(`Claim ${word}`, () =>
            claimCalls(proof.word, proof.proof, useUpper, chain.params!, chain.player!),
          );
        })();
      },

      toggleStake: (word: string) => {
        const w = state.words.find((x) => x.word === word);
        if (!w || !chain.player) return;
        void run(w.staked ? `Unstake ${word}` : `Stake ${word}`, () =>
          w.staked ? unstakeCalls(tokenIdOf(word)) : stakeCalls(tokenIdOf(word), chain.player!),
        );
      },

      feed: (word: string) => {
        if (!chain.params || !chain.player) return;
        void run(`Feed ${word}`, () =>
          feedCalls(tokenIdOf(word), chain.params!, chain.player!, freeSnackAvailable()),
        );
      },

      feedAll: () => {
        if (!chain.params || !chain.player) return;
        // Only words that are actually hungry — feed() has no on-chain guard, so feeding a fed word
        // burns a snack for nothing and there is no revert to catch.
        const hungry = state.words.filter((w) => w.staked && w.daysUnfed > 0).map((w) => tokenIdOf(w.word));
        if (hungry.length === 0) return void toast("Nobody's hungry", "info");
        void run("Feed all", () =>
          feedManyCalls(hungry, chain.params!, chain.player!, freeSnackAvailable()),
        );
      },

      dissolve: (word: string) => {
        void (async () => {
          if (!(await run(`Dissolve ${word}`, () => dissolveCalls(tokenIdOf(word), word)))) return;
          dispatch({ t: "sheet", sheet: null });
        })();
      },
      revealJackpot: () => null,
      skipDay: () => toast("Time moves on its own here", "info"),

      // The faucet replaces addDemoBalance — real tokens on a testnet, nothing on mainnet.
      addDemoBalance: () => {
        if (!NETWORK.isTestnet || !address) return void toast("No faucet on mainnet", "bad");
        void run("Faucet", () => faucetCalls(address, 50_000_000));
      },

      spendable: (w: OwnedWord) =>
        !!chain.params && !!chain.player && chain.player.balance >= chain.params.word.roll && !w.upper.every(Boolean),
      rollProb: (pity: number) => rollSuccessProbability(pity),
    }),
    [state, chain, address, run, toast, postJson, authError, dailyError, finishLetterCommit, finishRoll, freeSnackAvailable],
  );

  return <GameCtx.Provider value={api}>{children}</GameCtx.Provider>;
}

