"use client";
/**
 * Economy — the health scorecard (LHAW economics parity: target-band tiles + guidance), the live
 * price table (USD ↔ $WORD at the current peg), the fee-split matrix, per-archetype ROI, and the
 * sink-durability read. Everything derived from the economy sim + params (the tunable surface).
 */
import type { EconomyPayload } from "@/lib/admin/metrics";
import { fmtBps, fmtNum, fmtPct, fmtUsd, fmtWordCompact, WORD_USD_PRICE } from "@/lib/admin/format";
import { AdminCard, Banner, ErrorState, KeyVal, RefreshButton, Scorecard, SectionLabel, Spinner, useFetch } from "../ui";
import { Info } from "../icons";

export function EconomyTab() {
  const { data, loading, error, reload } = useFetch<EconomyPayload>("/api/admin/economy");
  if (loading && !data) return <Spinner />;
  if (error) return <ErrorState msg={error} onRetry={reload} />;
  if (!data) return null;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-lg font-extrabold">Economy</h2>
        <RefreshButton onClick={reload} loading={loading} />
      </div>

      <section>
        <SectionLabel>Health scorecard</SectionLabel>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          {data.scorecard.map((s) => (
            <Scorecard key={s.label} label={s.label} value={s.value} status={s.status} detail={s.detail} />
          ))}
        </div>
      </section>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <AdminCard title="Prices · USD-pegged">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-ink/45">
                <th className="pb-1">Action</th>
                <th className="pb-1 text-right">USD</th>
                <th className="pb-1 text-right">$WORD (at peg)</th>
              </tr>
            </thead>
            <tbody>
              {data.prices.map((p) => (
                <tr key={p.key} className="border-t-2 border-ink/10">
                  <td className="py-1.5 font-bold">{p.label}</td>
                  <td className="py-1.5 text-right tabular-nums">{fmtUsd(p.usd)}</td>
                  <td className="py-1.5 text-right font-mono text-xs tabular-nums">{fmtWordCompact(p.word)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-[11px] text-ink/45">
            Peg: 1 $WORD ≈ ${WORD_USD_PRICE.toExponential(2)}. Re-set the on-chain $WORD amounts in the Parameters
            tab as the price moves.
          </p>
        </AdminCard>

        <AdminCard title="Sink durability">
          <KeyVal k="$WORD routed/day (run-end)" v={fmtUsd(data.sink.grossRoutedFinal)} />
          <KeyVal k="$WORD routed/day (at mint-out)" v={data.sink.grossRoutedAtMintOut != null ? fmtUsd(data.sink.grossRoutedAtMintOut) : "—"} />
          <KeyVal k="Yield distributed/day (run-end)" v={fmtUsd(data.sink.distributionFinal)} />
          <KeyVal k="Avg jackpot payout" v={fmtUsd(data.sink.jackpotPaidAvg)} />
          <Banner tone="ok" icon={<Info weight="bold" size={14} />}>
            <span className="text-xs">
              After letters mint out, the economy runs on the durable recurring sinks — rolls and snacks. Watch the
              run-end vs mint-out routing to see whether activity persists past the completion cliff.
            </span>
          </Banner>
        </AdminCard>
      </div>

      <AdminCard title="Fee splits · bps into each bucket">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-ink/45">
                <th className="pb-1">Source</th>
                <th className="pb-1 text-right">Pool</th>
                <th className="pb-1 text-right">Jackpot</th>
                <th className="pb-1 text-right">Burn</th>
                <th className="pb-1 text-right">Treasury</th>
              </tr>
            </thead>
            <tbody>
              {data.splits.map((s) => (
                <tr key={s.id} className="border-t-2 border-ink/10">
                  <td className="py-1.5">
                    <span className="font-bold">{s.label}</span> <span className="text-[11px] text-ink/45">{s.note}</span>
                  </td>
                  <td className="py-1.5 text-right tabular-nums text-teal">{fmtBps(s.pool)}</td>
                  <td className="py-1.5 text-right tabular-nums text-gold-deep">{fmtBps(s.jackpot)}</td>
                  <td className="py-1.5 text-right tabular-nums text-candy">{fmtBps(s.burn)}</td>
                  <td className="py-1.5 text-right tabular-nums">{fmtBps(s.treasury)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[11px] text-ink/45">Each row must sum to 100%. Edit live in Parameters → FeeRouter → Set fee split.</p>
      </AdminCard>

      <AdminCard title="Player ROI by archetype">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-ink/45">
                <th className="pb-1">Archetype</th>
                <th className="pb-1 text-right">Players</th>
                <th className="pb-1 text-right">Spent</th>
                <th className="pb-1 text-right">Earned</th>
                <th className="pb-1 text-right">Recoup</th>
              </tr>
            </thead>
            <tbody>
              {data.roi.map((r) => (
                <tr key={r.archetype} className="border-t-2 border-ink/10">
                  <td className="py-1.5 font-bold capitalize">{r.archetype}</td>
                  <td className="py-1.5 text-right tabular-nums">{fmtNum(r.players)}</td>
                  <td className="py-1.5 text-right tabular-nums">{fmtUsd(r.spent)}</td>
                  <td className="py-1.5 text-right tabular-nums">{fmtUsd(r.earned)}</td>
                  <td className="py-1.5 text-right tabular-nums">{r.spent > 0 ? fmtPct(r.recoupPct, 0) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[11px] text-ink/45">
          A sink-heavy economy is net-negative in $WORD by design (burn + treasury capture value); the spread across
          archetypes is the signal. This sim omits secondary letter trading.
        </p>
      </AdminCard>

      <AdminCard title="What the sim found">
        <ul className="space-y-1.5">
          {data.notes.map((n) => (
            <li key={n} className="text-sm text-ink/75">• {n}</li>
          ))}
        </ul>
      </AdminCard>
    </div>
  );
}
