/**
 * Lexigotchi economic parameters — the single tunable surface for the Phase 0 sim.
 *
 * Every value here maps to a storage variable behind multisig on-chain (spec v0.2 §intro:
 * "implement it as a storage variable behind admin/multisig, not a constant").
 *
 * PRICING IS USD-PEGGED (decision, June 2026). $WORD is a ~$23.6K-mcap micro-cap (100B
 * supply, ~$21K liquidity), so its USD price swings hard; rather than fix $WORD amounts and
 * let cost-to-play drift, prices are defined as USD targets and the multisig re-sets the
 * on-chain $WORD amounts as the price moves. The sim therefore runs in USD — pool, jackpot,
 * and burn read directly in dollars — and `priceWord()` converts a USD target to the $WORD
 * amount to set on-chain. ETH entering via the mint auto-swap (v0.2 §4) is just another
 * way to source the $WORD.
 */

import { DEMAND_MULTIPLE } from "./economy";

/**
 * FALLBACK $WORD price, USD — a GeckoTerminal snapshot of the WORD/WETH pool on Base
 * (`0xc5db…a275`) as of 2026-06-11: price ~$2.3569e-7, liquidity ~$21.2K, FDV ~$23.5K.
 *
 * The LIVE price comes from `src/lib/oracle/wordPrice.ts` (GeckoTerminal's token endpoint) and is
 * pushed into the peg cell below. This constant remains as (a) the seed before any fetch lands,
 * (b) the answer when GeckoTerminal is unreachable, and (c) the SIM's input — the sim stays on the
 * constant deliberately, so runs are deterministic and comparable across days.
 */
export const WORD_USD_PRICE = 0.00000023569;
/** $WORD per $1 (≈ 4.22M at the fallback price). */
export const WORD_PER_USD = 1 / WORD_USD_PRICE;

/**
 * The live peg cell. Defaults in `priceWord` / `usdToWord*` read it AT CALL TIME, which is what
 * upgrades every USD↔$WORD conversion in the app and the admin the moment the oracle answers —
 * no call-site changes. Module-level constants (the sim, the mock store's COST table) evaluate at
 * import and stay on the fallback, which is the intended split: displays and operator tx-building
 * follow the market; deterministic models don't.
 */
let liveWordUsd = WORD_USD_PRICE;
/** Current peg: the oracle's price once fetched, the fallback constant before/without it. */
export function currentWordUsd(): number {
  return liveWordUsd;
}
/** Guarded: a NaN/zero/negative peg would mis-size every conversion, so garbage is ignored. */
export function setLiveWordUsd(priceUsd: number): void {
  if (Number.isFinite(priceUsd) && priceUsd > 0) liveWordUsd = priceUsd;
}

/** Convert a USD price target to the $WORD amount to set on-chain at a given peg. */
export function priceWord(usd: number, wordUsd: number = currentWordUsd()): number {
  return usd / wordUsd;
}

/** A revenue split routes an incoming $WORD fee into the four buckets. Must sum to 1. */
export interface Split {
  pool: number; // → Rewards Pool (funds UPPERCASE yield)
  jackpot: number; // → Jackpot pot
  burn: number; // → burned (deflationary)
  treasury: number; // → Treasury (team/ops)
}

export interface Params {
  /** Prices in USD (USD-pegged; `priceWord(usd)` gives the on-chain $WORD amount). */
  prices: {
    pack: number; // pack of 5 letters, full price (volume loop)
    dailyMint: number; // 1 free single per FID per day (habit loop)
    roll: number; // flat upgrade-roll fee (v0.1 §5.3; rarity-scaled is P2)
    claim: number; // flat claim fee (v0.1 §5.4; tier-scaled is P2)
    snack: number; // one snack feeds one staked word for one day
  };

  /**
   * One-time treasury bootstrap of the faucets at launch, in USD (decision: bootstrap the
   * jackpot pool). Fee inflow starts at $0 and there is barely a market to buy $WORD from,
   * so the team seeds the jackpot (a launch prize) and optionally the Rewards Pool (early
   * yield) from the 10B+ treasury. A one-time seed, NOT an ongoing emission — solvency by
   * construction still holds.
   */
  seed: {
    jackpot: number;
    pool: number;
  };

  /** Fee splits per revenue source (v0.1 §6 table — unchanged in v0.2). */
  splits: {
    packMint: Split;
    dailyMint: Split; // mints route like pack mints
    roll: Split;
    claim: Split;
    snack: Split; // 100% burn
    royalty: Split; // 2.5% secondary royalty → 100% Treasury (overrides v0.2 §8's pool routing:
    // marketplace royalties arrive in ETH, and Treasury holds ETH without an ETH→$WORD swap)
    prestige?: Split; // optional; the prestige commit fee routes here, else falls back to `roll`
  };

  /** Upgrade roll (v0.2 §1.4): 45% base, +10pp per consecutive fail, cap 85%, reset on success. */
  roll: {
    baseSuccess: number;
    pityStep: number;
    pityCap: number;
  };

  /** Staking & yield (v0.2 §1.5). */
  staking: {
    /** Daily Rewards-Pool payout as a fraction of current pool balance (self-scaling; never drains). */
    dailyDistributionRate: number;
    /**
     * true (the v0.2 decision): yield is exclusive to full-UPPERCASE words, at tier weight.
     * false: the v0.1 scheme — any staked word earns at tier × case multiplier. The sim
     * reads this flag, so it is a real lever for comparing the two yield models.
     */
    yieldRequiresUppercase: boolean;
  };

  /** Care / hunger (v0.2 §1.6). Hunger gates BOTH yield and jackpot eligibility. */
  care: {
    snacksPerWordPerDay: number;
    /** Days unfed at which a word becomes peckish (yield ×0.5, still jackpot-eligible). */
    peckishAfterDays: number;
    /** Days unfed at which a word becomes hungry (yield 0, NOT jackpot-eligible). */
    hungryAfterDays: number;
    peckishYieldFactor: number;
    /** Daily check-in grants one free snack (retention hook, v0.1 §5.6). */
    freeDailySnack: boolean;
  };

  /** Jackpot (v0.2 §2): single keccak(answer) lookup; rolls over if unstaked/hungry/unclaimed. */
  jackpot: {
    /** Whether a non-hungry staked claim of the day's answer pays out (else rollover). */
    eligibilityRequiresNotHungry: boolean;
  };

  /** Secondary-market royalty (v0.2 §8, destination overridden — see `splits.royalty`). */
  market: {
    royaltyRate: number; // e.g., 0.025
    /**
     * Macro abstraction for Phase 0: daily secondary GMV modeled as this fraction of the
     * day's PRIMARY fee GMV (mints+rolls+claims). Royalty on it routes per `splits.royalty`
     * (now 100% Treasury). This exercises the royalty faucet without a (fragile) per-letter
     * matching engine; full letter redistribution is modeled via `trading` (see decisions.md).
     */
    secondaryVolumeRatio: number;
  };

  /**
   * Global per-letter supply cap multiple (v0.1 §5.2; revisit if mint-out < 6mo, v0.2 §5.5).
   * Sourced from `economy.DEMAND_MULTIPLE` so the sim's caps always match the published
   * Lexidex / LETTER_SUPPLY_CAP tables — change the multiple THERE, not here.
   */
  supply: {
    demandMultiple: number;
  };

  /**
   * Secondary letter liquidity — a SIM LEVER for the "should we build a swap primitive?"
   * decision (not yet a product). Models a simple daily clearing: blocked claimers bid for
   * the letters they need toward their nearest unclaimed word; everyone lists a fraction of
   * their duplicate (surplus) letters at a floor. $WORD changes hands player-to-player
   * (recoup for sellers, claim velocity for buyers) and ONLY the secondary royalty leaks to
   * the pool, so solvency is untouched. OFF by default so the baseline + spec tests are
   * unchanged; the experiment toggles it on (`npm run trade-exp`). This is NOT a marketplace —
   * the eventual contract is a two-sided swap escrow; open price discovery stays on integrated
   * venues (v0.2 §8). See docs/decisions.md.
   */
  trading: {
    enabled: boolean;
    /** Fraction of each player's surplus (held-beyond-one) letters listed per day. */
    listSurplusFraction: number;
    /** Secondary floor price per letter, as a fraction of the per-letter primary pack cost. */
    floorFraction: number;
    /** Max letters a blocked claimer bids for toward its nearest unclaimed word per day. */
    maxBidLetters: number;
  };

  /**
   * Dissolution (v0.1 §5.4, reaffirmed v0.2 §6) — the only liquidity escape hatch for a bad
   * claim: burn the Word NFT, recover its 5 escrowed letters, return the name to the claimable
   * pool (trophy history persists). A SIM LEVER (default off). Modeled as a VOLUNTARY redeploy
   * act, NOT a consequence of neglect: a player who chases better/UPPERCASE words recycles a
   * "dead" (still all-lowercase, never upgraded) low-tier claim to recover its letters. The
   * mechanic's *real* value — de-risking claims so people claim more boldly because they can
   * exit, plus freeing names for gifting/re-claim drama — is behavioral and outside this
   * greedy-claim agent model; the sim sees only the mechanical churn. Contract-side this stays
   * in `Words.sol` regardless of the sim. See docs/decisions.md.
   */
  dissolution: {
    enabled: boolean;
    /** Daily probability a redeploy-motivated owner dissolves a dead low-tier all-lowercase word. */
    dailyProb: number;
    /** Only dissolve at/below this tier rank (0=Common…4=Legendary) — nobody burns a crown. */
    maxTierRank: number;
  };

  /**
   * Prestige / ascension (renewable late-game loop, sim LEVER — default off). A full-UPPERCASE
   * staked Word ascends through `levels` Gilded stages (EGGS chicken-level parity). Each attempt
   * pays `commitFeeUsd` (routed via `splits.prestige ?? splits.roll`) + burns `snacksPerAttempt`
   * snacks (100% burn), and succeeds on a pity ramp identical in shape to upgrade rolls. SUCCESS
   * bumps the level (monotonic, never decremented) and resets pity; FAILURE is an explicit no-op —
   * level, case, and escrowed letters untouched (compliance: an upgrade fee with probabilistic
   * timing, never a wager on principal — same stance as rolls). Each level multiplies that word's
   * stake-yield weight (`yieldMultPerLevel^level`) and bounty weight (`bountyMultPerLevel^level`).
   *
   * Solvency-neutral by construction: prestige yield-weight takes a bigger slice of the SAME fixed
   * `pool × dailyDistributionRate` pot — it never enlarges the pot. Models the durable-sink DEPTH
   * extension for the ~25% UPPERCASE-chasing cohort (a FINITE sink: `levels` × maxed words); the
   * renewable engine is `bounty`. `yieldMultPerLevel` is deliberately gentle (1.10, not 1.25) to
   * limit whale yield concentration — sweep higher as a sensitivity row, not a default. See
   * docs/decisions.md "Renewable late-game loop".
   */
  prestige: {
    enabled: boolean;
    /** Number of Gilded ascension stages above full-UPPERCASE (EGGS parity: 4). */
    levels: number;
    /** USD commit fee per attempt (default = roll fee). Routes via `splits.prestige ?? splits.roll`. */
    commitFeeUsd: number;
    baseSuccess: number; // mirrors roll odds (45% base)
    pityStep: number; // +10pp per consecutive fail on that word
    pityCap: number; // cap 85%
    /** Snacks burned per attempt (100% burn via `splits.snack`). */
    snacksPerAttempt: number;
    /** A word's stake-yield weight is multiplied by this per prestige level. */
    yieldMultPerLevel: number;
    /** A word's bounty weight is multiplied by this per prestige level. */
    bountyMultPerLevel: number;
  };

  /**
   * Theme bounty (renewable late-game loop, sim LEVER — default off). Every `periodDays`, Lexigotchi
   * features a CATEGORY of words (a predicate over the static dictionary — see `THEMES` in
   * simulate.ts). At period end, every player holding a theme-matching word STAKED + not-hungry
   * shares the bounty pool pro-rata (weighted by prestige). Reaches the whole base (the casual
   * cohort that IS the day-70 cliff), re-driving claim/feed/prestige demand toward matching words;
   * an unsatisfied period rolls forward. Never a wager on principal; never touches holdings.
   *
   * Funded ZERO-SUM: `carveFraction` of the day's POOL inflow is skimmed into a side `bountyPool`
   * (a redistribution from passive staking-yield to the active goal) — NOT from the jackpot bucket,
   * which is emptied every win and pays ~daily late-game (carving it would raid the headline
   * escalation). The carve is a pure bucket→pool transfer, never a `route()`, so there is NO
   * `splits.bounty`. `chaseProbability` (how often a claimer steers toward a matching word) is the
   * load-bearing behavioral assumption — sweep it; read magnitudes as sensitivity. See
   * docs/decisions.md "Renewable late-game loop".
   */
  bounty: {
    enabled: boolean;
    /** Days per featured-category period (the theme rotates each period). */
    periodDays: number;
    /** Fraction of the day's POOL inflow skimmed into the bounty pool (zero-sum vs yield). */
    carveFraction: number;
    /** Require not-hungry to collect (a hungry word can't win, mirroring jackpot/yield gates). */
    requiresNotHungry: boolean;
    /** Probability a claimer steers a given claim toward a theme-matching unclaimed word. */
    chaseProbability: number;
    /**
     * Rarity tilt of the pro-rata split: a matching word's bounty weight is
     * `TIER_WEIGHT[tier] ** rarityWeight × prestigeMult`. This is the breadth ↔ rarity-incentive dial:
     *   0 = FLAT — every matching word shares equally (maximises casual reach, the bounty's headline
     *       virtue, since casuals mostly hold Commons);
     *   1 = TIER-PROPORTIONAL — matches how staking yield already treats tier (Common 1 … Legendary 8),
     *       so it rewards owning/holding/feeding RARE matching words and gives collectors a reason to
     *       acquire them (driving the secondary market the flat model can't show) — at the cost of some
     *       casual reach;
     *   >1 = steeper still.
     * Default 1.0 for consistency with yield's tier treatment; sweep it (see `npm run loop-exp`).
     */
    rarityWeight: number;
  };
}

export const DEFAULT_PARAMS: Params = {
  // USD targets (accessible/bootstrap — see decisions.md). $WORD amounts via priceWord().
  prices: {
    pack: 1.0, // ≈ 4.22M $WORD at the current peg (5 letters → $0.20/letter primary)
    dailyMint: 0, // FREE — zero-friction daily habit hook (no $WORD needed); $WORD is for everything else
    roll: 0.25, // ≈ 1.06M $WORD — the core sink; ~1.9 rolls/success ≈ $0.48 per UPPERCASE letter
    claim: 0.5, // ≈ 2.11M $WORD — a commitment
    snack: 0.02, // ≈ 84K $WORD — trivial daily care
  },
  seed: {
    // Compliance (pricing review): do NOT seed the chance-based jackpot from treasury — an
    // operator-funded prize is the core lottery risk. Bootstrap the YIELD pool only; the
    // jackpot self-funds from fee splits. Treasury's other lever is LP depth (a market op,
    // see docs/pricing-review.md + `npm run market`), not a faucet seed.
    jackpot: 0,
    pool: 240, // ≈ 1.01B $WORD — gives the first UPPERCASE stakers something to earn
  },
  splits: {
    packMint: { pool: 0.4, jackpot: 0.1, burn: 0.2, treasury: 0.3 },
    dailyMint: { pool: 0.4, jackpot: 0.1, burn: 0.2, treasury: 0.3 },
    roll: { pool: 0.475, jackpot: 0.1, burn: 0.275, treasury: 0.15 }, // jackpot rake 10% (freed 15pp → burn+pool)
    claim: { pool: 0.325, jackpot: 0.1, burn: 0.325, treasury: 0.25 }, // jackpot rake 10% (freed 15pp → burn+pool)
    snack: { pool: 0, jackpot: 0, burn: 1, treasury: 0 },
    royalty: { pool: 0, jackpot: 0, burn: 0, treasury: 1 },
  },
  roll: {
    baseSuccess: 0.45,
    pityStep: 0.1,
    pityCap: 0.85,
  },
  staking: {
    dailyDistributionRate: 0.01,
    yieldRequiresUppercase: true,
  },
  care: {
    snacksPerWordPerDay: 1,
    peckishAfterDays: 1,
    hungryAfterDays: 3,
    peckishYieldFactor: 0.5,
    freeDailySnack: true,
  },
  jackpot: {
    eligibilityRequiresNotHungry: true,
  },
  market: {
    royaltyRate: 0.025,
    // Open composability (decision, June 2026) ⇒ external-marketplace royalties are optional and
    // largely uncollected, so external secondary royalty is modeled as 0. The in-house swap fee
    // (the `trading` lever) is the only ENFORCED royalty → Treasury. Any external royalty that
    // does get paid is upside. See docs/decisions.md "Royalty & marketplace architecture".
    secondaryVolumeRatio: 0,
  },
  supply: {
    demandMultiple: DEMAND_MULTIPLE,
  },
  trading: {
    enabled: false,
    listSurplusFraction: 0.5, // half of your duplicate letters get listed
    floorFraction: 0.6, // 60% of the $0.20/letter primary cost ≈ a $0.12 secondary floor
    maxBidLetters: 3, // a blocked claimer chases at most 3 letters toward its nearest word
  },
  dissolution: {
    enabled: false,
    dailyProb: 0.05, // a redeploy-minded owner recycles a dead low-tier claim ~5%/day
    maxTierRank: 1, // Common + Uncommon only — crowns are never burned
  },
  prestige: {
    enabled: false,
    levels: 4, // EGGS chicken-level parity
    commitFeeUsd: 0.25, // = roll fee; routes via splits.prestige ?? splits.roll
    baseSuccess: 0.45,
    pityStep: 0.1,
    pityCap: 0.85,
    snacksPerAttempt: 1, // burns one snack per attempt (100% burn)
    yieldMultPerLevel: 1.1, // gentle — caps a maxed Legendary at ~11.7× a base Common (not ~19.5×)
    bountyMultPerLevel: 1.1,
  },
  bounty: {
    enabled: false,
    periodDays: 7, // a new featured category each week
    carveFraction: 0.15, // skim 15% of daily pool inflow into the bounty pool (zero-sum vs yield)
    requiresNotHungry: true,
    chaseProbability: 0.5, // load-bearing behavioral assumption — swept in the experiment
    rarityWeight: 1.0, // tier-proportional (matches yield); 0 = flat. The breadth↔rarity dial.
  },
  // NB: no `splits.prestige` default — leaving it undefined makes the commit fee fall back to
  // `splits.roll`, and keeps `assertSplitsValid` from validating a non-existent split.
};

/** Probability of a successful roll given a pity streak (consecutive prior failures). */
export function rollSuccessProbability(pityStreak: number, p: Params = DEFAULT_PARAMS): number {
  return Math.min(p.roll.pityCap, p.roll.baseSuccess + p.roll.pityStep * pityStreak);
}

/** Probability of a successful prestige attempt given that word's pity streak (mirrors rolls). */
export function prestigeSuccessProbability(pityStreak: number, p: Params = DEFAULT_PARAMS): number {
  return Math.min(p.prestige.pityCap, p.prestige.baseSuccess + p.prestige.pityStep * pityStreak);
}

/** Expected rolls to one success at base odds (geometric, ignoring pity ceiling effects). */
export function expectedRollsToSuccess(p: Params = DEFAULT_PARAMS): number {
  // Exact expectation accounting for the rising pity ramp until cap.
  let pFail = 1;
  let expected = 0;
  for (let streak = 0; streak < 100; streak++) {
    const pSucc = rollSuccessProbability(streak, p);
    expected += pFail * (streak + 1) * pSucc;
    pFail *= 1 - pSucc;
    if (pFail < 1e-9) break;
  }
  return expected;
}

/** Validate every split sums to 1 (±epsilon). Throws with the offending key. */
export function assertSplitsValid(p: Params = DEFAULT_PARAMS): void {
  for (const [key, s] of Object.entries(p.splits)) {
    if (!s) continue; // optional splits (e.g. prestige) may be undefined → fall back elsewhere
    const sum = s.pool + s.jackpot + s.burn + s.treasury;
    if (Math.abs(sum - 1) > 1e-9) {
      throw new Error(`Split "${key}" sums to ${sum}, expected 1`);
    }
  }
}
