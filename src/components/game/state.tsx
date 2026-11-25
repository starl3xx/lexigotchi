"use client";
/**
 * Mock game-state store for the Lexigotchi play prototype. No contracts are wired — this is a
 * faithful, INTERACTIVE stand-in for what `Letters.sol` / `Words.sol` / `Rolls.sol` /
 * `Staking.sol` / `Jackpot.sol` will drive on-chain. It reuses the real economy derivation
 * (letter odds, tiers, dictionary, pity curve, prices) so the numbers and feel are honest.
 *
 * Determinism: a seeded RNG (held in a ref) computes every random outcome; the reducer stays
 * pure (it only applies already-computed results), mirroring the commit→reveal contract pattern.
 */
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useReducer,
  useRef,
  type ReactNode,
} from "react";
import { ALPHABET, LETTER_ODDS, wordTier, type Tier } from "@/lib/economy";
import { WORDS } from "@/lib/dictionary";
import { stageFeeMultiple } from "@/lib/ascension";
import {
  DEFAULT_PARAMS,
  currentWordUsd,
  priceWord,
  rollSuccessProbability,
  prestigeSuccessProbability,
} from "@/lib/params";
import { Rng } from "@/lib/rng";
import { NETWORK } from "@/lib/onchain/network";

// ---------------------------------------------------------------------------
// Dictionary helpers (built once)
// ---------------------------------------------------------------------------

const WORD_SET = new Set(WORDS);
const LETTER_WEIGHTS = ALPHABET.map((L) => LETTER_ODDS[L]);

// anagram index: sorted-letters key → dictionary words (built once)
const sortKey = (s: string) => [...s].sort().join("");
const ANAGRAM = new Map<string, string[]>();
for (const w of WORDS) {
  const k = sortKey(w);
  const bucket = ANAGRAM.get(k);
  if (bucket) bucket.push(w);
  else ANAGRAM.set(k, [w]);
}
/** Dictionary words that are exact anagrams of the given letters (any order). */
export function anagramsOf(letters: string[]): string[] {
  if (letters.length !== 5) return [];
  return ANAGRAM.get([...letters].sort().join("")) ?? [];
}
const A = 65;
export const idxToChar = (i: number) => ALPHABET[i];
export const charToIdx = (c: string) => c.toUpperCase().charCodeAt(0) - A;

export const PRESTIGE_LEVELS = DEFAULT_PARAMS.prestige.levels;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CaseState = "lowercase" | "Mixed" | "UPPERCASE";
export type Hunger = "fed" | "peckish" | "hungry";

export interface OwnedWord {
  /** UPPERCASE dictionary key — the primary key. One NFT per word, so this is unique by
   *  construction, human-readable in React keys, and already the argument Words.claim/dissolve take.
   *  The on-chain tokenId is keccak256(word); derive it at the call site with tokenIdOf(). */
  word: string;
  tier: Tier;
  /** per-position case of the 5 escrowed letters (true = uppercase). */
  upper: boolean[];
  staked: boolean;
  daysUnfed: number;
  /** When it was last fed (unix seconds; chain store only, 0 = never). Undefined in the mock. */
  lastFedAt?: number;
  prestigeLevel: number;
  /** Consecutive failed ascension attempts on this word (the prestige pity streak). */
  prestigePity: number;
  /**
   * The union bag shows every linked wallet's words, but only the CONNECTED wallet can sign for
   * its own — `mine` gates the verbs (stake/feed/roll/ascend/dissolve). Always true in the mock.
   */
  mine: boolean;
  /** Where the word lives when it isn't the connected wallet's (lowercase address; chain only). */
  holder?: string;
  /**
   * The connected wallet is a CARETAKER of this word's staker (Staking.setCaretaker): it may feed,
   * roll, and ascend it, paying its own fees. Only the staker stakes, unstakes, or dissolves.
   */
  care?: boolean;
}

/** A word for sale on the board (GET /api/swap/words), its state read live, not from the listing. */
/** The player's free letters, as the screens read them (GameApi.freeLetters). */
export interface FreeLetterView {
  /** Free daily letters left of `dailyLimit`, or null when the server can't count yet. */
  dailyLeft: number | null;
  dailyLimit: number;
  /** All the free daily letters are taken. */
  done: boolean;
  /** The profile took its free pack. */
  packTaken: boolean;
  /** Free letters have stopped for everyone: the budget ran out, or the dictionary is nearly full. */
  stop: "budget" | "dictionary" | null;
  packStop: "budget" | "dictionary" | null;
  /** About 95% of the dictionary is claimed: the pack card points at the Market. */
  dictionaryFull: boolean;
}

export interface WordListing {
  maker: string;
  word: string;
  tokenId: string;
  /** What the buyer pays, whole $WORD (the seller gets 90%). */
  price: number;
  priceWei: string;
  upper: boolean[];
  prestigeLevel: number;
  /** Failed ascensions in a row: it travels with the word, and raises its next chance. */
  prestigePity: number;
  /** Staking.lastFed (0 = fresh): the hunger clock keeps running while it's for sale. */
  lastFedAt: number;
  orderHash: string;
  face?: PublicFace;
}

export type View =
  | "home"
  | "more"
  | "bag"
  | "mint"
  | "claim"
  | "jackpot"
  | "bounty"
  | "dictionary"
  | "leaderboard"
  /** The real $WORD token: price, supply, burns, the pool (screens/WordScreen). */
  | "word"
  /** Let's Have A Word!, Lexigotchi's sibling in the $WORD universe. */
  | "lhaw"
  | "showcase"
  | "swap";

export type RollTarget = { kind: "loose"; idx: number } | { kind: "word"; word: string; pos: number };

export type Sheet =
  | { kind: "word"; word: string }
  | { kind: "pack"; letters: number[] }
  | { kind: "roll"; target: RollTarget }
  // `need` = the action the player just got price-blocked on; BalanceSheet renders the shortfall
  // banner so every "not enough $WORD" moment lands on the Buy path instead of a dead toast.
  | { kind: "balance"; need?: { amount: number; action: string } }
  /** Linked accounts, the free daily letter, and your name and picture (sheets/ProfileSheet). */
  /** `focus: "move"` opens the Wallets card's Move panel (a game wallet notice sends players there). */
  | { kind: "profile"; focus?: "move" }
  /** The core loop on one screen (sheets/CheatSheet), behind the header's "?". */
  | { kind: "cheatsheet" }
  | { kind: "addapp" }
  /** A claim just landed: the new word celebrates (sheets/CelebrateSheet). */
  | { kind: "celebrate"; word: string }
  /** Pick a word's scene, from the Today stage (sheets/SceneSheet). */
  | { kind: "scene"; word: string }
  | { kind: "earnings" }
  | null;

export interface Toast {
  id: number;
  text: string;
  tone: "good" | "bad" | "info";
  /** How long it stays up, when its length-based default (`toastMs`) is too short: a result that
   *  lands long after the tap, which the player may come back to. */
  ms?: number;
}

/** Whether chain-derived state is actually known. See ChainGate — "loading" is not "zero". */
export type ChainStatus = "no-wallet" | "loading" | "ready" | "error";

export interface GameState {
  /** The mock always knows its own state; the chain provider drives this for real. */
  status: ChainStatus;
  /** True when this store is backed by real contracts. Surfaces that some mock-only concepts
   *  (streak, day counter, jackpot) have no chain equivalent YET, so the UI can hide them rather
   *  than render a hardcoded 0 that reads as a genuine value. */
  chainBacked: boolean;
  /** Human-readable cause when status is "error". */
  error?: string;
  balance: number; // $WORD
  lower: number[]; // [26] counts — the UNION bag on chain (every linked wallet); mock = the one bag
  upper: number[]; // [26] counts — same
  /**
   * The CONNECTED wallet's own counts — what claim/roll can actually spend. Chain-only; absent in
   * the mock (whose one bag IS the connected wallet). Read via mineLower/mineUpper, never raw.
   */
  lowerMine?: number[];
  upperMine?: number[];
  pity: number[]; // [26] loose-letter pity streak
  words: OwnedWord[];
  /**
   * How many distinct words the player has ever held, across the bag (a dissolved or sold word
   * still counts). The scenes unlock reads it, so it stays open once reached (lib/scenes).
   */
  wordsEverHeld: number;
  /**
   * The words are still on their way (the chain store's first read; never in practice). `status` can be
   * "ready" before they land, and an empty `words` then would read as "no words yet".
   */
  wordsLoading?: boolean;
  /** The words read failed and has nothing to show (a connection problem, not an empty bag). */
  wordsError?: boolean;
  /** Practice only: what its words have earned (earnings.ts practicePayout). The chain game reads earnings from the server. */
  earned?: PracticeEarned;
  streak: number;
  day: number;
  dailyMinted: boolean;
  /** The lowercase letter (0–25) today's daily gave, when this browser saw it; null otherwise. */
  dailyLetter?: number | null;
  /** Daily/pack mints made this session — drives the one-time "add the mini app" nudge. */
  mintCount: number;
  freeSnackUsed: boolean;
  jackpotWord: string;
  jackpotPot: number;
  /** The bounty bucket, whole $WORD — real on chain, seeded in the mock. */
  bountyPool: number;
  jackpotRevealed: boolean;
  bountyTheme: number; // index into THEMES
  view: View;
  sheet: Sheet;
  toasts: Toast[];
  nextToastId: number;
}

// ---------------------------------------------------------------------------
// Derived helpers
// ---------------------------------------------------------------------------

export function wordCase(w: OwnedWord): CaseState {
  const n = w.upper.filter(Boolean).length;
  if (n === 0) return "lowercase";
  if (n === 5) return "UPPERCASE";
  return "Mixed";
}
export function hunger(w: OwnedWord, p = DEFAULT_PARAMS): Hunger {
  if (w.daysUnfed >= p.care.hungryAfterDays) return "hungry";
  if (w.daysUnfed >= p.care.peckishAfterDays) return "peckish";
  return "fed";
}
export function jackpotEligible(w: OwnedWord): boolean {
  return w.staked && hunger(w) !== "hungry";
}

/**
 * The letters the CONNECTED wallet can actually spend (claiming consumes them from msg.sender;
 * rolls check msg.sender's balance). `lower`/`upper` are the DISPLAY union across linked wallets —
 * spending against them would build transactions the contracts are guaranteed to revert.
 */
export const mineLower = (s: GameState): number[] => s.lowerMine ?? s.lower;
export const mineUpper = (s: GameState): number[] => s.upperMine ?? s.upper;

/** Bounty themes — re-exported from the canonical module the keeper also reads (lib/themes). */
import { THEMES } from "@/lib/themes";
export { THEMES };

// ---------------------------------------------------------------------------
// Pricing helpers (USD-pegged → $WORD)
// ---------------------------------------------------------------------------

const P = DEFAULT_PARAMS.prices;
export const COST = {
  daily: Math.round(priceWord(P.dailyMint)),
  pack: Math.round(priceWord(P.pack)),
  roll: Math.round(priceWord(P.roll)),
  claim: Math.round(priceWord(P.claim)),
  snack: Math.round(priceWord(P.snack)),
  prestige: Math.round(priceWord(DEFAULT_PARAMS.prestige.commitFeeUsd)),
};
/** The practice game's ascension fee from `level`: the word ladder's N × base, like Prestige.stageFee. */
export const mockPrestigeFee = (level: number) => COST.prestige * stageFeeMultiple(level);
/** Every priced action. `prestigeSnack` is the snack an ascension burns on top of its fee. */
export type PriceItem = "daily" | "pack" | "roll" | "claim" | "snack" | "prestige" | "prestigeSnack";
export const MOCK_PRICE: Record<PriceItem, number> = { ...COST, prestigeSnack: COST.snack };

/**
 * The contract's price for each item (GameParams.word, whole $WORD). Note the ascension snack is
 * Prestige's own `snackCost`, not Staking's snack price: the two are set, and repegged, separately.
 */
export function chainPrice(word: GameParams["word"], item: PriceItem): number {
  switch (item) {
    case "prestige":
      return word.prestigeFee;
    case "prestigeSnack":
      return word.prestigeSnackCost;
    default:
      return word[item];
  }
}

// Call-time read of the live peg cell: every USD the game shows follows the oracle once
// useWordPrice (mounted in GameApp) has fetched. COST above stays on the import-time fallback by
// design — it's the MOCK store's price table; the chain-backed game prices from chain.params.
export const usdOf = (word: number) => word * currentWordUsd();

/** Compact $WORD formatter: 4_240_000 → "4.24M". */
export function fmtWord(n: number): string {
  const a = Math.abs(n);
  if (a >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return `${Math.round(n)}`;
}
export const fmtUsd = (word: number) => `$${usdOf(word).toFixed(2)}`;
/**
 * Whether $WORD amounts get a dollar figure. Not in the chain game on a testnet: test $WORD has no
 * value, and a dollar figure beside it is what made a tester expect their real $WORD to count. The
 * practice game keeps them (it previews the real prices).
 */
export const showsUsd = (state: Pick<GameState, "chainBacked">) => !(state.chainBacked && NETWORK.isTestnet);

// ---------------------------------------------------------------------------
// Seed (a populated starting save so every screen has life)
// ---------------------------------------------------------------------------

export function seedState(): GameState {
  const lower = new Array(26).fill(0);
  const upper = new Array(26).fill(0);
  // a believable starter bag — heavy on commons, a couple of rares
  for (const c of "AABCDEEGINOLRSTTU") lower[charToIdx(c)]++;
  upper[charToIdx("R")]++; // a stray UPPERCASE from a lucky early roll
  upper[charToIdx("E")]++;

  const mk = (
    word: string,
    upperMask: boolean[],
    staked: boolean,
    daysUnfed: number,
    prestigeLevel = 0,
  ): OwnedWord => ({ word, tier: wordTier(word), upper: upperMask, staked, daysUnfed, prestigeLevel, prestigePity: 0, mine: true });

  const F = false;
  const T = true;
  const words: OwnedWord[] = [
    mk("TEASE", [F, F, F, F, F], true, 0), // lowercase, fed, staked — today's jackpot word
    mk("CRANE", [T, T, T, F, F], true, 1, 0), // mid-upgrade (Mixed), peckish
    mk("VIVID", [T, T, T, T, T], true, 3, 1), // UPPERCASE + prestige L1, but HUNGRY (needs feeding!)
    mk("MOTEL", [F, F, F, F, F], false, 0), // an unstaked spare
  ];

  return {
    balance: 32_000_000, // ≈ $7.5
    lower,
    upper,
    pity: new Array(26).fill(0),
    words,
    wordsEverHeld: words.length,
    streak: 6,
    day: 0,
    dailyMinted: false,
    dailyLetter: null,
    mintCount: 0,
    freeSnackUsed: false,
    jackpotWord: "TEASE", // the player holds it, staked & fed → a winnable reveal
    jackpotPot: 18_500_000,
    bountyPool: 9_400_000,
    jackpotRevealed: false,
    bountyTheme: 1, // "has a repeated letter"
    view: "home",
    sheet: null,
    toasts: [],
    status: "ready" as ChainStatus,
    chainBacked: false,
    nextToastId: 1,
  };
}

// ---------------------------------------------------------------------------
// Actions + reducer (pure — RNG outcomes are precomputed by the provider)
// ---------------------------------------------------------------------------

type Action =
  | { t: "nav"; view: View }
  | { t: "sheet"; sheet: Sheet }
  | { t: "toast"; text: string; tone: Toast["tone"]; ms?: number }
  | { t: "untoast"; id: number }
  | { t: "dailyMint"; idx: number }
  | { t: "pack"; idxs: number[] }
  | { t: "rollLoose"; idx: number; success: boolean }
  | { t: "rollWord"; word: string; pos: number; success: boolean }
  | { t: "claim"; word: string; cases: boolean[] }
  | { t: "stake"; word: string }
  | { t: "feed"; word: string }
  | { t: "feedAll" }
  | { t: "prestige"; word: string; success: boolean }
  | { t: "dissolve"; word: string }
  | { t: "revealJackpot"; won: boolean; amount: number }
  | { t: "skipDay"; jackpotWord: string; bountyTheme: number; at: number }
  | { t: "addDemoBalance" };

function spend(s: GameState, amount: number): number {
  return s.balance - amount;
}

export function reducer(s: GameState, a: Action): GameState {
  switch (a.t) {
    case "nav":
      return { ...s, view: a.view, sheet: null };
    case "sheet":
      return { ...s, sheet: a.sheet };
    case "toast":
      return {
        ...s,
        toasts: [...s.toasts, { id: s.nextToastId, text: a.text, tone: a.tone, ...(a.ms ? { ms: a.ms } : {}) }],
        nextToastId: s.nextToastId + 1,
      };
    case "untoast":
      return { ...s, toasts: s.toasts.filter((t) => t.id !== a.id) };

    case "dailyMint": {
      if (s.dailyMinted) return s; // free, once a day — no $WORD, no affordability gate
      const lower = s.lower.slice();
      lower[a.idx]++;
      return {
        ...s,
        lower,
        dailyMinted: true,
        dailyLetter: a.idx,
        streak: s.streak + 1,
        mintCount: s.mintCount + 1,
      };
    }
    case "pack": {
      if (s.balance < COST.pack) return s;
      const lower = s.lower.slice();
      for (const i of a.idxs) lower[i]++;
      return { ...s, lower, balance: spend(s, COST.pack), mintCount: s.mintCount + 1 };
    }
    case "rollLoose": {
      if (s.balance < COST.roll) return s;
      const lower = s.lower.slice();
      const upper = s.upper.slice();
      const pity = s.pity.slice();
      if (a.success) {
        if (lower[a.idx] > 0) {
          lower[a.idx]--; // never let a loose letter go negative
          upper[a.idx]++;
        }
        pity[a.idx] = 0;
      } else {
        pity[a.idx]++;
      }
      return { ...s, lower, upper, pity, balance: spend(s, COST.roll) };
    }
    case "rollWord": {
      const target = s.words.find((w) => w.word === a.word);
      if (!target || a.pos < 0 || a.pos > 4 || target.upper[a.pos] || s.balance < COST.roll) return s; // only an un-raised slot, if affordable
      // Pity keys on the LETTER being raised (the (owner, letterId) rule), shared with loose rolls.
      const pity = s.pity.slice();
      const words = s.words.map((w) => {
        if (w.word !== a.word) return w;
        const li = charToIdx(w.word[a.pos]);
        const up = w.upper.slice();
        if (a.success) {
          up[a.pos] = true;
          pity[li] = 0;
        } else {
          pity[li]++;
        }
        return { ...w, upper: up };
      });
      return { ...s, words, pity, balance: spend(s, COST.roll) };
    }
    case "claim": {
      const info = a.word;
      // validate fully in the store too (not just the api): real word, not already owned, spellable, affordable
      if (
        !WORD_SET.has(info) ||
        s.words.some((w) => w.word === info) ||
        !canSpellAs(info, a.cases, s.lower, s.upper) ||
        s.balance < COST.claim
      ) {
        return s;
      }
      const tier = wordTier(info);
      // Each letter leaves the bag in the case it was claimed in (any mix, decisions.md #17).
      const lower = s.lower.slice();
      const upper = s.upper.slice();
      [...info].forEach((ch, k) => (a.cases[k] ? upper : lower)[charToIdx(ch)]--);
      const word: OwnedWord = {
        word: info,
        tier,
        upper: [...a.cases],
        staked: true, // auto-stake on claim (UX nicety)
        daysUnfed: 0,
        prestigeLevel: 0,
        prestigePity: 0,
        mine: true,
      };
      return {
        ...s,
        lower,
        upper,
        words: [word, ...s.words],
        wordsEverHeld: Math.max(s.wordsEverHeld || 0, s.words.length) + 1,
        balance: spend(s, COST.claim),
      } as GameState;
    }
    case "stake":
      return {
        ...s,
        words: s.words.map((w) => (w.word === a.word ? { ...w, staked: !w.staked } : w)),
      };
    case "feed": {
      const target = s.words.find((w) => w.word === a.word);
      if (!target || !target.staked || target.daysUnfed === 0) return s; // nothing to feed — don't waste the snack
      const free = !s.freeSnackUsed;
      if (!free && s.balance < COST.snack) return s; // can't afford (the UI gates this too)
      return {
        ...s,
        freeSnackUsed: true,
        balance: free ? s.balance : spend(s, COST.snack),
        words: s.words.map((w) => (w.word === a.word ? { ...w, daysUnfed: 0 } : w)),
      };
    }
    case "feedAll": {
      // Feed the free snack first, then as many paid ones as the balance allows — never go negative.
      let bal = s.balance;
      let free = !s.freeSnackUsed;
      let touched = false;
      const words = s.words.map((w) => {
        if (!w.staked || w.daysUnfed === 0) return w;
        if (free) {
          free = false;
          touched = true;
          return { ...w, daysUnfed: 0 };
        }
        if (bal >= COST.snack) {
          bal -= COST.snack;
          touched = true;
          return { ...w, daysUnfed: 0 };
        }
        return w; // can't afford this one — it stays hungry
      });
      return { ...s, balance: bal, freeSnackUsed: s.freeSnackUsed || touched, words };
    }
    case "prestige": {
      const target = s.words.find((x) => x.word === a.word);
      // only a staked, full-UPPERCASE word below the cap can ascend (matches the sim + UI), if affordable
      if (
        !target ||
        target.prestigeLevel >= PRESTIGE_LEVELS ||
        !target.staked ||
        wordCase(target) !== "UPPERCASE" ||
        s.balance < mockPrestigeFee(target.prestigeLevel) + COST.snack
      ) {
        return s;
      }
      const fee = mockPrestigeFee(target.prestigeLevel);
      const words = s.words.map((w) => {
        if (w.word !== a.word) return w;
        return a.success
          ? { ...w, prestigeLevel: w.prestigeLevel + 1, prestigePity: 0 }
          : { ...w, prestigePity: w.prestigePity + 1 };
      });
      return { ...s, words, balance: spend(s, fee + COST.snack) };
    }
    case "dissolve": {
      const w = s.words.find((x) => x.word === a.word);
      if (!w) return s;
      const lower = s.lower.slice();
      const upper = s.upper.slice();
      [...w.word].forEach((ch, i) => {
        const idx = charToIdx(ch);
        if (w.upper[i]) upper[idx]++;
        else lower[idx]++;
      });
      return { ...s, lower, upper, words: s.words.filter((x) => x.word !== a.word), sheet: null };
    }
    case "addDemoBalance":
      return { ...s, balance: s.balance + 10_000_000 }; // prototype top-up of the mock balance
    case "revealJackpot":
      if (s.jackpotRevealed) return s; // already drawn today — never pay the pot twice
      return {
        ...s,
        jackpotRevealed: true,
        balance: a.won ? s.balance + a.amount : s.balance,
        jackpotPot: a.won ? 0 : s.jackpotPot,
      };
    case "skipDay": {
      // The night's payout, paid at once as the keeper does (decisions.md #16), from the hunger the
      // day ended with.
      const paid = practicePayout(s.words);
      const paidTotal = Object.values(paid).reduce((x, y) => x + y, 0);
      return {
        ...s,
        day: s.day + 1,
        balance: s.balance + paidTotal,
        earned: addPracticeDay(s.earned, a.at, paid),
        dailyMinted: false,
        dailyLetter: null,
        freeSnackUsed: false,
        jackpotWord: a.jackpotWord,
        jackpotRevealed: false,
        // a won pot is already 0 → seed a fresh one; an unwon pot rolls forward + grows
        jackpotPot: s.jackpotPot <= 0 ? 12_000_000 : s.jackpotPot + 6_500_000,
        bountyTheme: a.bountyTheme,
        words: s.words.map((w) => (w.staked ? { ...w, daysUnfed: w.daysUnfed + 1 } : w)),
      };
    }
    default:
      return s;
  }
}

// ---------------------------------------------------------------------------
// Provider + hook
// ---------------------------------------------------------------------------

// The canonical definition (and the logic that produces it) lives in lib/onchain/guardedAction,
// where it is unit-tested. Imported for use below and re-exported so screens can keep importing it
// from the game store.
import type { ActionOutcome } from "@/lib/onchain/guardedAction";
import type { Busy } from "@/lib/onchain/actionGate";
import type { GameParams } from "@/lib/onchain/reads";
import type { PublicFace } from "@/lib/profile/rules";
import { addPracticeDay, practiceEarnings, practicePayout, type PlayerEarnings, type PracticeEarned } from "./earnings";
export type { ActionOutcome };

/** What a move did: sent, or why it didn't send. */
export type MoveOutcome = "sent" | "failed" | "empty" | "open_roll" | "not_linked" | "busy" | "unavailable" | "no_wallet";

export interface GameApi {
  state: GameState;
  nav: (view: View) => void;
  openSheet: (sheet: Sheet) => void;
  closeSheet: () => void;
  toast: (text: string, tone?: Toast["tone"]) => void;
  dismissToast: (id: number) => void;
  // economy actions (return the outcome where the caller needs to animate it)
  canAfford: (amount: number) => boolean;
  /**
   * What an action costs, in whole $WORD, from the store that will actually charge it: the mock's
   * import-time COST table, or the contract's live price on the chain store (it moves with every
   * repeg). Screens must price through this, never COST directly, or the chain game shows a price
   * the contract doesn't charge and gates affordability on it.
   */
  price: (item: PriceItem) => number;
  /**
   * What an ascension attempt from `level` (the word's CURRENT stage) costs, in whole $WORD, before
   * its burned snack: the word ladder charges N × the base fee for a stage-N attempt (Prestige.sol
   * `stageFee`). Same store rule as `price`.
   */
  prestigePrice: (level: number) => number;
  /**
   * Lowercase letters still for sale (chain store: Letters.unreservedSupply). Null = no limit to
   * show: the mock, or a deployment that predates the reservation. Below a pack's 5, packs are
   * sold out; at 0, so is the daily.
   */
  lettersLeft: number | null;
  /**
   * How many stages a word can climb (chain store: Prestige.maxLevel): 5 for Gilded 1–4 and
   * Holographic, ON at launch (decisions.md #19). 0 = ascension is off, and the word sheet hides it
   * rather than offer a button the contract would refuse.
   */
  maxPrestigeLevel: number;
  /**
   * The player's free letters (decisions.md #21: a free pack of 5 and 10 free daily letters per
   * verified profile, from one 30K budget, ending near 95% claimed), from /api/mint/daily-status.
   * Null in the practice game and while unknown: screens then show the offer without counts.
   */
  freeLetters: FreeLetterView | null;
  dailyMint: () => number | null | Promise<ActionOutcome>;
  /**
   * The FREE pack of 5 (chain store: the signer-issued voucher for a verified profile, once). The mock
   * has no vouchers, so there it behaves like `buyPack`.
   */
  openPack: () => number[];
  /**
   * A PAID pack of five. The mock returns the letters at once; the chain store returns a PROMISE of
   * the outcome (approve + commit, then the signed reveal opens the pack sheet itself), so the
   * caller can hold its button until money has either moved or clearly not moved.
   */
  buyPack: () => number[] | Promise<ActionOutcome>;
  /**
   * null = the roll didn't happen (no letter / unaffordable); true = hit, false = miss.
   *
   * The chain store returns a PROMISE of that same value, because a roll is two transactions with a
   * wallet prompt between them. A promise rather than a "pending" sentinel specifically so the
   * caller learns the OUTCOME — including "the user cancelled" — instead of being told it started
   * and left with no way back.
   */
  rollLoose: (idx: number) => boolean | null | Promise<ActionOutcome>;
  rollWord: (word: string, pos: number) => boolean | null | Promise<ActionOutcome>;
  /**
   * Claim `word` with each letter in the case `cases` names (true = UPPERCASE; any mix,
   * decisions.md #17). A quick claim passes `claimCase(word, mineUpper(state))`; the Spell rack
   * passes the tiles the player picked.
   */
  claim: (word: string, cases: boolean[]) => void;
  toggleStake: (word: string) => void;
  feed: (word: string) => void;
  feedAll: () => void;
  /** null = didn't attempt; true = ascended; false = failed. Chain store resolves asynchronously. */
  prestige: (word: string) => boolean | null | Promise<ActionOutcome>;
  dissolve: (word: string) => void;
  /**
   * Move here: send the CONNECTED wallet's letters and held words to `to`, another wallet in its
   * account (lib/onchain/move.ts). The destination is re-checked against the account, fresh.
   */
  moveToWallet: (to: string, opts?: { includeWord?: boolean }) => Promise<MoveOutcome>;
  /** Let `wallet` care for the words the connected wallet stakes (or stop it). Resolves true once sent. */
  setCaretaker: (wallet: string, allowed: boolean) => Promise<boolean>;
  /** A wallet's pity with this browser's fresh reveal notes over the chain read (chain only). */
  pityOf: (wallet: string, chainPity: readonly number[]) => number[];
  /** Read the words again after a failed read (the chain store; the practice store has none to fail). */
  reloadWords?: () => void;
  /** null = no draw happened (already revealed); else the outcome. */
  revealJackpot: () => "win" | "lose" | null;
  skipDay: () => void;
  /** prototype-only: top up the mock $WORD balance for testing. */
  addDemoBalance: () => void;
  /**
   * Unrevealed letter commits for this wallet (chain only; the mock has none). A nonzero count is
   * a PAID pull whose reveal never landed — recoverable forever, identical letters whenever it is
   * finished, and the UI must offer to finish it or the player's letter silently rots on-chain.
   */
  pendingReveals: number;
  /**
   * The action in flight and where it is (preparing, the wallet prompt, the chain), for the status
   * pill. The chain store only: the mock's actions are instant, so it is always null there.
   */
  busy: Busy | null;
  /** Hide the status and release the one-at-a-time gate (a request that never answers). */
  dismissBusy: () => void;
  /** Finish the oldest unrevealed commit: fetch the deterministic draw, send the reveal, open the sheet. */
  openPending: () => void;
  /**
   * What the player's words have earned (earnings.ts): per word, the latest payout, and anything
   * not paid out yet. Null while unknown (loading, or the read failed): never "earned nothing".
   */
  earnings: PlayerEarnings | null;
  /**
   * Shares not paid out yet across the union bag (the keeper's published epochs minus what the
   * chain says is paid). The keeper pays them each morning (decisions.md #16), so this is usually
   * empty. Whole-$WORD amounts for display; the provider holds the raw proofs.
   */
  claimables: { stream: "yield" | "bounty"; tokenId: string; amount: number }[];
  /** Collect every waiting share in one send. Each pays its own wallet, so this is union-safe. */
  claimEarnings: () => void;
  /** The letter-swap board (Seaport orders; chain only — the mock's swap is a share-toy). */
  /** Open letter offers that can fill now; `face` is the maker's profile face, when it has one. */
  swapBoard: { maker: string; giveId: number; wantId: number; orderHash: string; face?: PublicFace }[];
  /** Sign + list a 1⇄1 letter offer (approval batched in when missing). */
  createSwapOffer: (giveId: number, wantId: number) => void;
  fillSwapOffer: (orderHash: string) => void;
  cancelSwapOffer: (orderHash: string) => void;
  /** Words for sale (decisions.md #18; chain only), each with its state read live. */
  wordBoard: WordListing[];
  /**
   * List a word the connected wallet holds, unstaked, for `price` whole $WORD (the buyer pays it;
   * 10% goes to the Rewards Pool). Cancels this wallet's earlier listings of it and approves it to
   * Seaport in one send when needed, then a free signature. Resolves true once listed.
   */
  listWord: (word: string, price: number) => Promise<boolean>;
  buyWord: (orderHash: string) => void;
  cancelWordListing: (orderHash: string) => void;
  // selectors
  spendable: (word: OwnedWord) => boolean;
  rollProb: (pity: number) => number;
  /** The odds of an ascension attempt from `level` with `pity` misses on that word (params.ts). */
  prestigeProb: (level: number, pity: number) => number;
}

const Ctx = createContext<GameApi | null>(null);
/** Exported so ChainGameProvider can supply the same façade with chain-backed state. */
export const GameCtx = Ctx;

export function GameProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, seedState);
  const rng = useRef(new Rng(1930));
  // stable across renders (dispatch is stable) so the Toaster's per-toast timers don't reset
  const dismissToast = useCallback((id: number) => dispatch({ t: "untoast", id }), []);

  const api = useMemo<GameApi>(() => {
    const r = rng.current;
    const drawLetter = () => r.weightedIndex(LETTER_WEIGHTS);
    const toast = (text: string, tone: Toast["tone"] = "info") => dispatch({ t: "toast", text, tone });
    // Every insufficient-balance dead end routes here: open the Buy sheet with what was blocked.
    const needWord = (amount: number, action: string) =>
      dispatch({ t: "sheet", sheet: { kind: "balance", need: { amount, action } } });
    const buyMockPack = () => {
      if (state.balance < COST.pack) {
        needWord(COST.pack, "a pack");
        return [];
      }
      const idxs = Array.from({ length: 5 }, drawLetter);
      dispatch({ t: "pack", idxs });
      return idxs;
    };

    return {
      state,
      nav: (view) => dispatch({ t: "nav", view }),
      openSheet: (sheet) => dispatch({ t: "sheet", sheet }),
      closeSheet: () => dispatch({ t: "sheet", sheet: null }),
      toast,
      dismissToast,
      canAfford: (amount) => state.balance >= amount,
      price: (item) => MOCK_PRICE[item],
      prestigePrice: (level) => mockPrestigeFee(level),
      lettersLeft: null,
      maxPrestigeLevel: PRESTIGE_LEVELS,
      freeLetters: null,

      dailyMint: () => {
        if (state.dailyMinted || state.balance < COST.daily) return null;
        const idx = drawLetter();
        dispatch({ t: "dailyMint", idx });
        toast(`Daily letter: ${idxToChar(idx).toLowerCase()} · streak ${state.streak + 1}`, "good"); // lowercase: capitals mean raised
        return idx;
      },
      openPack: () => buyMockPack(),
      buyPack: () => buyMockPack(),
      rollLoose: (idx) => {
        if (state.lower[idx] <= 0) return null; // no such loose letter to raise
        if (state.balance < COST.roll) {
          needWord(COST.roll, "a roll");
          return null;
        }
        const success = r.chance(rollSuccessProbability(state.pity[idx]));
        dispatch({ t: "rollLoose", idx, success });
        return success;
      },
      rollWord: (word, pos) => {
        const w = state.words.find((x) => x.word === word);
        if (!w || pos < 0 || pos > 4 || w.upper[pos]) return null; // slot already raised / invalid
        if (state.balance < COST.roll) {
          needWord(COST.roll, "a roll");
          return null;
        }
        const li = charToIdx(w.word[pos]); // pity keys on the letter being raised
        const success = r.chance(rollSuccessProbability(state.pity[li]));
        dispatch({ t: "rollWord", word, pos, success });
        return success;
      },
      claim: (word, cases) => {
        if (!WORD_SET.has(word) || state.words.some((w) => w.word === word) || !canSpellAs(word, cases, state.lower, state.upper)) {
          toast("Can’t claim that word", "bad");
          return;
        }
        if (state.balance < COST.claim) {
          needWord(COST.claim, "this claim"); // spellable but broke — a buy moment, not a dead end
          return;
        }
        dispatch({ t: "claim", word, cases });
        dispatch({ t: "sheet", sheet: { kind: "celebrate", word } });
      },
      toggleStake: (word) => dispatch({ t: "stake", word }),
      feed: (word) => {
        if (state.freeSnackUsed && state.balance < COST.snack) {
          needWord(COST.snack, "a snack");
          return;
        }
        dispatch({ t: "feed", word });
      },
      feedAll: () => {
        const hungry = state.words.filter((w) => w.staked && w.daysUnfed > 0);
        if (hungry.length === 0) {
          toast("Everyone’s already fed", "info");
          return;
        }
        const free = state.freeSnackUsed ? 0 : 1;
        const affordable = free + Math.floor(state.balance / COST.snack);
        if (affordable === 0) {
          needWord(COST.snack * hungry.length, "snacks");
          return;
        }
        dispatch({ t: "feedAll" });
        toast(
          affordable >= hungry.length ? "Fed your collection" : `Fed ${affordable} of ${hungry.length}: out of $WORD`,
          affordable >= hungry.length ? "good" : "info",
        );
      },
      prestige: (word) => {
        const w = state.words.find((x) => x.word === word);
        if (!w || w.prestigeLevel >= PRESTIGE_LEVELS || !w.staked || wordCase(w) !== "UPPERCASE") return null;
        const fee = mockPrestigeFee(w.prestigeLevel) + COST.snack;
        if (state.balance < fee) {
          needWord(fee, "an ascension");
          return null;
        }
        const success = r.chance(prestigeSuccessProbability(w.prestigePity, w.prestigeLevel));
        dispatch({ t: "prestige", word, success });
        return success;
      },
      pityOf: (_wallet, chainPity) => [...chainPity],
      setCaretaker: async () => {
        toast("Caretakers work in the onchain game", "info");
        return false;
      },
      moveToWallet: async () => {
        toast("Moving letters works in the onchain game", "info");
        return "unavailable" as const;
      },
      dissolve: (word) => {
        const w = state.words.find((x) => x.word === word);
        dispatch({ t: "dissolve", word });
        if (w) toast(`Dissolved ${w.word}. 5 letters recovered`, "info");
      },
      revealJackpot: () => {
        if (state.jackpotRevealed) return null; // already drawn (the reducer is the real race-guard)
        const owned = state.words.find((w) => w.word === state.jackpotWord);
        const won = !!owned && jackpotEligible(owned);
        dispatch({ t: "revealJackpot", won, amount: state.jackpotPot });
        return won ? "win" : "lose";
      },
      skipDay: () => {
        const jackpotWord = r.pick(WORDS);
        const bountyTheme = r.int(THEMES.length);
        dispatch({ t: "skipDay", jackpotWord, bountyTheme, at: Date.now() });
        toast("A new day dawns", "info");
      },
      addDemoBalance: () => {
        dispatch({ t: "addDemoBalance" });
        toast("Added demo $WORD", "good");
      },

      // The mock reveals in the same tick it commits, so nothing can strand.
      pendingReveals: 0,
      busy: null,
      dismissBusy: () => {},
      openPending: () => {},
      // Practice pays its words when a day passes (skipDay), at once, so nothing ever waits.
      earnings: practiceEarnings(state.earned),
      claimables: [],
      claimEarnings: () => {},
      // The mock's swap is the share-toy above; the real board is chain-only.
      swapBoard: [],
      createSwapOffer: () => {},
      fillSwapOffer: () => {},
      cancelSwapOffer: () => {},
      wordBoard: [],
      listWord: async () => false,
      buyWord: () => {},
      cancelWordListing: () => {},

      spendable: (word) => state.balance >= COST.roll && wordCase(word) !== "UPPERCASE",
      rollProb: (pity) => rollSuccessProbability(pity),
      prestigeProb: (level, pity) => prestigeSuccessProbability(pity, level),
    };
  }, [state, dismissToast]);

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function useGame(): GameApi {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useGame must be used within <GameProvider>");
  return ctx;
}

/**
 * Can this word be spelled from these loose letters, in any mix of cases? A claim names each
 * letter's case (Words.claim's upperMask; decisions.md #17), so a lowercase and an UPPERCASE copy
 * of a letter both count.
 */
export function canSpell(word: string, lower: readonly number[], upper: readonly number[]): boolean {
  const need = new Map<number, number>();
  for (const ch of word) {
    const i = charToIdx(ch);
    need.set(i, (need.get(i) ?? 0) + 1);
  }
  for (const [i, c] of need) if (lower[i] + upper[i] < c) return false;
  return true;
}

/** Can the word be claimed with exactly these cases (true = UPPERCASE), letter by letter? */
export function canSpellAs(word: string, cases: readonly boolean[], lower: readonly number[], upper: readonly number[]): boolean {
  if (cases.length !== word.length) return false;
  const left = { lower: lower.slice(), upper: upper.slice() };
  for (let k = 0; k < word.length; k++) {
    const inv = cases[k] ? left.upper : left.lower;
    const i = charToIdx(word[k]);
    if (inv[i] <= 0) return false;
    inv[i]--;
  }
  return true;
}

/**
 * The case each letter of a quick claim uses: UPPERCASE wherever the player has one to spare,
 * lowercase otherwise (starl3xx, 2026-11-24: "UPPERCASE first"; decisions.md #17). The word starts
 * as close to all-UPPERCASE as the bag allows. The sim claims the same way.
 */
export function claimCase(word: string, upper: readonly number[]): boolean[] {
  const left = upper.slice();
  return [...word].map((ch) => {
    const i = charToIdx(ch);
    if (left[i] <= 0) return false;
    left[i]--;
    return true;
  });
}

/** Words.claim's upperMask: bit k set ⇒ the letter at position k is UPPERCASE. */
export const caseMask = (cases: readonly boolean[]): number => cases.reduce((m, up, k) => (up ? m | (1 << k) : m), 0);

/** Up to `limit` unclaimed dictionary words these loose letters spell, in any mix of cases. */
export function spellableNow(lower: readonly number[], upper: readonly number[], owned: ReadonlySet<string>, limit = 12): string[] {
  const out: string[] = [];
  for (const w of WORDS) {
    if (owned.has(w)) continue;
    if (canSpell(w, lower, upper)) {
      out.push(w);
      if (out.length >= limit) break;
    }
  }
  return out;
}

export { WORD_SET };
