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
  id: number;
  word: string; // UPPERCASE dictionary key
  tier: Tier;
  /** per-position case of the 5 escrowed letters (true = uppercase). */
  upper: boolean[];
  staked: boolean;
  daysUnfed: number;
  prestigeLevel: number;
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

export type RollTarget = { kind: "loose"; idx: number } | { kind: "word"; id: number; pos: number };

export type Sheet =
  | { kind: "word"; id: number }
  | { kind: "pack"; letters: number[] }
  | { kind: "roll"; target: RollTarget }
  | null;

export interface Toast {
  id: number;
  text: string;
  tone: "good" | "bad" | "info";
}

export interface GameState {
  balance: number; // $WORD
  lower: number[]; // [26] counts
  upper: number[]; // [26] counts
  pity: number[]; // [26] loose-letter pity streak
  words: OwnedWord[];
  streak: number;
  day: number;
  dailyMinted: boolean;
  freeSnackUsed: boolean;
  jackpotWord: string;
  jackpotPot: number;
  jackpotRevealed: boolean;
  bountyTheme: number; // index into THEMES
  view: View;
  sheet: Sheet;
  toasts: Toast[];
  nextWordId: number;
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

function seedState(): GameState {
  const lower = new Array(26).fill(0);
  const upper = new Array(26).fill(0);
  // a believable starter bag — heavy on commons, a couple of rares
  for (const c of "AABCDEEGINOLRSTTU") lower[charToIdx(c)]++;
  upper[charToIdx("R")]++; // a stray UPPERCASE from a lucky early roll
  upper[charToIdx("E")]++;

  const mk = (
    id: number,
    word: string,
    upperMask: boolean[],
    staked: boolean,
    daysUnfed: number,
    prestigeLevel = 0,
  ): OwnedWord => ({ id, word, tier: wordTier(word), upper: upperMask, staked, daysUnfed, prestigeLevel });

  const F = false;
  const T = true;
  const words: OwnedWord[] = [
    mk(1, "TEASE", [F, F, F, F, F], true, 0), // lowercase, fed, staked — today's jackpot word
    mk(2, "CRANE", [T, T, T, F, F], true, 1, 0), // mid-upgrade (Mixed), peckish
    mk(3, "VIVID", [T, T, T, T, T], true, 3, 1), // UPPERCASE + prestige L1, but HUNGRY (needs feeding!)
    mk(4, "MOTEL", [F, F, F, F, F], false, 0), // an unstaked spare
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
    freeSnackUsed: false,
    jackpotWord: "TEASE", // the player holds it, staked & fed → a winnable reveal
    jackpotPot: 18_500_000,
    jackpotRevealed: false,
    bountyTheme: 1, // "has a repeated letter"
    view: "home",
    sheet: null,
    toasts: [],
    nextWordId: 5,
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
  | { t: "rollWord"; id: number; pos: number; success: boolean }
  | { t: "claim"; word: string; useUpper: boolean }
  | { t: "stake"; id: number }
  | { t: "feed"; id: number }
  | { t: "feedAll" }
  | { t: "prestige"; id: number; success: boolean }
  | { t: "dissolve"; id: number }
  | { t: "revealJackpot"; won: boolean; amount: number }
  | { t: "skipDay"; jackpotWord: string; bountyTheme: number };

function spend(s: GameState, amount: number): number {
  return s.balance - amount;
}

function reducer(s: GameState, a: Action): GameState {
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
      const lower = s.lower.slice();
      lower[a.idx]++;
      return {
        ...s,
        lower,
        balance: spend(s, COST.daily),
        dailyMinted: true,
        streak: s.streak + 1,
      };
    }
    case "pack": {
      const lower = s.lower.slice();
      for (const i of a.idxs) lower[i]++;
      return { ...s, lower, balance: spend(s, COST.pack) };
    }
    case "rollLoose": {
      const lower = s.lower.slice();
      const upper = s.upper.slice();
      const pity = s.pity.slice();
      if (a.success) {
        lower[a.idx]--;
        upper[a.idx]++;
        pity[a.idx] = 0;
      } else {
        pity[a.idx]++;
      }
      return { ...s, lower, upper, pity, balance: spend(s, COST.roll) };
    }
    case "rollWord": {
      const words = s.words.map((w) => {
        if (w.id !== a.id) return w;
        const up = w.upper.slice();
        if (a.success) up[a.pos] = true;
        return { ...w, upper: up };
      });
      return { ...s, words, balance: spend(s, COST.roll) };
    }
    case "claim": {
      const info = a.word;
      const tier = wordTier(info);
      const src = a.useUpper ? s.upper.slice() : s.lower.slice();
      for (const ch of info) src[charToIdx(ch)]--;
      const word: OwnedWord = {
        id: s.nextWordId,
        word: info,
        tier,
        upper: [a.useUpper, a.useUpper, a.useUpper, a.useUpper, a.useUpper],
        staked: true, // auto-stake on claim (UX nicety)
        daysUnfed: 0,
        prestigeLevel: 0,
      };
      return {
        ...s,
        [a.useUpper ? "upper" : "lower"]: src,
        words: [word, ...s.words],
        balance: spend(s, COST.claim),
        nextWordId: s.nextWordId + 1,
      } as GameState;
    }
    case "stake":
      return {
        ...s,
        words: s.words.map((w) => (w.id === a.id ? { ...w, staked: !w.staked } : w)),
      };
    case "feed": {
      const usedFree = !s.freeSnackUsed;
      return {
        ...s,
        freeSnackUsed: true,
        balance: usedFree ? s.balance : spend(s, COST.snack),
        words: s.words.map((w) => (w.id === a.id ? { ...w, daysUnfed: 0 } : w)),
      };
    }
    case "feedAll": {
      const hungryStaked = s.words.filter((w) => w.staked && w.daysUnfed > 0);
      const freeApplies = !s.freeSnackUsed && hungryStaked.length > 0;
      const paidCount = Math.max(0, hungryStaked.length - (freeApplies ? 1 : 0));
      return {
        ...s,
        freeSnackUsed: s.freeSnackUsed || hungryStaked.length > 0,
        balance: spend(s, paidCount * COST.snack),
        words: s.words.map((w) => (w.staked ? { ...w, daysUnfed: 0 } : w)),
      };
    }
    case "prestige": {
      const words = s.words.map((w) => {
        if (w.id !== a.id) return w;
        return a.success ? { ...w, prestigeLevel: w.prestigeLevel + 1 } : w;
      });
      return { ...s, words, balance: spend(s, COST.prestige + COST.snack) };
    }
    case "dissolve": {
      const w = s.words.find((x) => x.id === a.id);
      if (!w) return s;
      const lower = s.lower.slice();
      const upper = s.upper.slice();
      [...w.word].forEach((ch, i) => {
        const idx = charToIdx(ch);
        if (w.upper[i]) upper[idx]++;
        else lower[idx]++;
      });
      return { ...s, lower, upper, words: s.words.filter((x) => x.id !== a.id), sheet: null };
    }
    case "revealJackpot":
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
        jackpotPot: s.jackpotRevealed ? 12_000_000 : s.jackpotPot + 6_500_000,
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
  rollLoose: (idx: number) => boolean;
  rollWord: (id: number, pos: number) => boolean;
  claim: (word: string, useUpper: boolean) => void;
  toggleStake: (id: number) => void;
  feed: (id: number) => void;
  feedAll: () => void;
  prestige: (id: number) => boolean;
  dissolve: (id: number) => void;
  revealJackpot: () => boolean;
  skipDay: () => void;
  // selectors
  spendable: (word: OwnedWord) => boolean;
  rollProb: (pity: number) => number;
}

const Ctx = createContext<GameApi | null>(null);

export function GameProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, seedState);
  const rng = useRef(new Rng(1930));

  const api = useMemo<GameApi>(() => {
    const r = rng.current;
    const drawLetter = () => r.weightedIndex(LETTER_WEIGHTS);
    const toast = (text: string, tone: Toast["tone"] = "info") => dispatch({ t: "toast", text, tone });

    return {
      state,
      nav: (view) => dispatch({ t: "nav", view }),
      openSheet: (sheet) => dispatch({ t: "sheet", sheet }),
      closeSheet: () => dispatch({ t: "sheet", sheet: null }),
      toast,
      dismissToast: (id) => dispatch({ t: "untoast", id }),
      canAfford: (amount) => state.balance >= amount,

      dailyMint: () => {
        if (state.dailyMinted || state.balance < COST.daily) return null;
        const idx = drawLetter();
        dispatch({ t: "dailyMint", idx });
        toast(`Daily letter: ${idxToChar(idx)} · streak ${state.streak + 1} 🔥`, "good");
        return idx;
      },
      openPack: () => {
        if (state.balance < COST.pack) {
          toast("Not enough $WORD for a pack", "bad");
          return [];
        }
        const idxs = Array.from({ length: 5 }, drawLetter);
        dispatch({ t: "pack", idxs });
        return idxs;
      },
      rollLoose: (idx) => {
        const success = r.chance(rollSuccessProbability(state.pity[idx]));
        dispatch({ t: "rollLoose", idx, success });
        return success;
      },
      rollWord: (id, pos) => {
        const success = r.chance(rollSuccessProbability(0));
        dispatch({ t: "rollWord", id, pos, success });
        return success;
      },
      claim: (word, useUpper) => {
        dispatch({ t: "claim", word, useUpper });
        toast(`Claimed ${word} — it's yours forever ✦`, "good");
      },
      toggleStake: (id) => dispatch({ t: "stake", id }),
      feed: (id) => dispatch({ t: "feed", id }),
      feedAll: () => {
        dispatch({ t: "feedAll" });
        toast("Fed your collection 🍪", "good");
      },
      prestige: (id) => {
        const w = state.words.find((x) => x.id === id);
        const success = r.chance(prestigeSuccessProbability(w?.prestigeLevel ?? 0));
        dispatch({ t: "prestige", id, success });
        return success;
      },
      dissolve: (id) => {
        const w = state.words.find((x) => x.id === id);
        dispatch({ t: "dissolve", id });
        if (w) toast(`Dissolved ${w.word} — 5 letters recovered`, "info");
      },
      revealJackpot: () => {
        const owned = state.words.find((w) => w.word === state.jackpotWord);
        const won = !!owned && jackpotEligible(owned);
        dispatch({ t: "revealJackpot", won, amount: state.jackpotPot });
        return won;
      },
      skipDay: () => {
        const jackpotWord = r.pick(WORDS);
        const bountyTheme = r.int(THEMES.length);
        dispatch({ t: "skipDay", jackpotWord, bountyTheme });
        toast("A new day dawns ☀️", "info");
      },

      spendable: (word) => state.balance >= COST.roll && wordCase(word) !== "UPPERCASE",
      rollProb: (pity) => rollSuccessProbability(pity),
    };
  }, [state]);

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
