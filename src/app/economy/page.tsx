import { EconomyCharts, type ChartDay } from "@/components/charts/EconomyCharts";
import { runSim, DEFAULT_SIM_CONFIG } from "@/lib/sim/simulate";
import { DEFAULT_PARAMS } from "@/lib/params";

// Phase 0 prototype: run the deterministic sim at build time and visualize it. A real
// build would precompute several scenarios; here we show the default economy.
const res = runSim({ ...DEFAULT_SIM_CONFIG, population: 500 });

const fmt = (n: number) => Math.round(n).toLocaleString();

export default function EconomyPage() {
  const days: ChartDay[] = res.days.map((d) => ({
    day: d.day,
    pool: d.pool,
    jackpot: d.jackpot,
    burnedTotal: d.burnedTotal,
    treasuryTotal: d.treasuryTotal,
    totalClaims: d.totalClaims,
    uppercaseWords: d.uppercaseWords,
    distributionToday: d.distributionToday,
  }));
  const f = res.final;
  const $ = (n: number) => `$${Math.round(n).toLocaleString()}`;

  const cards = [
    ["Rewards Pool", $(f.pool), `equilibrium ~${$(res.poolEquilibrium)}`],
    ["Burned", $(f.burnedTotal), "deflationary (USD)"],
    ["$WORD demand", $(f.externalInflowTotal), "bought to play · vs ~$23.6K mcap"],
    ["Claims", `${fmt(f.totalClaims)} / 4,438`, `${fmt(f.uppercaseWords)} UPPERCASE`],
  ];

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <h1 className="font-display text-3xl font-extrabold">Economy</h1>
        <p className="max-w-2xl text-ink/80">
          A deterministic agent-based simulation of the v0.2 economy: {DEFAULT_SIM_CONFIG.days}{" "}
          days, a growing population of player archetypes, every fee routed through the
          four-bucket ledger. <strong>Solvency is structural</strong> — yield is paid as a %
          of the pool balance and the jackpot only pays what it holds, so no bucket can go
          negative. The sim exists to set pricing and reveal how the solvent system behaves.
        </p>
        <p className="text-xs text-ink/60">
          USD-pegged prices (sim runs in USD): daily ${DEFAULT_PARAMS.prices.dailyMint} · pack $
          {DEFAULT_PARAMS.prices.pack} · roll ${DEFAULT_PARAMS.prices.roll} · claim $
          {DEFAULT_PARAMS.prices.claim} · snack ${DEFAULT_PARAMS.prices.snack}. One-time treasury
          seed: jackpot ${DEFAULT_PARAMS.seed.jackpot} + pool ${DEFAULT_PARAMS.seed.pool}. $WORD is
          a ~$23.6K micro-cap, so prices are re-pegged on-chain as the price moves. Tune via{" "}
          <code>src/lib/params.ts</code>.
        </p>
      </header>

      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {cards.map(([label, big, small]) => (
          <div key={label} className="cel rounded-lg bg-paper p-4">
            <div className="text-xs font-bold uppercase tracking-wide text-ink/50">{label}</div>
            <div className="font-display text-xl font-extrabold">{big}</div>
            <div className="text-xs text-ink/60">{small}</div>
          </div>
        ))}
      </section>

      <EconomyCharts days={days} />

      <section className="space-y-3">
        <h2 className="font-display text-2xl font-extrabold">What the sim found</h2>
        <ul className="space-y-2">
          {res.notes.map((n, i) => (
            <li key={i} className="cel rounded-lg bg-paper p-3 text-sm">
              {n}
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-3">
        <h2 className="font-display text-2xl font-extrabold">Player ROI by archetype</h2>
        <p className="text-sm text-ink/70">
          A sink-heavy economy is net-negative in $WORD by design (burn + treasury capture
          value); players buy fun, collectibles, and lottery tickets. The spread across
          archetypes is the signal — and note this sim omits secondary letter trading, which
          is exactly what gives low-budget players an economic role.
        </p>
        <div className="overflow-hidden rounded-lg cel bg-paper">
          <table className="w-full text-sm">
            <thead className="bg-paper-dark text-left font-display">
              <tr>
                <th className="px-4 py-2">Archetype</th>
                <th className="px-4 py-2 text-right">Spent</th>
                <th className="px-4 py-2 text-right">Earned</th>
                <th className="px-4 py-2 text-right">Recoup</th>
              </tr>
            </thead>
            <tbody>
              {[...res.playerRoi]
                .sort((a, b) => b.net - a.net)
                .map((r) => (
                  <tr key={r.archetype} className="border-t-2 border-ink/10">
                    <td className="px-4 py-2 font-bold capitalize">{r.archetype}</td>
                    <td className="px-4 py-2 text-right">{fmt(r.spent)}</td>
                    <td className="px-4 py-2 text-right">{fmt(r.earned)}</td>
                    <td className="px-4 py-2 text-right">
                      {r.spent > 0 ? `${((r.earned / r.spent) * 100).toFixed(0)}%` : "—"}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
