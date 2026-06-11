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
import { ALPHABET, LETTER_ODDS, supplyCap, wordTier, TIER_WEIGHT, type Tier } from "../economy";
import { DEFAULT_PARAMS, rollSuccessProbability, type Params } from "../params";
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

// ---------------------------------------------------------------------------
// Archetypes — behavioral policies (tunable)
// ---------------------------------------------------------------------------

interface ArchetypeConfig {
  share: number; // population share
  dailyBudgetMean: number; // $WORD external top-up per active day
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
    share: 0.5, dailyBudgetMean: 80, dailyBudgetSd: 40, fidProb: 0.9,
    packPropensity: 0.15, rollsPerDay: 0.2, claimsPerDay: 0.3, feedDiscipline: 0.6,
    churnPerDay: 0.012, wantsUppercase: false, grailHunter: false,
  },
  collector: {
    share: 0.25, dailyBudgetMean: 300, dailyBudgetSd: 120, fidProb: 0.85,
    packPropensity: 1.2, rollsPerDay: 0.6, claimsPerDay: 1.5, feedDiscipline: 0.85,
    churnPerDay: 0.006, wantsUppercase: false, grailHunter: true,
  },
  gambler: {
    share: 0.12, dailyBudgetMean: 400, dailyBudgetSd: 200, fidProb: 0.8,
    packPropensity: 0.9, rollsPerDay: 4, claimsPerDay: 0.8, feedDiscipline: 0.8,
    churnPerDay: 0.008, wantsUppercase: true, grailHunter: false,
  },
  staker: {
    share: 0.08, dailyBudgetMean: 350, dailyBudgetSd: 150, fidProb: 0.9,
    packPropensity: 0.8, rollsPerDay: 2.5, claimsPerDay: 1, feedDiscipline: 0.97,
    churnPerDay: 0.003, wantsUppercase: true, grailHunter: false,
  },
  whale: {
    share: 0.05, dailyBudgetMean: 2000, dailyBudgetSd: 1000, fidProb: 0.75,
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
}

export const DEFAULT_SIM_CONFIG: SimConfig = {
  days: 270,
  seed: 1930, // rubber-hose era
  population: 800,
  rampDays: 60,
  params: DEFAULT_PARAMS,
};

// ---------------------------------------------------------------------------
// World
// ---------------------------------------------------------------------------

class World {
  rng: Rng;
  params: Params;
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

  constructor(cfg: SimConfig) {
    this.rng = new Rng(cfg.seed);
    this.params = cfg.params;
    this.caps = ALPHABET.map((L) => supplyCap(L, cfg.params.supply.demandMultiple));
    this.answerOrder = this.rng.shuffle([...WORDS]);
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
    lastActiveDay: day,
    joinedDay: day,
  };
}

/** Find an unclaimed word the player can spell from their LOWERCASE inventory. */
function findClaimable(player: Player, world: World, grail: boolean): string | null {
  claimGen++;
  let best: { idx: number; tier: number } | null = null;
  const tierRank: Record<Tier, number> = {
    Common: 0, Uncommon: 1, Rare: 2, Epic: 3, Legendary: 4,
  };
  let checked = 0;
  for (let li = 0; li < 26; li++) {
    if (player.lower[li] === 0) continue;
    for (const widx of WORDS_BY_RAREST[li]) {
      if (claimVisited[widx] === claimGen) continue;
      claimVisited[widx] = claimGen;
      const info = WORD_INFO[widx];
      if (world.claims.has(info.word)) continue;
      // can the player spell it from lowercase holdings?
      let ok = true;
      for (const [idx, cnt] of info.pairs) {
        if (player.lower[idx] < cnt) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;
      if (!grail) return info.word; // first match
      const tr = tierRank[info.tier];
      if (!best || tr > best.tier) best = { idx: widx, tier: tr };
      if (++checked > 64) break; // bound grail search
    }
    if (!grail && best) break;
  }
  return best ? WORD_INFO[best.idx].word : null;
}

function escrowClaim(player: Player, word: string): void {
  const info = WORD_INFO[WORD_INDEX.get(word)!];
  for (const [idx, cnt] of info.pairs) player.lower[idx] -= cnt;
  player.words.set(word, {
    word,
    tier: info.tier,
    upper: [false, false, false, false, false],
    staked: false,
    daysUnfed: 0,
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
  const dayBudget = Math.max(0, gaussian(rng, cfg.dailyBudgetMean, cfg.dailyBudgetSd));
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

  // 2) Feed staked words (protect yield + jackpot eligibility) — free snack first
  for (const w of player.words.values()) {
    if (!w.staked) continue;
    let fed = false;
    if (p.care.freeDailySnack && !player.freeSnackUsedToday) {
      player.freeSnackUsedToday = true;
      fed = true;
    } else if (rng.chance(cfg.feedDiscipline) && canSpend(p.prices.snack)) {
      spend(p.prices.snack);
      world.ledger.route(p.prices.snack, p.splits.snack); // 100% burn
      fed = true;
    }
    w.daysUnfed = fed ? 0 : w.daysUnfed + 1;
  }

  // 3) Claims (assemble owned letters into a permanent word)
  let claims = poisson(rng, cfg.claimsPerDay);
  while (claims-- > 0 && canSpend(p.prices.claim)) {
    const word = findClaimable(player, world, cfg.grailHunter);
    if (!word) break;
    spend(p.prices.claim);
    world.ledger.route(p.prices.claim, p.splits.claim);
    escrowClaim(player, word);
    world.claims.set(word, player.id);
  }

  // 4) Stake any unstaked claimed words (free, instant)
  for (const w of player.words.values()) if (!w.staked) w.staked = true;

  // 5) Upgrade rolls toward UPPERCASE (the core sink)
  let rolls = poisson(rng, cfg.rollsPerDay);
  while (rolls-- > 0 && canSpend(p.prices.roll)) {
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

    // ---- secondary-market royalty → Rewards Pool (v0.2 §8) ----
    // Macro abstraction: daily secondary GMV ≈ a fraction of the day's primary fee GMV;
    // its 2.5% royalty funds the pool. (Full per-letter resale is a next-iteration item.)
    const secondaryVolume = world.ledger.grossRoutedToday * world.params.market.secondaryVolumeRatio;
    const royalty = secondaryVolume * world.params.market.royaltyRate;
    if (royalty > 0) world.ledger.route(royalty, world.params.splits.royalty);

    // ---- daily yield distribution: UPPERCASE-only, hunger-weighted ----
    let totalWeight = 0;
    const eligible: { w: ClaimedWord; owner: Player; weight: number }[] = [];
    for (const pl of world.players) {
      for (const w of pl.words.values()) {
        if (!w.staked) continue;
        if (wordCase(w) !== "UPPERCASE") continue; // yield is UPPERCASE-only (v0.2 §1.5)
        const factor = hungerYieldFactor(w, world.params);
        if (factor === 0) continue;
        const weight = TIER_WEIGHT[w.tier] * factor;
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
        distributed += paid;
      }
    }

    // ---- jackpot resolution ----
    const answer = world.answerOrder[day % world.answerOrder.length];
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
    days.push(snapshot(world, day, distributed, jackpotPaid, rolledOver));
  }

  return summarize(world, days, cfg);
}

function buildArchetypeRoster(population: number): Archetype[] {
  const roster: Archetype[] = [];
  for (const [arch, cfg] of Object.entries(ARCHETYPES) as [Archetype, ArchetypeConfig][]) {
    const n = Math.round(population * cfg.share);
    for (let i = 0; i < n; i++) roster.push(arch);
  }
  return roster;
}

function snapshot(
  world: World,
  day: number,
  distributed: number,
  jackpotPaid: number,
  rolledOver: boolean,
): DayMetrics {
  let staked = 0;
  let uppercase = 0;
  let yieldEligible = 0;
  const claimers = new Set<number>();
  for (const pl of world.players) {
    for (const w of pl.words.values()) {
      claimers.add(pl.id);
      if (w.staked) staked++;
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
  };
}

function summarize(world: World, days: DayMetrics[], cfg: SimConfig): SimResult {
  const final = days[days.length - 1];
  // per-archetype ROI
  const roiMap = new Map<Archetype, { spent: number; earned: number }>();
  for (const pl of world.players) {
    const cur = roiMap.get(pl.archetype) ?? { spent: 0, earned: 0 };
    cur.spent += pl.spent;
    cur.earned += pl.earned;
    roiMap.set(pl.archetype, cur);
  }
  const playerRoi = [...roiMap.entries()].map(([archetype, v]) => ({
    archetype,
    spent: v.spent,
    earned: v.earned,
    net: v.earned - v.spent,
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

  return {
    days,
    final,
    playerRoi,
    notes,
    poolEquilibrium,
    jackpotWins: world.jackpotWins,
  };
}
