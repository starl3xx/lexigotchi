/**
 * Server-side metrics layer for the admin dashboard.
 *
 * Phase 0 has no live backend, so the operator's metrics are driven by the same deterministic
 * agent-based economy simulation published at `/economy` — the honest source of truth for how the
 * solvent system behaves. The sim runs once per server process (memoized) and is reshaped into the
 * serializable payloads the Pulse and Economy tabs fetch. When the suite is live, these payloads
 * gain a parallel on-chain-reads path; the shapes stay the same.
 */
import { runSim, DEFAULT_SIM_CONFIG } from "@/lib/sim/simulate";
import type { SimResult } from "@/lib/sim/types";
import { DEFAULT_PARAMS, WORD_PER_USD, WORD_USD_PRICE } from "@/lib/params";
import { WORD_COUNT } from "@/lib/dictionary";
import { TOTAL_SUPPLY_CAP, TIER_COUNTS } from "@/lib/economy";
import { FEE_SOURCES } from "./contracts";
import { usdToWord } from "./format";

const SIM_CONFIG = { ...DEFAULT_SIM_CONFIG, population: 800 };

let cache: SimResult | null = null;
function sim(): SimResult {
  if (!cache) cache = runSim(SIM_CONFIG);
  return cache;
}

/** First day the tightest letter is ≥99% minted out (the completion-cliff onset), or null. */
function mintOutDay(res: SimResult): number | null {
  for (const d of res.days) {
    const max = Math.max(0, ...Object.values(d.capConsumption));
    if (max >= 0.99) return d.day + 1;
  }
  return null;
}

export type Tone = "ok" | "warning" | "error" | "accent";

export interface MetricSeries {
  pool: number[];
  jackpot: number[];
  burned: number[];
  treasury: number[];
  dau: number[];
  distribution: number[];
  claims: number[];
  grossRouted: number[];
}

export interface TrendDay {
  day: number;
  pool: number;
  jackpot: number;
  burnedTotal: number;
  treasuryTotal: number;
  totalClaims: number;
  uppercaseWords: number;
  distributionToday: number;
  activePlayers: number;
  grossRoutedToday: number;
}

export interface PulsePayload {
  config: { days: number; population: number; seed: number };
  headline: {
    pool: number;
    poolEquilibrium: number;
    jackpot: number;
    burned: number;
    treasury: number;
    externalInflow: number;
    totalClaims: number;
    dictionaryPct: number;
    uppercaseWords: number;
    stakedWords: number;
    activePlayers: number;
    lettersMinted: number;
    lettersCap: number;
    mintOutDay: number | null;
  };
  /** Trailing 30-day deltas (final − value 30 days earlier), for the delta pills. */
  deltas: { pool: number; activePlayers: number; jackpot: number };
  series: MetricSeries;
  trend: TrendDay[];
  solvency: { poolNeverNegative: boolean; jackpotNeverNegative: boolean };
}

export interface ScorecardItem {
  label: string;
  value: string;
  status: "ok" | "warning" | "error";
  detail: string;
}

export interface EconomyPayload {
  prices: { key: string; label: string; usd: number; word: number }[];
  splits: { id: number; label: string; note: string; pool: number; jackpot: number; burn: number; treasury: number }[];
  roi: { archetype: string; spent: number; earned: number; net: number; recoupPct: number; claims: number; players: number }[];
  scorecard: ScorecardItem[];
  sink: {
    grossRoutedFinal: number;
    grossRoutedAtMintOut: number | null;
    distributionFinal: number;
    jackpotPaidAvg: number;
  };
  tiers: { name: string; count: number }[];
  notes: string[];
  pegInfo: { wordUsd: number; wordPerUsd: number };
}

export function pulsePayload(): PulsePayload {
  const res = sim();
  const f = res.final;
  const days = res.days;
  const at = (i: number) => days[Math.max(0, Math.min(days.length - 1, i))];
  const prev = at(days.length - 31);

  return {
    config: { days: SIM_CONFIG.days, population: SIM_CONFIG.population, seed: SIM_CONFIG.seed },
    headline: {
      pool: f.pool,
      poolEquilibrium: res.poolEquilibrium,
      jackpot: f.jackpot,
      burned: f.burnedTotal,
      treasury: f.treasuryTotal,
      externalInflow: f.externalInflowTotal,
      totalClaims: f.totalClaims,
      dictionaryPct: f.totalClaims / WORD_COUNT,
      uppercaseWords: f.uppercaseWords,
      stakedWords: f.stakedWords,
      activePlayers: f.activePlayers,
      lettersMinted: f.lettersMintedTotal,
      lettersCap: TOTAL_SUPPLY_CAP,
      mintOutDay: mintOutDay(res),
    },
    deltas: {
      pool: f.pool - prev.pool,
      activePlayers: f.activePlayers - prev.activePlayers,
      jackpot: f.jackpot - prev.jackpot,
    },
    series: {
      pool: days.map((d) => d.pool),
      jackpot: days.map((d) => d.jackpot),
      burned: days.map((d) => d.burnedTotal),
      treasury: days.map((d) => d.treasuryTotal),
      dau: days.map((d) => d.activePlayers),
      distribution: days.map((d) => d.distributionToday),
      claims: days.map((d) => d.totalClaims),
      grossRouted: days.map((d) => d.grossRoutedToday),
    },
    trend: days.map((d) => ({
      day: d.day,
      pool: d.pool,
      jackpot: d.jackpot,
      burnedTotal: d.burnedTotal,
      treasuryTotal: d.treasuryTotal,
      totalClaims: d.totalClaims,
      uppercaseWords: d.uppercaseWords,
      distributionToday: d.distributionToday,
      activePlayers: d.activePlayers,
      grossRoutedToday: d.grossRoutedToday,
    })),
    solvency: {
      poolNeverNegative: !days.some((d) => d.pool < -1e-6),
      jackpotNeverNegative: !days.some((d) => d.jackpot < -1e-6),
    },
  };
}

export function economyPayload(): EconomyPayload {
  const res = sim();
  const f = res.final;
  const mod = mintOutDay(res);
  const grossAtMintOut = mod != null ? res.days[mod - 1]?.grossRoutedToday ?? null : null;
  const P = DEFAULT_PARAMS.prices;

  const prices = [
    { key: "pack", label: "Pack of 5", usd: P.pack },
    { key: "dailyMint", label: "Daily single", usd: P.dailyMint },
    { key: "roll", label: "Roll", usd: P.roll },
    { key: "claim", label: "Claim", usd: P.claim },
    { key: "snack", label: "Snack", usd: P.snack },
  ].map((p) => ({ ...p, word: usdToWord(p.usd) }));

  const splits = FEE_SOURCES.map((s) => ({
    id: s.id,
    label: s.label,
    note: s.note,
    pool: s.bps[0],
    jackpot: s.bps[1],
    burn: s.bps[2],
    treasury: s.bps[3],
  }));

  const roi = [...res.playerRoi].sort((a, b) => b.net - a.net).map((r) => ({
    archetype: r.archetype,
    spent: r.spent,
    earned: r.earned,
    net: r.net,
    recoupPct: r.spent > 0 ? r.earned / r.spent : 0,
    claims: r.claims,
    players: r.players,
  }));

  const poolNeg = res.days.some((d) => d.pool < -1e-6);
  const jackNeg = res.days.some((d) => d.jackpot < -1e-6);
  const grossFinal = f.grossRoutedToday;
  const sinkRevival = grossAtMintOut != null && grossAtMintOut > 0 ? grossFinal / grossAtMintOut : null;

  const scorecard: ScorecardItem[] = [
    {
      label: "Solvency",
      value: !poolNeg && !jackNeg ? "Guaranteed" : "VIOLATED",
      status: !poolNeg && !jackNeg ? "ok" : "error",
      detail: "No bucket ever went negative — every faucet paid only what it held.",
    },
    {
      label: "Pool equilibrium",
      value: `$${Math.round(res.poolEquilibrium).toLocaleString()}`,
      status: f.pool > 0 ? "ok" : "warning",
      detail: `Self-scaling at ${(DEFAULT_PARAMS.staking.dailyDistributionRate * 100).toFixed(1)}%/day — finds equilibrium, never drains.`,
    },
    {
      label: "Mint-out day",
      value: mod ? `~day ${mod}` : "not reached",
      status: mod && mod < 90 ? "warning" : "ok",
      detail: mod
        ? "When the tightest letter hits 99% of cap — the completion-cliff onset. Durable sinks (rolls, snacks) carry the economy after."
        : "Letters never fully minted out in this run.",
    },
    {
      label: "Sink durability",
      value: sinkRevival != null ? `${(sinkRevival * 100).toFixed(0)}% of mint-out` : "—",
      status: sinkRevival != null && sinkRevival >= 0.5 ? "ok" : "warning",
      detail: "Daily $WORD routed at run-end vs at mint-out — does recurring activity persist past the cliff?",
    },
    {
      label: "Dictionary claimed",
      value: `${(f.totalClaims / WORD_COUNT * 100).toFixed(1)}%`,
      status: "ok",
      detail: `${f.totalClaims.toLocaleString()} / ${WORD_COUNT.toLocaleString()} words claimed by run-end.`,
    },
    {
      label: "Deflation",
      value: `$${Math.round(f.burnedTotal).toLocaleString()}`,
      status: "ok",
      detail: "Cumulative $WORD burned — net deflationary pressure on a finite supply.",
    },
  ];

  return {
    prices,
    splits,
    roi,
    scorecard,
    sink: {
      grossRoutedFinal: grossFinal,
      grossRoutedAtMintOut: grossAtMintOut,
      distributionFinal: f.distributionToday,
      jackpotPaidAvg:
        res.jackpotWins.length > 0
          ? res.jackpotWins.reduce((a, w) => a + w.amount, 0) / res.jackpotWins.length
          : 0,
    },
    tiers: (Object.entries(TIER_COUNTS) as [string, number][]).map(([name, count]) => ({ name, count })),
    notes: res.notes,
    pegInfo: { wordUsd: WORD_USD_PRICE, wordPerUsd: WORD_PER_USD },
  };
}
