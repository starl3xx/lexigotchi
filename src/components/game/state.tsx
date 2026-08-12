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
import {
  DEFAULT_PARAMS,
  WORD_USD_PRICE,
  priceWord,
  rollSuccessProbability,
  prestigeSuccessProbability,
} from "@/lib/params";
import { Rng } from "@/lib/rng";

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
  prestigeLevel: number;
  /** Consecutive failed ascension attempts on this word (the prestige pity streak). */
  prestigePity: number;
}

export type View =
  | "home"
  | "bag"
  | "mint"
  | "claim"
  | "jackpot"
  | "bounty"
  | "lexidex"
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
  | { kind: "faq" }
  | { kind: "addapp" }
  | null;

export interface Toast {
  id: number;
  text: string;
  tone: "good" | "bad" | "info";
}

/** Whether chain-derived state is actually known. See ChainGate — "loading" is not "zero". */
export type ChainStatus = "no-wallet" | "loading" | "ready" | "error";

export interface GameState {
  /** The mock always knows its own state; the chain provider drives this for real. */
  status: ChainStatus;
  /** Human-readable cause when status is "error". */
  error?: string;
  balance: number; // $WORD
  lower: number[]; // [26] counts
  upper: number[]; // [26] counts
  pity: number[]; // [26] loose-letter pity streak
  words: OwnedWord[];
  streak: number;
  day: number;
  dailyMinted: boolean;
  /** Daily/pack mints made this session — drives the one-time "add the mini app" nudge. */
  mintCount: number;
  freeSnackUsed: boolean;
  jackpotWord: string;
  jackpotPot: number;
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

/** Bounty theme catalogue — mirrors src/lib/sim/simulate.ts THEMES. */
export const THEMES: { name: string; short: string; test: (w: string) => boolean }[] = [
  { name: "Contains a rare letter (Q / Z / X / J)", short: "rare letters", test: (w) => /[QZXJ]/.test(w) },
  { name: "Has a repeated letter", short: "double letters", test: (w) => new Set(w).size < w.length },
  { name: "Ends in -ING", short: "-ING", test: (w) => w.endsWith("ING") },
  { name: "Starts with a vowel", short: "vowel-start", test: (w) => "AEIOU".includes(w[0]) },
  { name: "Ends in Y", short: "-Y", test: (w) => w.endsWith("Y") },
];

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
export const usdOf = (word: number) => word * WORD_USD_PRICE;

/** Compact $WORD formatter: 4_240_000 → "4.24M". */
export function fmtWord(n: number): string {
  const a = Math.abs(n);
  if (a >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return `${Math.round(n)}`;
}
export const fmtUsd = (word: number) => `$${usdOf(word).toFixed(2)}`;

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
  ): OwnedWord => ({ word, tier: wordTier(word), upper: upperMask, staked, daysUnfed, prestigeLevel, prestigePity: 0 });

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
    streak: 6,
    day: 0,
    dailyMinted: false,
    mintCount: 0,
    freeSnackUsed: false,
    jackpotWord: "TEASE", // the player holds it, staked & fed → a winnable reveal
    jackpotPot: 18_500_000,
    jackpotRevealed: false,
    bountyTheme: 1, // "has a repeated letter"
    view: "home",
    sheet: null,
    toasts: [],
    status: "ready" as ChainStatus,
    nextToastId: 1,
  };
}

// ---------------------------------------------------------------------------
// Actions + reducer (pure — RNG outcomes are precomputed by the provider)
// ---------------------------------------------------------------------------

type Action =
  | { t: "nav"; view: View }
  | { t: "sheet"; sheet: Sheet }
  | { t: "toast"; text: string; tone: Toast["tone"] }
  | { t: "untoast"; id: number }
  | { t: "dailyMint"; idx: number }
  | { t: "pack"; idxs: number[] }
  | { t: "rollLoose"; idx: number; success: boolean }
  | { t: "rollWord"; word: string; pos: number; success: boolean }
  | { t: "claim"; word: string; useUpper: boolean }
  | { t: "stake"; word: string }
  | { t: "feed"; word: string }
  | { t: "feedAll" }
  | { t: "prestige"; word: string; success: boolean }
  | { t: "dissolve"; word: string }
  | { t: "revealJackpot"; won: boolean; amount: number }
  | { t: "skipDay"; jackpotWord: string; bountyTheme: number }
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
        toasts: [...s.toasts, { id: s.nextToastId, text: a.text, tone: a.tone }],
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
        !canSpell(info, a.useUpper ? s.upper : s.lower) ||
        s.balance < COST.claim
      ) {
        return s;
      }
      const tier = wordTier(info);
      const src = a.useUpper ? s.upper.slice() : s.lower.slice();
      for (const ch of info) src[charToIdx(ch)]--;
      const word: OwnedWord = {
        word: info,
        tier,
        upper: [a.useUpper, a.useUpper, a.useUpper, a.useUpper, a.useUpper],
        staked: true, // auto-stake on claim (UX nicety)
        daysUnfed: 0,
        prestigeLevel: 0,
        prestigePity: 0,
      };
      return {
        ...s,
        [a.useUpper ? "upper" : "lower"]: src,
        words: [word, ...s.words],
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
        s.balance < COST.prestige + COST.snack
      ) {
        return s;
      }
      const words = s.words.map((w) => {
        if (w.word !== a.word) return w;
        return a.success
          ? { ...w, prestigeLevel: w.prestigeLevel + 1, prestigePity: 0 }
          : { ...w, prestigePity: w.prestigePity + 1 };
      });
      return { ...s, words, balance: spend(s, COST.prestige + COST.snack) };
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
    case "skipDay":
      return {
        ...s,
        day: s.day + 1,
        dailyMinted: false,
        freeSnackUsed: false,
        jackpotWord: a.jackpotWord,
        jackpotRevealed: false,
        // a won pot is already 0 → seed a fresh one; an unwon pot rolls forward + grows
        jackpotPot: s.jackpotPot <= 0 ? 12_000_000 : s.jackpotPot + 6_500_000,
        bountyTheme: a.bountyTheme,
        words: s.words.map((w) => (w.staked ? { ...w, daysUnfed: w.daysUnfed + 1 } : w)),
      };
    default:
      return s;
  }
}

// ---------------------------------------------------------------------------
// Provider + hook
// ---------------------------------------------------------------------------

export interface GameApi {
  state: GameState;
  nav: (view: View) => void;
  openSheet: (sheet: Sheet) => void;
  closeSheet: () => void;
  toast: (text: string, tone?: Toast["tone"]) => void;
  dismissToast: (id: number) => void;
  // economy actions (return the outcome where the caller needs to animate it)
  canAfford: (amount: number) => boolean;
  dailyMint: () => number | null;
  openPack: () => number[];
  /** null = the roll didn't happen (no letter / unaffordable); true = hit, false = miss. */
  rollLoose: (idx: number) => boolean | null;
  rollWord: (word: string, pos: number) => boolean | null;
  claim: (word: string, useUpper: boolean) => void;
  toggleStake: (word: string) => void;
  feed: (word: string) => void;
  feedAll: () => void;
  /** null = the attempt didn't happen (ineligible / unaffordable); true = ascended, false = failed. */
  prestige: (word: string) => boolean | null;
  dissolve: (word: string) => void;
  /** null = no draw happened (already revealed); else the outcome. */
  revealJackpot: () => "win" | "lose" | null;
  skipDay: () => void;
  /** prototype-only: top up the mock $WORD balance for testing. */
  addDemoBalance: () => void;
  // selectors
  spendable: (word: OwnedWord) => boolean;
  rollProb: (pity: number) => number;
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

    return {
      state,
      nav: (view) => dispatch({ t: "nav", view }),
      openSheet: (sheet) => dispatch({ t: "sheet", sheet }),
      closeSheet: () => dispatch({ t: "sheet", sheet: null }),
      toast,
      dismissToast,
      canAfford: (amount) => state.balance >= amount,

      dailyMint: () => {
        if (state.dailyMinted || state.balance < COST.daily) return null;
        const idx = drawLetter();
        dispatch({ t: "dailyMint", idx });
        toast(`Daily letter: ${idxToChar(idx)} · streak ${state.streak + 1}`, "good");
        return idx;
      },
      openPack: () => {
        if (state.balance < COST.pack) {
          needWord(COST.pack, "a pack");
          return [];
        }
        const idxs = Array.from({ length: 5 }, drawLetter);
        dispatch({ t: "pack", idxs });
        return idxs;
      },
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
      claim: (word, useUpper) => {
        const inv = useUpper ? state.upper : state.lower;
        if (!WORD_SET.has(word) || state.words.some((w) => w.word === word) || !canSpell(word, inv)) {
          toast("Can't claim that word", "bad");
          return;
        }
        if (state.balance < COST.claim) {
          needWord(COST.claim, "this claim"); // spellable but broke — a buy moment, not a dead end
          return;
        }
        dispatch({ t: "claim", word, useUpper });
        toast(`Claimed ${word} — it's yours forever`, "good");
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
          toast("Everyone's already fed", "info");
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
          affordable >= hungry.length ? "Fed your collection" : `Fed ${affordable} of ${hungry.length} — out of $WORD`,
          affordable >= hungry.length ? "good" : "info",
        );
      },
      prestige: (word) => {
        const w = state.words.find((x) => x.word === word);
        if (!w || w.prestigeLevel >= PRESTIGE_LEVELS || !w.staked || wordCase(w) !== "UPPERCASE") return null;
        if (state.balance < COST.prestige + COST.snack) {
          needWord(COST.prestige + COST.snack, "an ascension");
          return null;
        }
        const success = r.chance(prestigeSuccessProbability(w.prestigePity));
        dispatch({ t: "prestige", word, success });
        return success;
      },
      dissolve: (word) => {
        const w = state.words.find((x) => x.word === word);
        dispatch({ t: "dissolve", word });
        if (w) toast(`Dissolved ${w.word} — 5 letters recovered`, "info");
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
        dispatch({ t: "skipDay", jackpotWord, bountyTheme });
        toast("A new day dawns", "info");
      },
      addDemoBalance: () => {
        dispatch({ t: "addDemoBalance" });
        toast("Added demo $WORD", "good");
      },

      spendable: (word) => state.balance >= COST.roll && wordCase(word) !== "UPPERCASE",
      rollProb: (pity) => rollSuccessProbability(pity),
    };
  }, [state, dismissToast]);

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function useGame(): GameApi {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useGame must be used within <GameProvider>");
  return ctx;
}

/** Convenience: is this word spellable from a single-case inventory? */
export function canSpell(word: string, inv: number[]): boolean {
  const need: Record<number, number> = {};
  for (const ch of word) {
    const i = charToIdx(ch);
    need[i] = (need[i] ?? 0) + 1;
  }
  return Object.entries(need).every(([i, c]) => inv[Number(i)] >= c);
}

/** Up to `limit` unclaimed dictionary words spellable from a single-case inventory. */
export function spellableNow(inv: number[], owned: Set<string>, limit = 12): string[] {
  const out: string[] = [];
  for (const w of WORDS) {
    if (owned.has(w)) continue;
    if (canSpell(w, inv)) {
      out.push(w);
      if (out.length >= limit) break;
    }
  }
  return out;
}

export { WORD_SET };
