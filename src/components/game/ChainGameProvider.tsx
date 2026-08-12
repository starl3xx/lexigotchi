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
import { readOwnedWords, readPity, readPendingCommits, waitForNewCommit, type ChainWord } from "@/lib/onchain/reads";
import {
  commitFreePackCalls,
  revealCalls,
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

const EMPTY_26 = Array.from({ length: 26 }, () => 0);

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

  const notWired = useCallback(
    (what: string) => {
      toast(`${what} needs its signer route — not wired yet`, "info");
      return null;
    },
    [toast],
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

      dailyMint: () => notWired("The daily"),

      /**
       * The full two-transaction pack: voucher → commit → discover the commitId from the log →
       * backend draw → reveal. Returns [] because the letters genuinely do not exist yet; the sheet
       * opens when they do.
       */
      openPack: () => {
        void (async () => {
          if (!address) return void toast("Connect a wallet first", "bad");

          const res = await fetch("/api/mint/free-pack", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ wallet: address }),
          }).then((r) => r.json());
          if (!res.ok) return void toast(`Pack unavailable: ${res.error}`, "bad");

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

          const draw = await fetch("/api/mint/reveal", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ commitId: String(commit.commitId) }),
          }).then((r) => r.json());
          if (!draw.ok) return void toast(`Draw failed: ${draw.error}`, "bad");

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

      rollLoose: () => notWired("Rolling"),
      rollWord: () => notWired("Rolling"),
      prestige: () => notWired("Ascension"),

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
          feedCalls(tokenIdOf(word), chain.params!, chain.player!, chain.params!.freeDailySnack),
        );
      },

      feedAll: () => {
        if (!chain.params || !chain.player) return;
        // Only words that are actually hungry — feed() has no on-chain guard, so feeding a fed word
        // burns a snack for nothing and there is no revert to catch.
        const hungry = state.words.filter((w) => w.staked && w.daysUnfed > 0).map((w) => tokenIdOf(w.word));
        if (hungry.length === 0) return void toast("Nobody's hungry", "info");
        void run("Feed all", () =>
          feedManyCalls(hungry, chain.params!, chain.player!, chain.params!.freeDailySnack),
        );
      },

      dissolve: () => notWired("Dissolve"),
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
    [state, chain, address, run, toast, notWired],
  );

  return <GameCtx.Provider value={api}>{children}</GameCtx.Provider>;
}

