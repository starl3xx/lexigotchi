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
  type ActionOutcome,
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
import { guardedAction } from "@/lib/onchain/guardedAction";
import { authedPostJson, maybeAuthedPostJson, canSign } from "./campaignClient";

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
  const finishLetterCommit = useCallback(
    async (before: readonly bigint[], strandedMsg: string) => {
      if (!address) return;
      toast("Opening…", "info");
      const commit = await waitForNewCommit(address, before);
      if (!commit) return void toast("Committed but slow to appear — it'll be waiting for you", "info");
      // openPostJson, not postJson: the verified-wallet daily reaches here with no Farcaster
      // session, and the reveal route accepts anonymous callers (buyer-bound + idempotent).
      const draw = await openPostJson<{ reveal: LetterReveal }>("/api/mint/reveal", { commitId: String(commit.commitId) });
      if (!draw?.ok) return void toast(authError(draw?.error, "Draw"), "bad");
      const ok = await run("Reveal", () =>
        revealCalls(commit.commitId, draw.reveal.letterIndexes, draw.reveal.signature),
      );
      if (!ok) return void toast(strandedMsg, "info");
      dispatch({ t: "sheet", sheet: { kind: "pack", letters: draw.reveal.letterIndexes } });
    },
    [address, openPostJson, run, toast, authError],
  );

  /** Second half of a roll. Distinguishes a real miss from a stale no-op via the pity streak. */
  const finishRoll = useCallback(
    async (before: readonly bigint[]): Promise<ActionOutcome> => {
      if (!address) return { status: "not-started" };
      toast("Rolling…", "info");
      // Everything past this point follows a PAID commit, so no failure here is "safe to retry".
      const id = await waitForNewRollCommit(address, before);
      if (id === null) {
        return { status: "stranded", note: "Roll committed but slow to appear — reopen to finish it" };
      }
      const draw = await postJson<{ reveal: OutcomeReveal }>("/api/roll/reveal", { commitId: String(id) });
      if (!draw?.ok) {
        toast(authError(draw?.error, "Roll"), "bad");
        return { status: "stranded", note: "Your roll is paid for — reopen to finish it" };
      }
      const ok = await run("Reveal", () => rollRevealCalls(id, draw.reveal.success, draw.reveal.signature));
      if (!ok) return { status: "stranded", note: "Your roll is paid for — reopen to finish it" };
      return { status: "resolved", success: draw.reveal.success };
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

      /**
       * The free daily: voucher → commit → discover → draw → reveal. Two identities can earn the
       * voucher — a Farcaster FID, or a Coinbase-verified wallet — so this goes through
       * openPostJson: token when present, plain when the attestation is the identity.
       */
      dailyMint: () =>
        guarded(async (markPaid) => {
          if (!address) { toast("Connect a wallet first", "bad"); return { status: "not-started" as const }; }
          const res = await openPostJson<{ voucher: DailyVoucher }>("/api/mint/free-daily", { wallet: address });
          if (!res?.ok) { toast(dailyError(res?.error), "bad"); return { status: "not-started" as const }; }
          const v = res.voucher;
          const before = (await readPendingCommits(address)).map((c) => c.commitId);
          if (!(await run("Daily", () =>
            commitFreeDailyCalls({ fid: BigInt(v.fid), deadline: BigInt(v.deadline), signature: v.signature }),
          ))) return { status: "not-started" as const };
          markPaid();
          await finishLetterCommit(before, "Your daily letter is paid for — reopen to finish it");
          // Letters arrive via the pack sheet; the caller only needs "don't call this again".
          return { status: "resolved", success: true };
        }),

      /**
       * The full two-transaction pack: voucher → commit → discover the commitId from the log →
       * backend draw → reveal. Returns [] because the letters genuinely do not exist yet; the sheet
       * opens when they do.
       */
      openPack: () => {
        void (async () => {
          if (!address) return void toast("Connect a wallet first", "bad");

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
        })();
        return [];
      },

      rollLoose: (idx: number) =>
        guarded(async (markPaid) => {
          if (!chain.params || !chain.player || !address) return { status: "not-started" as const };
          // Check we can get a reveal signature BEFORE taking the fee. The daily and the pack fetch
          // their voucher first so they fail free; a paid commit sent before this check leaves the
          // fee spent and the commit stranded with no way to finish it.
          if (!(await canSign())) {
            toast("Rolling needs a Farcaster sign-in — tap Connect to sign in", "bad");
            return { status: "not-started" as const };
          }
          const before = await readOpenRollCommits(address);
          if (!(await run("Roll", () => commitLooseRollCalls(idx, chain.params!, chain.player!)))) return { status: "not-started" as const };
          markPaid(); // the fee is taken from here on — no failure past this point is retryable
          return finishRoll(before);
        }),

      rollWord: (word: string, pos: number) =>
        guarded(async (markPaid) => {
          if (!chain.params || !chain.player || !address) return { status: "not-started" as const };
          // Check we can get a reveal signature BEFORE taking the fee. The daily and the pack fetch
          // their voucher first so they fail free; a paid commit sent before this check leaves the
          // fee spent and the commit stranded with no way to finish it.
          if (!(await canSign())) {
            toast("Rolling needs a Farcaster sign-in — tap Connect to sign in", "bad");
            return { status: "not-started" as const };
          }
          const before = await readOpenRollCommits(address);
          if (!(await run("Roll", () => commitWordRollCalls(tokenIdOf(word), pos, chain.params!, chain.player!)))) return { status: "not-started" as const };
          markPaid(); // the fee is taken from here on — no failure past this point is retryable
          return finishRoll(before);
        }),

      prestige: (word: string) =>
        guarded(async (markPaid) => {
          if (!chain.params || !chain.player || !address) return { status: "not-started" as const };
          if (!(await canSign())) {
            toast("Ascension needs a Farcaster sign-in — tap Connect to sign in", "bad");
            return { status: "not-started" as const };
          }
          const before = await readOpenPrestigeCommits(address);
          if (!(await run("Ascension", () => commitPrestigeCalls(tokenIdOf(word), chain.params!, chain.player!)))) return { status: "not-started" as const };
          markPaid(); // fee + burned snack are gone from here on
          toast("Ascending…", "info");
          const id = await waitForNewPrestigeCommit(address, before);
          if (id === null) {
            return { status: "stranded", note: "Ascension committed but slow to appear — reopen to finish it" };
          }
          const draw = await postJson<{ reveal: OutcomeReveal }>("/api/prestige/reveal", { commitId: String(id) });
          if (!draw?.ok) {
            toast(authError(draw?.error, "Ascension"), "bad");
            return { status: "stranded", note: "Ascension is paid for — reopen to finish it" };
          }
          if (!(await run("Reveal", () => prestigeRevealCalls(id, draw.reveal.success, draw.reveal.signature)))) {
            return { status: "stranded", note: "Ascension is paid for — reopen to finish it" };
          }
          // Announce it here: WordSheet returns early on a promise, so nothing else reports this.
          toast(draw.reveal.success ? `${word} ascended — a gilded glow-up` : `${word} held its ground`,
                draw.reveal.success ? "good" : "info");
          return { status: "resolved", success: draw.reveal.success };
        }),

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
          feedCalls(tokenIdOf(word), chain.params!, chain.player!, feedSizingFree),
        );
      },

      feedAll: () => {
        if (!chain.params || !chain.player) return;
        // Only words that are actually hungry — feed() has no on-chain guard, so feeding a fed word
        // burns a snack for nothing and there is no revert to catch.
        const hungry = state.words.filter((w) => w.staked && w.daysUnfed > 0).map((w) => tokenIdOf(w.word));
        if (hungry.length === 0) return void toast("Nobody's hungry", "info");
        void run("Feed all", () =>
          feedManyCalls(hungry, chain.params!, chain.player!, feedSizingFree),
        );
      },

      dissolve: (word: string) => {
        void (async () => {
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
    [state, chain, address, run, toast, postJson, openPostJson, authError, dailyError, packError, finishLetterCommit, finishRoll, guarded],
  );

  return <GameCtx.Provider value={api}>{children}</GameCtx.Provider>;
}

