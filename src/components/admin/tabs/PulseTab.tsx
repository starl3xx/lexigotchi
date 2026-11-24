"use client";
/**
 * Pulse — the operator headline. On top, the LIVE game on this network (/api/admin/live: the
 * FeeRouter's pots, the treasury, letters minted, words claimed, wallets holding anything). Below,
 * the PROJECTION: the deterministic economy sim's buckets, collection, demand, and trend charts,
 * labelled as such so a sim number is never read as a live one.
 */
import type { PulsePayload } from "@/lib/admin/metrics";
import type { LivePayload } from "@/app/api/admin/live/route";
import { currentWordUsd, fmtNum, fmtPct, fmtUsd, fmtWordCompact } from "@/lib/admin/format";
import { ErrorState, MetricCard, Scorecard, SectionLabel, Spinner, RefreshButton, useFetch } from "../ui";
import { TrendChart } from "../charts";
import { Coins, CurrencyDollar, Fire, Package, Sparkle, Stack, Trophy, TrendUp, Users, Wallet } from "../icons";

export function PulseTab() {
  const { data, loading, error, reload } = useFetch<PulsePayload>("/api/admin/pulse");
  if (loading && !data) return <Spinner />;
  if (error) return <ErrorState msg={error} onRetry={reload} />;
  if (!data) return null;
  const h = data.headline;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-lg font-extrabold">Pulse</h2>
        <RefreshButton onClick={reload} loading={loading} />
      </div>

      <LiveSection />

      <section>
        <SectionLabel>Projection · economy sim · buckets in USD</SectionLabel>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <MetricCard icon={<Coins weight="bold" size={14} />} label="Rewards Pool" tone="accent" value={fmtUsd(h.pool)} sub={`equilibrium ~${fmtUsd(h.poolEquilibrium)}`} series={data.series.pool} delta={data.deltas.pool} deltaKind="abs" />
          <MetricCard icon={<Trophy weight="bold" size={14} />} label="Jackpot pot" tone="warning" value={fmtUsd(h.jackpot)} sub="current pot" series={data.series.jackpot} delta={data.deltas.jackpot} deltaKind="abs" />
          <MetricCard icon={<Fire weight="bold" size={14} />} label="Burned" tone="error" value={fmtUsd(h.burned)} sub="cumulative · deflationary" series={data.series.burned} />
          <MetricCard icon={<Wallet weight="bold" size={14} />} label="Treasury" tone="ok" value={fmtUsd(h.treasury)} sub="cumulative team/ops" series={data.series.treasury} />
        </div>
      </section>

      <section>
        <SectionLabel>Projection · collection &amp; players</SectionLabel>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <MetricCard icon={<Users weight="bold" size={14} />} label="Active players" tone="accent" value={fmtNum(h.activePlayers)} sub="sim day, end of run" series={data.series.dau} delta={data.deltas.activePlayers} deltaKind="abs" />
          <MetricCard icon={<Stack weight="bold" size={14} />} label="Dictionary claimed" value={fmtPct(h.dictionaryPct)} sub={`${fmtNum(h.totalClaims)} / ${fmtNum(h.dictionaryWords)} words`} series={data.series.claims} />
          <MetricCard icon={<Sparkle weight="bold" size={14} />} label="UPPERCASE words" tone="warning" value={fmtNum(h.uppercaseWords)} sub="yield-earning" />
          <MetricCard icon={<Package weight="bold" size={14} />} label="Letters minted" value={fmtNum(h.lettersMinted)} sub={`/ ${fmtNum(h.lettersCap)} cap · mint-out ${h.mintOutDay ? `~day ${h.mintOutDay}` : "—"}`} />
        </div>
      </section>

      <section>
        <SectionLabel>Projection · demand &amp; solvency</SectionLabel>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <MetricCard icon={<CurrencyDollar weight="bold" size={14} />} label="$WORD demand" tone="accent" value={fmtUsd(h.externalInflow)} sub="bought to play over the run" series={data.series.grossRouted} />
          <Scorecard label="Pool solvency" value={data.solvency.poolNeverNegative ? "Never negative" : "VIOLATED"} status={data.solvency.poolNeverNegative ? "ok" : "error"} detail="Yield pays a % of the pool balance — it can't drain below zero." />
          <Scorecard label="Jackpot solvency" value={data.solvency.jackpotNeverNegative ? "Never negative" : "VIOLATED"} status={data.solvency.jackpotNeverNegative ? "ok" : "error"} detail="The jackpot only ever pays what the bucket holds." />
        </div>
      </section>

      <section className="space-y-2">
        <SectionLabel>Projection · trends · {data.config.days} days · pop {fmtNum(data.config.population)}</SectionLabel>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <TrendChart title="Rewards Pool & Jackpot (USD)" data={data.trend} lines={[{ key: "pool", color: "#2a9d8f", label: "Pool" }, { key: "jackpot", color: "#e0a93b", label: "Jackpot" }]} />
          <TrendChart title="Cumulative burn & treasury (USD)" data={data.trend} lines={[{ key: "burnedTotal", color: "#d8463f", label: "Burned" }, { key: "treasuryTotal", color: "#7b4ea3", label: "Treasury" }]} />
          <TrendChart title="Collection progress" data={data.trend} lines={[{ key: "totalClaims", color: "#1b1714", label: "Claimed" }, { key: "uppercaseWords", color: "#e0a93b", label: "UPPERCASE" }]} />
          <TrendChart title="Daily activity (USD routed) & yield" data={data.trend} lines={[{ key: "grossRoutedToday", color: "#2a9d8f", label: "$WORD routed/day" }, { key: "distributionToday", color: "#b07d20", label: "Yield/day" }]} />
        </div>
      </section>
    </div>
  );
}

/** Whole $WORD with its USD value at the live peg (the peg cell AdminConsole keeps current). */
function wordAndUsd(word: number, testnet: boolean): { value: string; sub: string } {
  return {
    value: fmtWordCompact(word),
    sub: `${testnet ? "test " : ""}$WORD · ≈ ${fmtUsd(word * currentWordUsd())} at the live price`,
  };
}

/** The live game on this network, read from the chain. Hidden (with a note) where nothing is deployed. */
function LiveSection() {
  const { data, error } = useFetch<LivePayload>("/api/admin/live");
  if (error) {
    return (
      <section>
        <SectionLabel>Live</SectionLabel>
        <p className="text-sm text-candy">The live read failed ({error}). The projection below still loads.</p>
      </section>
    );
  }
  if (!data) return null;
  if (!data.live) {
    return (
      <section>
        <SectionLabel>Live</SectionLabel>
        <p className="text-sm text-ink/60">No game contracts on this network yet, so there is nothing live to show.</p>
      </section>
    );
  }
  const t = Boolean(data.network?.isTestnet);
  const b = data.buckets!;
  const w = data.words!;
  const l = data.letters!;
  return (
    <section className="space-y-3">
      <SectionLabel>Live · {data.network?.name} · read from the chain</SectionLabel>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <MetricCard icon={<Coins weight="bold" size={14} />} label="Rewards Pool" tone="accent" {...wordAndUsd(b.pool, t)} />
        <MetricCard icon={<Trophy weight="bold" size={14} />} label="Jackpot pot" tone="warning" {...wordAndUsd(b.jackpot, t)} />
        <MetricCard icon={<Coins weight="bold" size={14} />} label="Bounty pot" {...wordAndUsd(b.bounty, t)} />
        <MetricCard
          icon={<Wallet weight="bold" size={14} />}
          label="Treasury"
          tone="ok"
          {...(data.treasury ? wordAndUsd(data.treasury.word, t) : { value: "–", sub: "no treasury in the registry" })}
        />
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <MetricCard icon={<Users weight="bold" size={14} />} label="Wallets holding" tone="accent" value={fmtNum(data.holders ?? 0)} sub="a letter or a word, now" />
        <MetricCard
          icon={<Stack weight="bold" size={14} />}
          label="Dictionary claimed"
          value={fmtPct(w.dictionary ? w.claimed / w.dictionary : 0)}
          sub={`${fmtNum(w.claimed)} / ${fmtNum(w.dictionary)} words`}
        />
        <MetricCard icon={<Sparkle weight="bold" size={14} />} label="UPPERCASE words" tone="warning" value={fmtNum(w.uppercase)} sub={`${fmtNum(w.staked)} words staked`} />
        <MetricCard icon={<Package weight="bold" size={14} />} label="Letters minted" value={fmtNum(l.minted)} sub={`/ ${fmtNum(l.cap)} cap`} />
      </div>
    </section>
  );
}
