/**
 * Lexigotchi off-chain economy simulation (spec v0.2).
 *
 * Agent-based: a growing population of player archetypes mint (daily single + packs, all
 * lowercase, against real per-letter supply caps), roll lowercase→UPPERCASE with pity,
 * claim dictionary words into escrow, stake, and feed. The four-bucket ledger routes every
 * fee; yield is UPPERCASE-only and hunger-gated; the jackpot pays any staked, non-hungry
 * claim of the day's answer or rolls over. The point is to de-risk SOLVENCY and FUN and to
 * set pricing — not to be a perfect on-chain replica.
 *
 * Determinism: seeded RNG end-to-end, so a (config, seed) pair always yields one economy.
 */
import { WORDS } from "../dictionary";
import {
  ALPHABET,
  LETTER_ODDS,
  supplyCap,
  wordTier,
  TIER_WEIGHT,
  CASE_MULTIPLIER,
  type Tier,
} from "../economy";
import {
  DEFAULT_PARAMS,
  rollSuccessProbability,
  prestigeSuccessProbability,
  type Params,
} from "../params";
import { Rng } from "../rng";
import { Ledger } from "./ledger";
import {
  wordCase,
  type Archetype,
  type ClaimedWord,
  type DayMetrics,
  type Player,
  type SimResult,
} from "./types";

// ---------------------------------------------------------------------------
// Precomputed dictionary structures (built once)
// ---------------------------------------------------------------------------

const A_CODE = 65; // 'A'
const NUM_WORDS = WORDS.length;

interface WordInfo {
  word: string;
  tier: Tier;
  /** [letterIndex, count] pairs (≤5 distinct letters). */
  pairs: Array<[number, number]>;
  rarestIdx: number;
}

const WORD_INFO: WordInfo[] = WORDS.map((word) => {
  const counts: Record<number, number> = {};
  for (const ch of word) {
    const i = ch.charCodeAt(0) - A_CODE;
    counts[i] = (counts[i] ?? 0) + 1;
  }
  const pairs = Object.entries(counts).map(([i, c]) => [Number(i), c] as [number, number]);
  // rarest letter = the one with the fewest dictionary slots (smallest mint odds)
  let rarestIdx = pairs[0][0];
  for (const [i] of pairs) {
    if (LETTER_ODDS[ALPHABET[i]] < LETTER_ODDS[ALPHABET[rarestIdx]]) rarestIdx = i;
  }
  return { word, tier: wordTier(word), pairs, rarestIdx };
});

/** word indices grouped by their rarest letter — prunes claim scans hard. */
const WORDS_BY_RAREST: number[][] = Array.from({ length: 26 }, () => []);
WORD_INFO.forEach((w, idx) => WORDS_BY_RAREST[w.rarestIdx].push(idx));

const LETTER_WEIGHTS = ALPHABET.map((L) => LETTER_ODDS[L]);
const WORD_INDEX = new Map<string, number>(WORDS.map((w, i) => [w, i]));

// scratch for deduped claim scans (avoid per-call Set allocation)
const claimVisited = new Int32Array(NUM_WORDS);
let claimGen = 0;

const TIER_RANK: Record<Tier, number> = {
  Common: 0, Uncommon: 1, Rare: 2, Epic: 3, Legendary: 4,
};

// ---------------------------------------------------------------------------
// Theme bounty — featured categories (sim lever: bounty)
// ---------------------------------------------------------------------------

/**
 * Rotating bounty categories: each is a predicate over the (5-letter, UPPERCASE) dictionary,
 * precomputed once into a Set of matching words (like WORDS_BY_RAREST). The active theme cycles
 * `THEMES[floor(day/periodDays) % THEMES.length]`. Breadth varies deliberately — broad themes reach
 * casuals, narrow ones concentrate — so a multi-period run averages over the mix.
 */
export const THEMES: { name: string; test: (w: string) => boolean }[] = [
  { name: "contains a rare letter (Q/Z/X/J)", test: (w) => /[QZXJ]/.test(w) },
  { name: "has a repeated letter", test: (w) => new Set(w).size < w.length },
  { name: "ends in -ING", test: (w) => w.endsWith("ING") },
  { name: "starts with a vowel", test: (w) => "AEIOU".includes(w[0]) },
  { name: "ends in Y", test: (w) => w.endsWith("Y") },
  {
    name: "Epic or Legendary",
    test: (w) => {
      const t = wordTier(w);
      return t === "Epic" || t === "Legendary";
    },
  },
];
export const THEME_WORDSETS: Set<string>[] = THEMES.map((t) => new Set(WORDS.filter((w) => t.test(w))));
function activeThemeIndex(day: number, periodDays: number): number {
  return Math.floor(day / periodDays) % THEMES.length;
}

// ---------------------------------------------------------------------------
// Archetypes — behavioral policies (tunable)
// ---------------------------------------------------------------------------

interface ArchetypeConfig {
  share: number; // population share
  // USD/day spend appetite (external top-up). The single biggest behavioral assumption —
  // calibrate against real launch data. Conservative defaults for a pre-traction micro-cap.
  dailyBudgetMean: number;
  dailyBudgetSd: number;
  fidProb: number;
  packPropensity: number; // packs purchased per active day (expected)
  rollsPerDay: number; // upgrade rolls attempted per active day
  claimsPerDay: number; // claims attempted per active day
  feedDiscipline: number; // prob of feeding each staked word
  churnPerDay: number;
  wantsUppercase: boolean; // pursues full-UPPERCASE staked words for yield
  grailHunter: boolean; // prefers high-tier claims
}

const ARCHETYPES: Record<Archetype, ArchetypeConfig> = {
  casual: {
    share: 0.5, dailyBudgetMean: 0.4, dailyBudgetSd: 0.25, fidProb: 0.9,
    packPropensity: 0.15, rollsPerDay: 0.2, claimsPerDay: 0.3, feedDiscipline: 0.6,
    churnPerDay: 0.012, wantsUppercase: false, grailHunter: false,
  },
  collector: {
    share: 0.25, dailyBudgetMean: 2.0, dailyBudgetSd: 1.0, fidProb: 0.85,
    packPropensity: 1.2, rollsPerDay: 0.6, claimsPerDay: 1.5, feedDiscipline: 0.85,
    churnPerDay: 0.006, wantsUppercase: false, grailHunter: true,
  },
  gambler: {
    share: 0.12, dailyBudgetMean: 2.5, dailyBudgetSd: 1.3, fidProb: 0.8,
    packPropensity: 0.9, rollsPerDay: 4, claimsPerDay: 0.8, feedDiscipline: 0.8,
    churnPerDay: 0.008, wantsUppercase: true, grailHunter: false,
  },
  staker: {
    share: 0.08, dailyBudgetMean: 2.2, dailyBudgetSd: 1.0, fidProb: 0.9,
    packPropensity: 0.8, rollsPerDay: 2.5, claimsPerDay: 1, feedDiscipline: 0.97,
    churnPerDay: 0.003, wantsUppercase: true, grailHunter: false,
  },
  whale: {
    share: 0.05, dailyBudgetMean: 15, dailyBudgetSd: 8, fidProb: 0.75,
    packPropensity: 4, rollsPerDay: 8, claimsPerDay: 3, feedDiscipline: 0.99,
    churnPerDay: 0.002, wantsUppercase: true, grailHunter: true,
  },
};

export interface SimConfig {
  days: number;
  seed: number;
  /** Target steady-state population (players ramp up to this over `rampDays`). */
  population: number;
  rampDays: number;
  params: Params;
  /** Multiplier on every archetype's daily spend appetite (models population affluence). */
  budgetScale?: number;
}

export const DEFAULT_SIM_CONFIG: SimConfig = {
  days: 270,
  seed: 1930, // rubber-hose era
  population: 800,
  rampDays: 60,
  params: DEFAULT_PARAMS,
  budgetScale: 1,
};

// ---------------------------------------------------------------------------
// World
// ---------------------------------------------------------------------------

class World {
  rng: Rng;
  params: Params;
  budgetScale: number;
  ledger = new Ledger();
  players: Player[] = [];
  /** cumulative lowercase letters minted per letter index (cap enforcement). */
  globalMinted = new Array(26).fill(0);
  caps: number[];
  /** word -> owner player id (unique permanent claims). */
  claims = new Map<string, number>();
  trophies = new Set<string>();
  answerOrder: string[];
  lettersMintedTotal = 0;
  nextPlayerId = 0;
  jackpotWins: { day: number; word: string; amount: number }[] = [];
  /** Gross claims ever made (monotonic; survives dissolution+re-claim) — claim velocity. */
  claimsEver = 0;
  /** Words dissolved cumulatively (names freed back to the claimable pool). */
  dissolutionsTotal = 0;
  /** Letters cleared on the secondary swap market, cumulative. */
  lettersTradedTotal = 0;
  /** Theme-bounty side pool + conservation counters (lever: bounty). NOT a 5th ledger bucket. */
  bountyPool = 0;
  bountyCarvedTotal = 0;
  bountyPaidTotal = 0;
  /** Prestige attempts made on the current day (reset by the day loop). */
  prestigeAttemptsToday = 0;

  constructor(cfg: SimConfig) {
    this.rng = new Rng(cfg.seed);
    this.params = cfg.params;
    this.budgetScale = cfg.budgetScale ?? 1;
    this.caps = ALPHABET.map((L) => supplyCap(L, cfg.params.supply.demandMultiple));
    // Lexigotchi's OWN daily-word sequence (its AnswerChain) — a self-contained jackpot draw,
    // NOT LHAW-sourced. LHAW is a separate ownership-only bonus, not modeled here. (decisions.md)
    this.answerOrder = this.rng.shuffle([...WORDS]);
    // one-time treasury bootstrap of the faucets (decision: bootstrap the jackpot pool)
    this.ledger.pool = cfg.params.seed.pool;
    this.ledger.jackpot = cfg.params.seed.jackpot;
  }

  capRemaining(idx: number): number {
    return this.caps[idx] - this.globalMinted[idx];
  }

  /** Draw one lowercase letter by demand-mirrored odds, skipping capped-out letters. */
  mintLetter(): number | null {
    // mask out letters at cap
    const weights = LETTER_WEIGHTS.map((w, i) => (this.capRemaining(i) > 0 ? w : 0));
    const total = weights.reduce((a, b) => a + b, 0);
    if (total <= 0) return null;
    const idx = this.rng.weightedIndex(weights, total);
    this.globalMinted[idx] += 1;
    this.lettersMintedTotal += 1;
    return idx;
  }

  /** Skim `amount` from the Rewards Pool into the bounty pool (zero-sum vs yield, lever: bounty). */
  carveToBounty(amount: number): void {
    const moved = this.ledger.carveFromPool(amount);
    this.bountyPool += moved;
    this.bountyCarvedTotal += moved;
  }

  /** Pay `amount` from the bounty pool; caps at the balance, never negative (mirrors payFromPool). */
  payFromBountyPool(amount: number): number {
    const paid = Math.min(amount, this.bountyPool);
    this.bountyPool -= paid;
    this.bountyPaidTotal += paid;
    return paid;
  }
}

// ---------------------------------------------------------------------------
// Player helpers
// ---------------------------------------------------------------------------

function gaussian(rng: Rng, mean: number, sd: number): number {
  // Box–Muller
  const u = Math.max(1e-9, rng.next());
  const v = rng.next();
  return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function makePlayer(world: World, archetype: Archetype, day: number): Player {
  const cfg = ARCHETYPES[archetype];
  return {
    id: world.nextPlayerId++,
    archetype,
    hasFID: world.rng.chance(cfg.fidProb),
    active: true,
    balance: 0,
    lower: new Array(26).fill(0),
    upper: new Array(26).fill(0),
    words: new Map(),
    pity: new Array(26).fill(0),
    mintedDailyToday: false,
    freeSnackUsedToday: false,
    spent: 0,
    earned: 0,
    tradeEarned: 0,
    yieldEarned: 0,
    bountyEarned: 0,
    lastActiveDay: day,
    joinedDay: day,
  };
}

/** Can the player spell this word from a single-case inventory (lower or upper)? */
function canSpell(info: WordInfo, inv: number[]): boolean {
  for (const [idx, cnt] of info.pairs) if (inv[idx] < cnt) return false;
  return true;
}

/**
 * Find an unclaimed word the player can spell from 5 UNIFORM-case letters — all-lowercase
 * (the common path) OR all-UPPERCASE (built from loose rolls). v0.2 §5.4 allows either, as
 * long as the set is uniform; Mixed sets cannot initiate a claim.
 */
function findClaimable(
  player: Player,
  world: World,
  grail: boolean,
  preferSet?: Set<string>,
): { word: string; upper: boolean } | null {
  claimGen++;
  let best: { word: string; upper: boolean; tier: number } | null = null;
  let firstAny: { word: string; upper: boolean } | null = null; // fallback when chasing a theme
  let checked = 0;
  for (let li = 0; li < 26; li++) {
    if (player.lower[li] === 0 && player.upper[li] === 0) continue;
    for (const widx of WORDS_BY_RAREST[li]) {
      if (claimVisited[widx] === claimGen) continue;
      claimVisited[widx] = claimGen;
      const info = WORD_INFO[widx];
      if (world.claims.has(info.word)) continue;
      // prefer a lowercase claim; fall back to an all-uppercase one
      const upper: boolean | null = canSpell(info, player.lower)
        ? false
        : canSpell(info, player.upper)
          ? true
          : null;
      if (upper === null) continue;
      // theme chase (lever: bounty): a matching claimable word wins immediately, over tier/first
      if (preferSet && preferSet.has(info.word)) return { word: info.word, upper };
      if (!grail) {
        if (!preferSet) return { word: info.word, upper }; // first match (original behavior)
        if (!firstAny) firstAny = { word: info.word, upper }; // remember, keep scanning for a theme hit
        if (++checked > 64) return firstAny; // bound the extra theme scan
        continue;
      }
      const tr = TIER_RANK[info.tier];
      if (!best || tr > best.tier) best = { word: info.word, upper, tier: tr };
      if (++checked > 64) break; // bound grail search
    }
    if (!grail && best) break;
  }
  if (best) return { word: best.word, upper: best.upper };
  return firstAny;
}

function escrowClaim(player: Player, word: string, upper: boolean): void {
  const info = WORD_INFO[WORD_INDEX.get(word)!];
  const inv = upper ? player.upper : player.lower; // debit the inventory the claim used
  for (const [idx, cnt] of info.pairs) inv[idx] -= cnt;
  player.words.set(word, {
    word,
    tier: info.tier,
    upper: [upper, upper, upper, upper, upper], // case derived from escrow contents (v0.2 §2)
    staked: false,
    daysUnfed: 0,
    fedToday: false,
    prestigeLevel: 0,
    prestigePity: 0,
  });
}

type RollTarget =
  | { kind: "escrow"; word: string; pos: number; letterIdx: number }
  | { kind: "loose"; letterIdx: number };

/** The most promising claimed-word escrow position to push toward UPPERCASE (yield). */
function escrowRollTarget(player: Player): RollTarget | null {
  let bestWord: ClaimedWord | null = null;
  for (const w of player.words.values()) {
    if (wordCase(w) === "UPPERCASE") continue;
    // prefer staked words, then the most-progressed (fewest lowercase remaining)
    if (!bestWord) bestWord = w;
    else {
      const score = (x: ClaimedWord) => (x.staked ? 100 : 0) + x.upper.filter(Boolean).length;
      if (score(w) > score(bestWord)) bestWord = w;
    }
  }
  if (!bestWord) return null;
  for (let pos = 0; pos < 5; pos++) {
    if (!bestWord.upper[pos]) {
      const letterIdx = bestWord.word.charCodeAt(pos) - A_CODE;
      return { kind: "escrow", word: bestWord.word, pos, letterIdx };
    }
  }
  return null;
}

/** Any loose lowercase letter to roll (the gamble, no yield intent). */
function looseRollTarget(player: Player): RollTarget | null {
  for (let li = 0; li < 26; li++) {
    if (player.lower[li] > 0) return { kind: "loose", letterIdx: li };
  }
  return null;
}

/**
 * Pick what to roll. `wantsUppercase` archetypes grind their claimed words toward full
 * UPPERCASE (chasing the yield upgrade); others spend the same rolls on loose letters (the
 * gamble) and don't pursue word completion. Roll *volume* (and fee revenue) is identical
 * either way — the flag only steers which letters get upgraded.
 */
function chooseRollTarget(player: Player, wantsUppercase: boolean): RollTarget | null {
  return wantsUppercase
    ? (escrowRollTarget(player) ?? looseRollTarget(player))
    : (looseRollTarget(player) ?? escrowRollTarget(player));
}

/**
 * The staked, full-UPPERCASE word most in need of ascension (lowest prestige level first, so a
 * player advances their maxed words evenly — the conservative, less-concentrating choice). Returns
 * null when prestige is disabled, so the roll loop is byte-identical at baseline. (Lever: prestige.)
 */
function prestigeTarget(player: Player, p: Params): ClaimedWord | null {
  if (!p.prestige.enabled) return null;
  let best: ClaimedWord | null = null;
  for (const w of player.words.values()) {
    if (!w.staked) continue;
    if (wordCase(w) !== "UPPERCASE") continue;
    if (w.prestigeLevel >= p.prestige.levels) continue;
    if (!best || w.prestigeLevel < best.prestigeLevel) best = w;
  }
  return best;
}

/** Stake-yield multiplier from a word's prestige level — `mult^level`, = 1 at level 0 (identity
 *  when prestige is disabled, since the level never leaves 0, so yield weight is unchanged). */
function prestigeYieldMult(w: ClaimedWord, p: Params): number {
  return p.prestige.yieldMultPerLevel ** w.prestigeLevel;
}

/** Bounty-weight multiplier from a word's prestige level — `mult^level`, = 1 at level 0. */
function prestigeBountyMult(w: ClaimedWord, p: Params): number {
  return p.prestige.bountyMultPerLevel ** w.prestigeLevel;
}

/**
 * A staked word's pro-rata bounty weight: rarity (`tier ^ rarityWeight`) × prestige multiplier.
 * `rarityWeight = 0` is flat (every matching word equal — max casual reach); `= 1` is
 * tier-proportional (rewards rare matching words, like yield treats tier). See params.bounty.
 */
function bountyWeight(w: ClaimedWord, p: Params): number {
  return TIER_WEIGHT[w.tier] ** p.bounty.rarityWeight * prestigeBountyMult(w, p);
}

// ---------------------------------------------------------------------------
// Dissolution + secondary letter clearing (sim levers, off by default)
// ---------------------------------------------------------------------------

/**
 * The lowercase letters a player most needs to complete its NEAREST unclaimed word — the
 * unclaimed word it already holds the most letters toward. Returns the missing letter indices
 * (with multiplicity), capped at `max`. Bounded scan (mirrors findClaimable's pruning), and
 * only meaningful for players who can't already spell anything (callers pre-check that).
 */
function findNearest(player: Player, world: World, max: number): number[] | null {
  if (max <= 0) return null;
  claimGen++;
  let best: { missing: number[]; have: number } | null = null;
  let checked = 0;
  outer: for (let li = 0; li < 26; li++) {
    if (player.lower[li] === 0) continue;
    for (const widx of WORDS_BY_RAREST[li]) {
      if (claimVisited[widx] === claimGen) continue;
      claimVisited[widx] = claimGen;
      const info = WORD_INFO[widx];
      if (world.claims.has(info.word)) continue;
      let have = 0;
      const missing: number[] = [];
      for (const [idx, cnt] of info.pairs) {
        const h = Math.min(player.lower[idx], cnt);
        have += h;
        for (let k = h; k < cnt; k++) missing.push(idx);
      }
      if (missing.length === 0) continue; // already spellable — not a bidder's target
      if (!best || have > best.have) best = { missing, have };
      if (++checked > 64) break outer;
    }
  }
  if (!best) return null;
  return best.missing.slice(0, max);
}

/**
 * Dissolution — a VOLUNTARY redeploy act, not a consequence of neglect. Only *active* players who
 * chase better/UPPERCASE words (`wantsUppercase || grailHunter`) recycle a "dead" claim: a staked,
 * still-all-lowercase (never upgraded), low-tier word whose letters are worth more redeployed
 * than the word is worth held. Burning it returns the 5 letters to loose inventory and frees
 * the name back to the claimable pool (trophy persists in the registry — immaterial here).
 *
 * The day's `answer` is passed in and never dissolved: nobody recycles a live jackpot ticket,
 * and since dissolution runs before jackpot resolution, dissolving it would void a legit win.
 *
 * NOTE the limitation: dissolution's headline benefit is BEHAVIORAL — it de-risks claiming
 * (you'll claim more boldly knowing you can exit) and enables gifting/re-claim drama. This
 * greedy-claim agent model claims regardless of risk, so it can only show the *mechanical*
 * churn (letters freed → re-claimed), never the de-risking. Read the dissolution columns as
 * "what the exit does mechanically," not as a verdict on the feature.
 */
function runDissolution(world: World, answer: string): void {
  const p = world.params;
  for (const pl of world.players) {
    if (!pl.active) continue; // voluntary act — churned players don't recycle (matches runClearing)
    const cfg = ARCHETYPES[pl.archetype];
    if (!cfg.wantsUppercase && !cfg.grailHunter) continue; // pure holders don't recycle
    for (const [word, w] of [...pl.words]) {
      if (word === answer) continue; // never recycle the day's live answer ticket (Bugbot #3)
      if (!w.staked) continue;
      if (wordCase(w) !== "lowercase") continue; // a word they're upgrading isn't "dead"
      if (TIER_RANK[w.tier] > p.dissolution.maxTierRank) continue;
      if (!world.rng.chance(p.dissolution.dailyProb)) continue;
      for (let pos = 0; pos < 5; pos++) {
        const idx = word.charCodeAt(pos) - A_CODE;
        if (w.upper[pos]) pl.upper[idx] += 1;
        else pl.lower[idx] += 1;
      }
      pl.words.delete(word);
      world.claims.delete(word); // name back to the claimable pool
      world.dissolutionsTotal += 1;
    }
  }
}

/** Largest-remainder apportionment of `total` integer units across `weights` (each fill ≤ its
 *  weight). Used to settle a letter market pro-rata while keeping the integer total exact.
 *  PRECONDITION: total ≤ sum(weights). The caller guarantees it (matched = min(askTotal, bidTotal)
 *  ≤ each total); if violated, the remainder loop can't place all of `total` and the result sums
 *  short — caller must not rely on apportion to clamp an oversized total. */
function apportion(weights: number[], total: number): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum <= 0 || total <= 0) return weights.map(() => 0);
  const raw = weights.map((w) => (w / sum) * total);
  const fill = raw.map((r) => Math.floor(r));
  let assigned = fill.reduce((a, b) => a + b, 0);
  const order = raw
    .map((r, i) => ({ i, frac: r - Math.floor(r) }))
    .sort((a, b) => b.frac - a.frac);
  for (const { i } of order) {
    if (assigned >= total) break;
    if (fill[i] < weights[i]) {
      fill[i] += 1;
      assigned += 1;
    }
  }
  return fill;
}

/**
 * Secondary letter clearing — the "swap primitive" lever. Once per day:
 *   asks  = a fraction of every active player's surplus (held-beyond-one) lowercase letters
 *   bids  = the letters each BLOCKED claimer needs toward its nearest unclaimed word
 *           (bids capped by what the buyer can afford at the floor, so no balance goes negative)
 * Each letter index clears at the floor; matched = min(asks, bids), apportioned pro-rata.
 * Buyers pay the floor (recorded as spend, letter added to inventory → faster claims);
 * sellers receive floor×(1−royalty) (recorded as recoup); the royalty routes per splits.royalty
 * (now Treasury). Player-to-player $WORD only — solvency is untouched (just the royalty leak).
 */
function runClearing(world: World): { letters: number; volumeUsd: number } {
  const p = world.params;
  const floorUsd = (p.prices.pack / 5) * p.trading.floorFraction;
  if (floorUsd <= 0) return { letters: 0, volumeUsd: 0 };

  const sellers: { pl: Player; qty: number }[][] = Array.from({ length: 26 }, () => []);
  const buyers: { pl: Player; qty: number }[][] = Array.from({ length: 26 }, () => []);
  const askTotal = new Array(26).fill(0);
  const bidTotal = new Array(26).fill(0);

  for (const pl of world.players) {
    if (!pl.active) continue;
    for (let li = 0; li < 26; li++) {
      const surplus = Math.floor(p.trading.listSurplusFraction * Math.max(0, pl.lower[li] - 1));
      if (surplus > 0) {
        sellers[li].push({ pl, qty: surplus });
        askTotal[li] += surplus;
      }
    }
    const cfg = ARCHETYPES[pl.archetype];
    if (cfg.claimsPerDay <= 0) continue;
    if (findClaimable(pl, world, false)) continue; // not blocked — already has a claim to make
    const afford = Math.floor(pl.balance / floorUsd);
    const want = findNearest(pl, world, Math.min(p.trading.maxBidLetters, afford));
    if (!want) continue;
    const per = new Map<number, number>();
    for (const idx of want) per.set(idx, (per.get(idx) ?? 0) + 1);
    for (const [idx, qty] of per) {
      buyers[idx].push({ pl, qty });
      bidTotal[idx] += qty;
    }
  }

  const royaltyRate = p.market.royaltyRate;
  let letters = 0;
  let volumeUsd = 0;
  for (let li = 0; li < 26; li++) {
    const matched = Math.min(askTotal[li], bidTotal[li]);
    if (matched <= 0) continue;
    const buyFill = apportion(buyers[li].map((b) => b.qty), matched);
    const sellFill = apportion(sellers[li].map((s) => s.qty), matched);
    for (let i = 0; i < buyers[li].length; i++) {
      const f = buyFill[i];
      if (f <= 0) continue;
      const b = buyers[li][i];
      const cost = f * floorUsd;
      b.pl.balance -= cost;
      b.pl.spent += cost;
      b.pl.lower[li] += f;
    }
    for (let i = 0; i < sellers[li].length; i++) {
      const f = sellFill[i];
      if (f <= 0) continue;
      const s = sellers[li][i];
      const proceeds = f * floorUsd * (1 - royaltyRate);
      s.pl.balance += proceeds;
      s.pl.earned += proceeds;
      s.pl.tradeEarned += proceeds;
      s.pl.lower[li] -= f;
    }
    letters += matched;
    volumeUsd += matched * floorUsd;
  }
  const royaltyUsd = volumeUsd * royaltyRate;
  if (royaltyUsd > 0) world.ledger.route(royaltyUsd, p.splits.royalty);
  world.lettersTradedTotal += letters;
  return { letters, volumeUsd };
}

// ---------------------------------------------------------------------------
// The day loop
// ---------------------------------------------------------------------------

function playerTurn(player: Player, world: World, day: number): void {
  const cfg = ARCHETYPES[player.archetype];
  const p = world.params;
  const rng = world.rng;

  // Demand-bounded external inflow: the player intends to deploy `dayBudget` today. They
  // recycle existing balance (prior yield/jackpot winnings) FIRST, and only buy the
  // shortfall in $WORD from the DEX. So external inflow reflects real spend demand, not
  // hoarding, and winners' earnings genuinely reduce fresh capital entering the economy.
  // Top up toward today's intended budget, recycling any accumulated balance (winnings /
  // savings) first — so external inflow self-limits once a player is flush, and a small
  // daily budget naturally accumulates across days into the occasional bigger purchase.
  const scale = world.budgetScale;
  const dayBudget = Math.max(0, gaussian(rng, cfg.dailyBudgetMean * scale, cfg.dailyBudgetSd * scale));
  const external = Math.max(0, dayBudget - player.balance);
  player.balance += external;
  world.ledger.recordExternalInflow(external);

  const canSpend = (amount: number) => player.balance >= amount;
  const spend = (amount: number) => {
    player.balance -= amount;
    player.spent += amount;
  };

  // 1) Daily single mint (FID-gated habit loop)
  if (player.hasFID && !player.mintedDailyToday && canSpend(p.prices.dailyMint)) {
    const idx = world.mintLetter();
    if (idx !== null) {
      player.lower[idx] += 1;
      spend(p.prices.dailyMint);
      world.ledger.route(p.prices.dailyMint, p.splits.dailyMint);
      player.mintedDailyToday = true;
    }
  }

  // 2) Claims (assemble owned letters into a permanent word). When a bounty is live, a claimer
  //    steers toward a theme-matching word with prob `chaseProbability` (the demand channel). The
  //    `bountyOn && rng.chance(...)` short-circuits, so a disabled bounty makes ZERO extra draws.
  const bountyOn = p.bounty.enabled;
  const themeSet = bountyOn ? THEME_WORDSETS[activeThemeIndex(day, p.bounty.periodDays)] : null;
  let claims = poisson(rng, cfg.claimsPerDay);
  while (claims-- > 0 && canSpend(p.prices.claim)) {
    const prefer = bountyOn && rng.chance(p.bounty.chaseProbability) ? themeSet! : undefined;
    const found = findClaimable(player, world, cfg.grailHunter, prefer);
    if (!found) break;
    spend(p.prices.claim);
    world.ledger.route(p.prices.claim, p.splits.claim);
    escrowClaim(player, found.word, found.upper);
    world.claims.set(found.word, player.id);
    world.claimsEver += 1;
  }

  // 3) Stake any unstaked claimed words (free, instant)
  for (const w of player.words.values()) if (!w.staked) w.staked = true;

  // 4) Feed staked words AFTER staking, so a word claimed + auto-staked this same turn can
  //    eat too. A word eats `snacksPerWordPerDay` snacks/day; the check-in covers one feeding.
  //    We only MARK who got fed here — the daysUnfed advance happens in the post-turn hunger
  //    tick, so churned owners' words also get hungry.
  const snackCost = p.prices.snack * p.care.snacksPerWordPerDay;
  for (const w of player.words.values()) {
    if (!w.staked) continue;
    if (p.care.freeDailySnack && !player.freeSnackUsedToday) {
      player.freeSnackUsedToday = true;
      w.fedToday = true;
    } else if (rng.chance(cfg.feedDiscipline) && canSpend(snackCost)) {
      spend(snackCost);
      world.ledger.route(snackCost, p.splits.snack); // 100% burn
      w.fedToday = true;
    }
  }

  // 5) Upgrade rolls toward UPPERCASE (the core sink)
  let rolls = poisson(rng, cfg.rollsPerDay);
  while (rolls-- > 0 && canSpend(p.prices.roll)) {
    // Prestige (lever) takes priority once an upgrade-chaser has a maxed full-UPPERCASE staked word,
    // REUSING this roll budget (conservative: no new assumed spend — post-completion these rolls
    // would otherwise hit a null target). Disabled ⇒ prestigeTarget is null ⇒ branch skipped ⇒ the
    // roll loop is byte-identical to baseline (no extra RNG draw).
    const pTarget = cfg.wantsUppercase || cfg.grailHunter ? prestigeTarget(player, p) : null;
    if (pTarget && canSpend(p.prestige.commitFeeUsd)) {
      spend(p.prestige.commitFeeUsd);
      world.ledger.route(p.prestige.commitFeeUsd, p.splits.prestige ?? p.splits.roll);
      const prestigeSnack = p.prices.snack * p.prestige.snacksPerAttempt;
      if (canSpend(prestigeSnack)) {
        spend(prestigeSnack);
        world.ledger.route(prestigeSnack, p.splits.snack); // 100% burn
      }
      if (rng.chance(prestigeSuccessProbability(pTarget.prestigePity, p))) {
        pTarget.prestigeLevel += 1; // success: ascend (monotonic) + reset pity
        pTarget.prestigePity = 0;
      } else {
        pTarget.prestigePity += 1; // fail: explicit no-op — level/case/letters untouched
      }
      world.prestigeAttemptsToday += 1;
      continue;
    }
    const target = chooseRollTarget(player, cfg.wantsUppercase);
    if (!target) break;
    spend(p.prices.roll);
    world.ledger.route(p.prices.roll, p.splits.roll);
    const success = rng.chance(rollSuccessProbability(player.pity[target.letterIdx], p));
    if (success) {
      player.pity[target.letterIdx] = 0;
      if (target.kind === "escrow") {
        const w = player.words.get(target.word)!;
        w.upper[target.pos] = true;
      } else {
        player.lower[target.letterIdx] -= 1;
        player.upper[target.letterIdx] += 1;
      }
    } else {
      player.pity[target.letterIdx] += 1;
    }
  }

  // 6) Pack mints (acquire letters to spell + roll)
  let packs = poisson(rng, cfg.packPropensity);
  while (packs-- > 0 && canSpend(p.prices.pack)) {
    let minted = 0;
    for (let i = 0; i < 5; i++) {
      const idx = world.mintLetter();
      if (idx === null) break; // global supply exhausted mid-pack (only at the very end)
      player.lower[idx] += 1;
      minted++;
    }
    if (minted === 0) break;
    // Charge pro-rata for letters actually received — a partial pack near mint-out must not
    // bill for 5 (which would overstate revenue exactly in the finite-mint-sink window).
    const cost = p.prices.pack * (minted / 5);
    spend(cost);
    world.ledger.route(cost, p.splits.packMint);
  }

  player.lastActiveDay = day;
}

/** Small Poisson sampler (Knuth) for "expected N actions" with natural variance. */
function poisson(rng: Rng, lambda: number): number {
  if (lambda <= 0) return 0;
  const L = Math.exp(-lambda);
  let k = 0;
  let prod = 1;
  do {
    k++;
    prod *= rng.next();
  } while (prod > L);
  return k - 1;
}

function effectiveMissed(w: ClaimedWord): number {
  return w.daysUnfed; // already updated during feeding step
}

function hungerYieldFactor(w: ClaimedWord, p: Params): number {
  const missed = effectiveMissed(w);
  if (missed >= p.care.hungryAfterDays) return 0;
  if (missed >= p.care.peckishAfterDays) return p.care.peckishYieldFactor;
  return 1;
}

/**
 * Conservation guard: letters are only ever MINTED — claiming escrows them, dissolution
 * returns them, trading moves them between players, but none of those create or destroy a
 * letter. So (all loose letters) + 5×(words currently held) must always equal lettersMinted.
 * Run only when a lever is on (it's the new code that could break this); throws if violated.
 */
function assertLettersConserved(world: World): void {
  let loose = 0;
  for (const pl of world.players) {
    for (let i = 0; i < 26; i++) loose += pl.lower[i] + pl.upper[i];
  }
  const total = loose + world.claims.size * 5;
  if (total !== world.lettersMintedTotal) {
    throw new Error(`Letter conservation violated: held ${total} vs minted ${world.lettersMintedTotal}`);
  }
}

/**
 * Bounty conservation (lever: bounty): every $WORD skimmed into the bounty pool is either still in
 * it or has been paid to a winner — `carved == paid + pool`. Run only when the lever is on; throws
 * on any leak (cent-exact, mirroring assertLettersConserved / the ledger's solvency assert).
 */
function assertBountyConserved(world: World): void {
  const diff = Math.abs(world.bountyCarvedTotal - (world.bountyPaidTotal + world.bountyPool));
  if (diff > 1e-6) {
    throw new Error(
      `Bounty conservation violated: carved ${world.bountyCarvedTotal} vs paid+pool ` +
        `${world.bountyPaidTotal + world.bountyPool}`,
    );
  }
}

function isJackpotEligible(w: ClaimedWord, p: Params): boolean {
  if (!w.staked) return false;
  if (p.jackpot.eligibilityRequiresNotHungry && effectiveMissed(w) >= p.care.hungryAfterDays) {
    return false;
  }
  return true;
}

export function runSim(cfg: SimConfig = DEFAULT_SIM_CONFIG): SimResult {
  const world = new World(cfg);
  const archetypeList = buildArchetypeRoster(cfg.population);
  const days: DayMetrics[] = [];

  for (let day = 0; day < cfg.days; day++) {
    world.ledger.beginDay();
    world.prestigeAttemptsToday = 0;

    // onboarding ramp: add a slice of the roster each day until exhausted
    const targetCount = Math.min(
      archetypeList.length,
      Math.ceil(((day + 1) / cfg.rampDays) * archetypeList.length),
    );
    while (world.players.length < targetCount) {
      world.players.push(makePlayer(world, archetypeList[world.players.length], day));
    }

    // reset per-day flags
    for (const pl of world.players) {
      pl.mintedDailyToday = false;
      pl.freeSnackUsedToday = false;
    }

    // churn
    for (const pl of world.players) {
      if (pl.active && world.rng.chance(ARCHETYPES[pl.archetype].churnPerDay)) pl.active = false;
    }

    // player turns (shuffled order for fair claim races)
    const order = world.rng.shuffle(world.players.filter((pl) => pl.active).map((pl) => pl.id));
    const byId = new Map(world.players.map((pl) => [pl.id, pl]));
    for (const id of order) playerTurn(byId.get(id)!, world, day);

    // ---- hunger tick: advance daysUnfed for EVERY staked word, active owner or churned ----
    // Churned owners skip playerTurn, so without this their words would stay frozen-as-fed and
    // keep full yield weight + jackpot eligibility forever. v0.2 care must still apply to them.
    for (const pl of world.players) {
      for (const w of pl.words.values()) {
        if (!w.staked) continue;
        w.daysUnfed = w.fedToday ? 0 : w.daysUnfed + 1;
        w.fedToday = false;
      }
    }

    // ---- dissolution: voluntary recycle of dead low-tier claims, freeing the name ----
    // Compute the day's answer up front and EXCLUDE it from dissolution: a rational owner never
    // recycles the live lottery ticket, and since dissolution runs before jackpot resolution
    // below, dissolving it here would wrongly void a legitimate same-day jackpot (Bugbot #3).
    const answer = world.answerOrder[day % world.answerOrder.length];
    if (world.params.dissolution.enabled) runDissolution(world, answer);

    // ---- secondary letter clearing (the swap-primitive lever) ----
    // When trading is modeled, the secondary royalty comes from REAL cleared volume and the
    // macro proxy below is turned OFF, so the experiment isolates the modeled-trading effect.
    let tradeLetters = 0;
    let tradeVolumeUsd = 0;
    if (world.params.trading.enabled) {
      const t = runClearing(world);
      tradeLetters = t.letters;
      tradeVolumeUsd = t.volumeUsd;
    } else {
      // ---- secondary-market royalty → Treasury (splits.royalty), MACRO PROXY ----
      // Daily secondary GMV ≈ a fraction of the day's primary fee GMV; its 2.5% royalty routes
      // per splits.royalty (now Treasury). Stand-in until per-letter resale is modeled (`trading`).
      const secondaryVolume = world.ledger.grossRoutedToday * world.params.market.secondaryVolumeRatio;
      const royalty = secondaryVolume * world.params.market.royaltyRate;
      if (royalty > 0) world.ledger.route(royalty, world.params.splits.royalty);
    }

    // ---- bounty carve (lever: bounty) ---- skim a fraction of TODAY's pool inflow into the
    // bounty side pool BEFORE yield distributes, so the day's yield reflects the post-carve pool
    // (the carve competes with yield — a zero-sum redistribution from passive staking to the goal).
    if (world.params.bounty.enabled) {
      world.carveToBounty(world.ledger.poolInflowToday * world.params.bounty.carveFraction);
    }

    // ---- daily yield distribution (v0.2 §1.5): honor the configured yield gate ----
    // yieldRequiresUppercase=true (the v0.2 decision) restricts yield to full-UPPERCASE
    // words at tier weight; =false models the v0.1 scheme where any staked word earns at
    // tier × case multiplier. Reading the flag makes it a real lever, not decoration.
    const requireUpper = world.params.staking.yieldRequiresUppercase;
    let totalWeight = 0;
    const eligible: { w: ClaimedWord; owner: Player; weight: number }[] = [];
    for (const pl of world.players) {
      for (const w of pl.words.values()) {
        if (!w.staked) continue;
        const wc = wordCase(w);
        if (requireUpper && wc !== "UPPERCASE") continue;
        const factor = hungerYieldFactor(w, world.params);
        if (factor === 0) continue;
        // prestigeYieldMult is 1 at level 0 (so this is identity when prestige is disabled — the
        // level never leaves 0), and takes a bigger slice of the SAME pot when ascended (solvency-neutral).
        const weight =
          TIER_WEIGHT[w.tier] *
          (requireUpper ? 1 : CASE_MULTIPLIER[wc]) *
          factor *
          prestigeYieldMult(w, world.params);
        totalWeight += weight;
        eligible.push({ w, owner: pl, weight });
      }
    }
    let distributed = 0;
    if (totalWeight > 0) {
      const pot = world.ledger.pool * world.params.staking.dailyDistributionRate;
      for (const e of eligible) {
        const share = pot * (e.weight / totalWeight);
        const paid = world.ledger.payFromPool(share);
        e.owner.balance += paid;
        e.owner.earned += paid;
        e.owner.yieldEarned += paid; // isolated for the yield-concentration check
        distributed += paid;
      }
    }

    // ---- bounty resolution (lever: bounty) ---- on the period's LAST day, pay the accrued bounty
    // pool pro-rata to every owner holding a staked + not-hungry word in the period's theme set,
    // weighted by prestige. Runs AFTER the hunger tick (daysUnfed is final) and after the carve.
    // Non-end days: the pool just accrues. An unsatisfied period simply rolls forward.
    let bountyPaid = 0;
    let bountyEligible = 0;
    if (world.params.bounty.enabled) {
      const bp = world.params.bounty;
      const isPeriodEnd = day % bp.periodDays === bp.periodDays - 1;
      if (isPeriodEnd && world.bountyPool > 1e-9) {
        const themeSet = THEME_WORDSETS[activeThemeIndex(day, bp.periodDays)];
        const winners: { owner: Player; weight: number }[] = [];
        let totalW = 0;
        for (const pl of world.players) {
          for (const w of pl.words.values()) {
            if (!w.staked) continue;
            if (!themeSet.has(w.word)) continue;
            if (bp.requiresNotHungry && effectiveMissed(w) >= world.params.care.hungryAfterDays) continue;
            const weight = bountyWeight(w, world.params);
            winners.push({ owner: pl, weight });
            totalW += weight;
          }
        }
        bountyEligible = winners.length;
        if (totalW > 0) {
          const pot = world.bountyPool; // pro-rata over the accrued pool (shares sum to the pot)
          for (const wn of winners) {
            const paid = world.payFromBountyPool(pot * (wn.weight / totalW));
            wn.owner.balance += paid;
            wn.owner.earned += paid;
            wn.owner.bountyEarned += paid;
            bountyPaid += paid;
          }
        }
      }
    }

    // ---- jackpot resolution ---- (answer computed above, before dissolution)
    world.trophies.add(answer);
    let jackpotPaid = 0;
    let rolledOver = true;
    const ownerId = world.claims.get(answer);
    if (ownerId !== undefined) {
      const owner = world.players.find((pl) => pl.id === ownerId)!;
      const w = owner.words.get(answer)!;
      if (isJackpotEligible(w, world.params)) {
        jackpotPaid = world.ledger.payJackpot();
        owner.balance += jackpotPaid;
        owner.earned += jackpotPaid;
        rolledOver = false;
        world.jackpotWins.push({ day, word: answer, amount: jackpotPaid });
      }
    }

    world.ledger.assertSolvent();
    if (world.params.trading.enabled || world.params.dissolution.enabled) assertLettersConserved(world);
    if (world.params.bounty.enabled) assertBountyConserved(world);
    days.push(
      snapshot(world, day, distributed, jackpotPaid, rolledOver, tradeLetters, tradeVolumeUsd, bountyPaid, bountyEligible),
    );
  }

  return summarize(world, days, cfg);
}

function buildArchetypeRoster(population: number): Archetype[] {
  const entries = Object.entries(ARCHETYPES) as [Archetype, ArchetypeConfig][];
  // Largest-remainder apportionment so the roster is EXACTLY `population` (per-archetype
  // rounding would otherwise drift, and onboarding caps players at roster.length).
  const counts = entries.map(([arch, cfg]) => {
    const raw = population * cfg.share;
    return { arch, n: Math.floor(raw), frac: raw - Math.floor(raw) };
  });
  let assigned = counts.reduce((a, c) => a + c.n, 0);
  counts.sort((a, b) => b.frac - a.frac);
  for (let i = 0; assigned < population; i++, assigned++) counts[i % counts.length].n++;
  const roster: Archetype[] = [];
  for (const c of counts) for (let i = 0; i < c.n; i++) roster.push(c.arch);
  return roster;
}

function snapshot(
  world: World,
  day: number,
  distributed: number,
  jackpotPaid: number,
  rolledOver: boolean,
  tradeLetters: number,
  tradeVolumeUsd: number,
  bountyPaid: number,
  bountyEligible: number,
): DayMetrics {
  let staked = 0;
  let uppercase = 0;
  let yieldEligible = 0;
  let prestigeLevelsTotal = 0;
  const claimers = new Set<number>();
  for (const pl of world.players) {
    for (const w of pl.words.values()) {
      claimers.add(pl.id);
      if (w.staked) staked++;
      prestigeLevelsTotal += w.prestigeLevel;
      if (wordCase(w) === "UPPERCASE") {
        uppercase++;
        if (w.staked && hungerYieldFactor(w, world.params) > 0) yieldEligible++;
      }
    }
  }
  const capConsumption: Record<string, number> = {};
  for (let i = 0; i < 26; i++) capConsumption[ALPHABET[i]] = world.globalMinted[i] / world.caps[i];

  return {
    day,
    pool: world.ledger.pool,
    jackpot: world.ledger.jackpot,
    burnedTotal: world.ledger.burnedTotal,
    treasuryTotal: world.ledger.treasuryTotal,
    externalInflowTotal: world.ledger.externalInflowTotal,
    poolInflowToday: world.ledger.poolInflowToday,
    poolOutflowToday: world.ledger.poolOutflowToday,
    jackpotPaidToday: jackpotPaid,
    jackpotRolledOver: rolledOver,
    distributionToday: distributed,
    totalClaims: world.claims.size,
    uniqueClaimers: claimers.size,
    stakedWords: staked,
    uppercaseWords: uppercase,
    yieldEligibleWords: yieldEligible,
    activePlayers: world.players.filter((pl) => pl.active).length,
    lettersMintedTotal: world.lettersMintedTotal,
    capConsumption,
    claimsEverTotal: world.claimsEver,
    dissolutionsTotal: world.dissolutionsTotal,
    lettersTradedToday: tradeLetters,
    lettersTradedTotal: world.lettersTradedTotal,
    tradeVolumeUsdToday: tradeVolumeUsd,
    grossRoutedToday: world.ledger.grossRoutedToday,
    bountyPool: world.bountyPool,
    bountyCarvedTotal: world.bountyCarvedTotal,
    bountyPaidTotal: world.bountyPaidTotal,
    bountyPaidToday: bountyPaid,
    bountyEligibleWords: bountyEligible,
    prestigeLevelsTotal,
    prestigeAttemptsToday: world.prestigeAttemptsToday,
  };
}

function summarize(world: World, days: DayMetrics[], cfg: SimConfig): SimResult {
  const final = days[days.length - 1];
  // per-archetype ROI
  const roiMap = new Map<
    Archetype,
    { spent: number; earned: number; recoup: number; yieldEarned: number; bountyEarned: number; claims: number; players: number }
  >();
  for (const pl of world.players) {
    const cur =
      roiMap.get(pl.archetype) ??
      { spent: 0, earned: 0, recoup: 0, yieldEarned: 0, bountyEarned: 0, claims: 0, players: 0 };
    cur.spent += pl.spent;
    cur.earned += pl.earned;
    cur.recoup += pl.tradeEarned;
    cur.yieldEarned += pl.yieldEarned;
    cur.bountyEarned += pl.bountyEarned;
    cur.claims += pl.words.size;
    cur.players += 1;
    roiMap.set(pl.archetype, cur);
  }
  const playerRoi = [...roiMap.entries()].map(([archetype, v]) => ({
    archetype,
    spent: v.spent,
    earned: v.earned,
    recoup: v.recoup,
    yieldEarned: v.yieldEarned,
    bountyEarned: v.bountyEarned,
    net: v.earned - v.spent,
    claims: v.claims,
    players: v.players,
  }));

  // pool equilibrium estimate: trailing-window mean pool inflow / daily distribution rate
  const window = days.slice(Math.max(0, days.length - 30));
  const meanInflow = window.reduce((a, d) => a + d.poolInflowToday, 0) / window.length;
  const poolEquilibrium = meanInflow / world.params.staking.dailyDistributionRate;

  const notes: string[] = [];

  // pool trend over the trailing 30 days tells the story the level alone hides
  const prev = days[Math.max(0, days.length - 31)]?.pool ?? final.pool;
  const trend = final.pool > prev * 1.02 ? "rising" : final.pool < prev * 0.98 ? "falling" : "flat";
  notes.push(
    `Rewards Pool is ${trend} (${Math.round(prev).toLocaleString()} → ${Math.round(final.pool).toLocaleString()} ` +
      `over last 30d); trailing inflow implies equilibrium ~${Math.round(poolEquilibrium).toLocaleString()} $WORD.`,
  );

  // the finite-sink dynamic: when does the one-time mint/claim revenue run out?
  const mintOutDay = days.findIndex((d) => Object.values(d.capConsumption).every((c) => c >= 0.999));
  const completeDay = days.findIndex((d) => d.totalClaims >= NUM_WORDS);
  if (mintOutDay >= 0) {
    notes.push(
      `Letters MINTED OUT on day ${mintOutDay + 1} — after this the mint sink is dead; the economy ` +
        `runs only on the recurring sinks (rolls + snacks). Watch the pool/jackpot inflow past this point.`,
    );
  } else {
    notes.push(`Letters not fully minted out in ${cfg.days} days (tightest letter at ${Math.round(Object.values(final.capConsumption).reduce((a, b) => Math.max(a, b), 0) * 100)}% of cap).`);
  }
  if (completeDay >= 0) {
    notes.push(`Whole dictionary claimed by day ${completeDay + 1} — collection race "completes"; long arc shifts to yield + jackpot + secondary + showcase.`);
  }

  const rollovers = days.filter((d) => d.jackpotRolledOver).length;
  const biggest = Math.round(Math.max(0, ...world.jackpotWins.map((w) => w.amount)));
  notes.push(
    `Jackpot rolled over ${rollovers}/${days.length} days (${Math.round((rollovers / days.length) * 100)}%); ` +
      `${world.jackpotWins.length} wins, biggest ${biggest.toLocaleString()} $WORD. ` +
      `Escalation is an EARLY-game effect — once most words are held, the answer is almost always claimed, so it pays ~daily.`,
  );

  if (cfg.params.trading.enabled || cfg.params.dissolution.enabled) {
    // identity: currently-held (final.totalClaims) === gross claims − dissolutions
    notes.push(
      `Levers on — trading:${cfg.params.trading.enabled} dissolution:${cfg.params.dissolution.enabled}. ` +
        `${final.lettersTradedTotal.toLocaleString()} letters cleared on the swap market; ` +
        `${world.claimsEver.toLocaleString()} gross claims ` +
        `(${final.dissolutionsTotal.toLocaleString()} dissolved → ${final.totalClaims.toLocaleString()} held now).`,
    );
  }

  if (cfg.params.prestige.enabled || cfg.params.bounty.enabled) {
    // durable-sink-revival check: total fee throughput AFTER mint-out (baseline decays to ~snacks)
    const past = mintOutDay >= 0 ? days.slice(mintOutDay) : [];
    const grossPast = past.reduce((a, d) => a + d.grossRoutedToday, 0);
    notes.push(
      `Late-game loop on — prestige:${cfg.params.prestige.enabled} bounty:${cfg.params.bounty.enabled}. ` +
        `${final.prestigeLevelsTotal.toLocaleString()} prestige levels held; ` +
        `bounty pool ${Math.round(final.bountyPool).toLocaleString()} $WORD, ` +
        `${Math.round(world.bountyPaidTotal).toLocaleString()} paid out. ` +
        (mintOutDay >= 0
          ? `Post-mint-out fee throughput ${Math.round(grossPast).toLocaleString()} $WORD over ${past.length}d ` +
            `(the durable-sink-revival signal — compare vs baseline).`
          : `Letters not minted out in window — read the pre-completion deltas.`),
    );
  }

  return {
    days,
    final,
    playerRoi,
    notes,
    poolEquilibrium,
    jackpotWins: world.jackpotWins,
  };
}
