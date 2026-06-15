"use client";
/**
 * Pulse — the operator headline. Treasury/bucket levels, collection + player activity, $WORD demand,
 * and the bucket/collection trend charts. All figures come from the deterministic economy sim
 * (Phase 0); the shapes match what live on-chain reads will fill once the suite ships.
 */
import type { PulsePayload } from "@/lib/admin/metrics";
import { fmtNum, fmtPct, fmtUsd } from "@/lib/admin/format";
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

      <section>
        <SectionLabel>Buckets · USD</SectionLabel>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <MetricCard icon={<Coins weight="bold" size={14} />} label="Rewards Pool" tone="accent" value={fmtUsd(h.pool)} sub={`equilibrium ~${fmtUsd(h.poolEquilibrium)}`} series={data.series.pool} delta={data.deltas.pool} deltaKind="abs" />
          <MetricCard icon={<Trophy weight="bold" size={14} />} label="Jackpot pot" tone="warning" value={fmtUsd(h.jackpot)} sub="current pot" series={data.series.jackpot} delta={data.deltas.jackpot} deltaKind="abs" />
          <MetricCard icon={<Fire weight="bold" size={14} />} label="Burned" tone="error" value={fmtUsd(h.burned)} sub="cumulative · deflationary" series={data.series.burned} />
          <MetricCard icon={<Wallet weight="bold" size={14} />} label="Treasury" tone="ok" value={fmtUsd(h.treasury)} sub="cumulative team/ops" series={data.series.treasury} />
        </div>
      </section>

      <section>
        <SectionLabel>Collection &amp; players</SectionLabel>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <MetricCard icon={<Users weight="bold" size={14} />} label="Active players" tone="accent" value={fmtNum(h.activePlayers)} sub="sim day, end of run" series={data.series.dau} delta={data.deltas.activePlayers} deltaKind="abs" />
          <MetricCard icon={<Stack weight="bold" size={14} />} label="Dictionary claimed" value={fmtPct(h.dictionaryPct)} sub={`${fmtNum(h.totalClaims)} / 4,438 words`} series={data.series.claims} />
          <MetricCard icon={<Sparkle weight="bold" size={14} />} label="UPPERCASE words" tone="warning" value={fmtNum(h.uppercaseWords)} sub="yield-earning" />
          <MetricCard icon={<Package weight="bold" size={14} />} label="Letters minted" value={fmtNum(h.lettersMinted)} sub={`/ ${fmtNum(h.lettersCap)} cap · mint-out ${h.mintOutDay ? `~day ${h.mintOutDay}` : "—"}`} />
        </div>
      </section>

      <section>
        <SectionLabel>Demand &amp; solvency</SectionLabel>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <MetricCard icon={<CurrencyDollar weight="bold" size={14} />} label="$WORD demand" tone="accent" value={fmtUsd(h.externalInflow)} sub="bought to play (vs ~$23.6K mcap)" series={data.series.grossRouted} />
          <Scorecard label="Pool solvency" value={data.solvency.poolNeverNegative ? "Never negative" : "VIOLATED"} status={data.solvency.poolNeverNegative ? "ok" : "error"} detail="Yield pays a % of the pool balance — it can't drain below zero." />
          <Scorecard label="Jackpot solvency" value={data.solvency.jackpotNeverNegative ? "Never negative" : "VIOLATED"} status={data.solvency.jackpotNeverNegative ? "ok" : "error"} detail="The jackpot only ever pays what the bucket holds." />
        </div>
      </section>

      <section className="space-y-2">
        <SectionLabel>Trends · {data.config.days} days · pop {fmtNum(data.config.population)}</SectionLabel>
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
