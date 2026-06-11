/**
 * Lexigotchi economic parameters — the single tunable surface for the Phase 0 sim.
 *
 * Every value here maps to a storage variable behind multisig on-chain (spec v0.2 §intro:
 * "implement it as a storage variable behind admin/multisig, not a constant"). Prices are
 * PLACEHOLDERS pending the Phase 0 tokenomics sim (v0.2 §7 open question); the mechanics
 * (splits, odds, pity, hunger, distribution shape) are decided.
 *
 * All amounts are in $WORD. ETH only ever enters via the mint auto-swap (v0.2 §4) and is
 * converted to $WORD before any accounting — so the whole model is $WORD-denominated.
 */

/** A revenue split routes an incoming $WORD fee into the four buckets. Must sum to 1. */
export interface Split {
  pool: number; // → Rewards Pool (funds UPPERCASE yield)
  jackpot: number; // → Jackpot pot
  burn: number; // → burned (deflationary)
  treasury: number; // → Treasury (team/ops)
}

export interface Params {
  /** Prices in $WORD (placeholders — the sim exists to set these). */
  prices: {
    pack: number; // pack of 5 letters, full price (volume loop)
    dailyMint: number; // 1 discounted single per FID per day (habit loop)
    singlePull: number; // ad-hoc single pull at a premium (non-daily)
    roll: number; // flat upgrade-roll fee (v0.1 §5.3; rarity-scaled is P2)
    claim: number; // flat claim fee (v0.1 §5.4; tier-scaled is P2)
    snack: number; // one snack feeds one staked word for one day
  };

  /** Fee splits per revenue source (v0.1 §6 table — unchanged in v0.2). */
  splits: {
    packMint: Split;
    dailyMint: Split; // mints route like pack mints
    roll: Split;
    claim: Split;
    snack: Split; // 100% burn
    royalty: Split; // 2.5% secondary royalty → 100% Rewards Pool (v0.2 §8)
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
    /** Yield is exclusive to full-UPPERCASE words. Jackpot eligibility is any case. */
    yieldRequiresUppercase: true;
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

  /** Secondary-market royalty (v0.2 §8). */
  market: {
    royaltyRate: number; // e.g., 0.025
    /**
     * Macro abstraction for Phase 0: daily secondary GMV modeled as this fraction of the
     * day's PRIMARY fee GMV (mints+rolls+claims). Royalty on it routes 100% to the pool.
     * This exercises the royalty faucet without a (fragile) per-letter matching engine;
     * full letter redistribution is a deliberate next-iteration item (see decisions.md).
     */
    secondaryVolumeRatio: number;
  };

  /** Global per-letter supply cap multiple (v0.1 §5.2; revisit if mint-out < 6mo, v0.2 §5.5). */
  supply: {
    demandMultiple: number;
  };
}

export const DEFAULT_PARAMS: Params = {
  prices: {
    pack: 500,
    dailyMint: 60,
    singlePull: 120,
    roll: 100,
    claim: 250,
    snack: 15,
  },
  splits: {
    packMint: { pool: 0.4, jackpot: 0.1, burn: 0.2, treasury: 0.3 },
    dailyMint: { pool: 0.4, jackpot: 0.1, burn: 0.2, treasury: 0.3 },
    roll: { pool: 0.4, jackpot: 0.25, burn: 0.2, treasury: 0.15 },
    claim: { pool: 0.25, jackpot: 0.25, burn: 0.25, treasury: 0.25 },
    snack: { pool: 0, jackpot: 0, burn: 1, treasury: 0 },
    royalty: { pool: 1, jackpot: 0, burn: 0, treasury: 0 },
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
    secondaryVolumeRatio: 0.35,
  },
  supply: {
    demandMultiple: 2.5,
  },
};

/** Probability of a successful roll given a pity streak (consecutive prior failures). */
export function rollSuccessProbability(pityStreak: number, p: Params = DEFAULT_PARAMS): number {
  return Math.min(p.roll.pityCap, p.roll.baseSuccess + p.roll.pityStep * pityStreak);
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
    const sum = s.pool + s.jackpot + s.burn + s.treasury;
    if (Math.abs(sum - 1) > 1e-9) {
      throw new Error(`Split "${key}" sums to ${sum}, expected 1`);
    }
  }
}
