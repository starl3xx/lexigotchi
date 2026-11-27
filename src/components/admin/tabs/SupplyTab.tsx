"use client";
/**
 * Supply & Rarity — the on-chain supply ceilings and rarity structure, derived (never hardcoded)
 * from the canonical dictionary. Per-letter caps are exactly the uint32[26] passed to the Letters
 * constructor (config/economy.json), so this is the operator's view of mint-out pressure.
 */
import {
  ALPHABET,
  LETTERS_BY_FREQUENCY,
  LETTER_SUPPLY_CAP,
  DEMAND_MULTIPLE,
  TOTAL_SUPPLY_CAP,
  TIERS,
  TIER_COUNTS,
  TIER_WEIGHT,
  MYTHICS,
  DOUBLED_ULTRA_RARES,
  Q_WORDS,
} from "@/lib/economy";
import { WORD_COUNT } from "@/lib/dictionary";
import { fmtNum } from "@/lib/admin/format";
import { AdminCard, MetricCard, SectionLabel, useFetch } from "../ui";
import type { LivePayload } from "@/app/api/admin/live/route";
import { DEFAULT_PARAMS } from "@/lib/params";
import { BarsChart } from "../charts";
import { Crown, Sparkle, Stack, Package } from "../icons";

const RAREST = new Set(LETTERS_BY_FREQUENCY.slice(-5)); // 5 scarcest letters
const tightest = [...ALPHABET].sort((a, b) => LETTER_SUPPLY_CAP[a] - LETTER_SUPPLY_CAP[b])[0];

export function SupplyTab() {
  const capData = ALPHABET.map((L) => ({ label: L, value: LETTER_SUPPLY_CAP[L] }));
  // The live free-letter ledger and claimed words (decisions.md #21), from the open live route.
  const { data: live } = useFetch<LivePayload>("/api/admin/live");
  const fl = live?.freeLetters ?? null;
  const claimedShare = live?.words ? live.words.claimed / live.words.dictionary : null;

  return (
    <div className="space-y-6">
      <h2 className="font-display text-lg font-extrabold">Supply &amp; Rarity</h2>

      <section>
        <SectionLabel>At a glance</SectionLabel>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <MetricCard
            icon={<Stack weight="bold" size={14} />}
            label="Claimable words"
            value={fmtNum(live?.words?.dictionary ?? WORD_COUNT)}
            sub={live?.words?.held ? `of ${fmtNum(WORD_COUNT)} · ${fmtNum(live.words.held)} held back in sets` : "the full dictionary"}
          />
          <MetricCard icon={<Package weight="bold" size={14} />} label="Letter supply cap" value={fmtNum(TOTAL_SUPPLY_CAP)} sub={`across 26 ids · ${DEMAND_MULTIPLE}× demand (mainnet; Sepolia keeps 2.5×)`} />
          <MetricCard icon={<Sparkle weight="bold" size={14} />} label="Tightest letter" tone="warning" value={`${tightest} · ${fmtNum(LETTER_SUPPLY_CAP[tightest])}`} sub="first to mint out" />
          <MetricCard icon={<Crown weight="bold" size={14} />} label="Mythic words" tone="warning" value={fmtNum(MYTHICS.length)} sub="apex-rarity words" />
        </div>
      </section>

      <section>
        <SectionLabel>Free letters (live)</SectionLabel>
        {live && !live.live ? (
          <p className="text-sm text-ink/55">No deployment on this network: the free letters are signed by the live game only.</p>
        ) : (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <MetricCard
              icon={<Package weight="bold" size={14} />}
              label="Free letters signed"
              value={fl ? fmtNum(fl.signed) : "–"}
              sub={fl ? `${fmtNum(fl.packs)} packs · ${fmtNum(fl.dailies)} dailies · ${fmtNum(fl.pending)} unsettled` : "needs migration 0015"}
            />
            <MetricCard
              icon={<Stack weight="bold" size={14} />}
              label="Budget left"
              tone={fl && fl.remaining < fl.budget * 0.1 ? "warning" : undefined}
              value={fl ? fmtNum(fl.remaining) : "–"}
              sub={fl ? `of ${fmtNum(fl.budget)} (FREE_LETTER_BUDGET)` : "–"}
            />
            <MetricCard
              icon={<Sparkle weight="bold" size={14} />}
              label="Free daily limit"
              value={fmtNum(fl?.dailyLimit ?? DEFAULT_PARAMS.freeLetters.freeDailyLimit)}
              sub="per profile, one a day"
            />
            <MetricCard
              icon={<Crown weight="bold" size={14} />}
              label="Dictionary claimed"
              tone={claimedShare !== null && claimedShare >= DEFAULT_PARAMS.freeLetters.freeStopClaimedFraction ? "warning" : undefined}
              value={claimedShare !== null ? `${(claimedShare * 100).toFixed(1)}%` : "–"}
              sub={`free letters stop at ${Math.round(DEFAULT_PARAMS.freeLetters.freeStopClaimedFraction * 100)}%${live?.words ? ` · ${fmtNum(live.words.claimed)} of ${fmtNum(live.words.dictionary)}` : ""}`}
            />
          </div>
        )}
      </section>

      <BarsChart
        title="Per-letter supply cap (gold = the 5 scarcest)"
        data={capData}
        colorFor={(d) => (RAREST.has(d.label) ? "#e0a93b" : "#2a9d8f")}
        height={240}
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <AdminCard title="Rarity tiers">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-ink/45">
                <th className="pb-1">Tier</th>
                <th className="pb-1 text-right">Words</th>
                <th className="pb-1 text-right">Stake weight</th>
              </tr>
            </thead>
            <tbody>
              {TIERS.map((t) => (
                <tr key={t.name} className="border-t-2 border-ink/10">
                  <td className="py-1.5 font-bold">{t.name}</td>
                  <td className="py-1.5 text-right tabular-nums">{fmtNum(TIER_COUNTS[t.name] ?? 0)}</td>
                  <td className="py-1.5 text-right tabular-nums">{TIER_WEIGHT[t.name]}×</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-[11px] text-ink/45">
            Rarer tiers carry more stake weight (Common 1 → Mythic 8); UPPERCASE doubles it again.
          </p>
        </AdminCard>

        <AdminCard title="Crowns">
          <p className="text-sm text-ink/75">
            <strong>JAZZY</strong> is the apex crown — the only word combining two distinct ultra-rares with a double
            letter. {Q_WORDS.length} words contain a Q.
          </p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {DOUBLED_ULTRA_RARES.map((w) => (
              <span key={w} className="rounded-lg border-2 border-ink bg-gold/25 px-2 py-0.5 text-xs font-bold text-gold-deep">
                {w}
              </span>
            ))}
          </div>
        </AdminCard>
      </div>

      <AdminCard title={`Mythic words · ${MYTHICS.length}`}>
        <div className="flex flex-wrap gap-1.5">
          {MYTHICS.map((w) => (
            <span key={w} className="rounded-lg border-2 border-ink bg-paper-dark/60 px-2 py-0.5 text-xs font-bold">
              {w}
            </span>
          ))}
        </div>
      </AdminCard>
    </div>
  );
}
