import { WORD_COUNT } from "@/lib/dictionary";
import {
  TIERS,
  TIER_COUNTS,
  LETTERS_BY_FREQUENCY,
  LETTER_SLOTS,
  LETTER_ODDS,
  LETTER_SUPPLY_CAP,
  TOTAL_SLOTS,
  TOTAL_SUPPLY_CAP,
  LEGENDARIES,
  Q_WORDS,
  wordsByTier,
} from "@/lib/economy";

const TIER_COLOR: Record<string, string> = {
  Common: "#8a8a8a",
  Uncommon: "#2a9d8f",
  Rare: "#3b6fd8",
  Epic: "#7b4ea3",
  Legendary: "#e0a93b",
};

export default function LexidexPage() {
  return (
    <div className="space-y-10">
      <header className="space-y-2">
        <h1 className="font-display text-3xl font-extrabold">The Lexidex</h1>
        <p className="max-w-2xl text-ink/80">
          The album: all {WORD_COUNT.toLocaleString()} claimable words, their rarity tier,
          and the letter economy underneath. Every number here is computed from the
          canonical dictionary and asserted against the spec in tests — it cannot drift.
        </p>
      </header>

      <section className="space-y-3">
        <h2 className="font-display text-2xl font-extrabold">Rarity tiers</h2>
        <div className="overflow-hidden rounded-lg cel bg-paper">
          <table className="w-full text-sm">
            <thead className="bg-paper-dark text-left font-display">
              <tr>
                <th className="px-4 py-2">Tier</th>
                <th className="px-4 py-2 text-right">Words</th>
                <th className="px-4 py-2 text-right">Share</th>
                <th className="px-4 py-2 text-right">Stake weight</th>
                <th className="px-4 py-2">Sample</th>
              </tr>
            </thead>
            <tbody>
              {TIERS.map((t) => (
                <tr key={t.name} className="border-t-2 border-ink/10">
                  <td className="px-4 py-2 font-bold" style={{ color: TIER_COLOR[t.name] }}>
                    {t.name}
                  </td>
                  <td className="px-4 py-2 text-right">{TIER_COUNTS[t.name].toLocaleString()}</td>
                  <td className="px-4 py-2 text-right">
                    {((TIER_COUNTS[t.name] / WORD_COUNT) * 100).toFixed(1)}%
                  </td>
                  <td className="px-4 py-2 text-right">{t.weight}×</td>
                  <td className="px-4 py-2 text-ink/70">
                    {wordsByTier(t.name).slice(0, 3).join(", ")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="font-display text-2xl font-extrabold">The {LEGENDARIES.length} Legendaries</h2>
        <div className="flex flex-wrap gap-1.5">
          {LEGENDARIES.map((w, i) => (
            <span
              key={w}
              className="tile px-2 py-1 font-display text-sm font-bold"
              title={`#${i + 1} rarest`}
              style={{ background: "#e0a93b" }}
            >
              {w}
            </span>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="font-display text-2xl font-extrabold">Letter economy</h2>
        <p className="text-sm text-ink/70">
          {TOTAL_SLOTS.toLocaleString()} letter slots · mint odds mirror dictionary demand ·
          supply caps at 2.5× ({TOTAL_SUPPLY_CAP.toLocaleString()} letters). Q is the
          Charizard at {LETTER_SLOTS.Q} slots.
        </p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
          {LETTERS_BY_FREQUENCY.map((L) => (
            <div key={L} className="cel flex items-center gap-3 rounded-lg bg-paper p-2">
              <span className="tile flex h-10 w-10 items-center justify-center font-display text-lg font-extrabold">
                {L}
              </span>
              <div className="text-xs">
                <div className="font-bold">{(LETTER_ODDS[L] * 100).toFixed(2)}% pull</div>
                <div className="text-ink/60">
                  {LETTER_SLOTS[L].toLocaleString()} slots · cap {LETTER_SUPPLY_CAP[L].toLocaleString()}
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="font-display text-2xl font-extrabold">All {Q_WORDS.length} Q-words</h2>
        <div className="flex flex-wrap gap-1.5">
          {[...Q_WORDS].sort().map((w) => (
            <span key={w} className="tile px-2 py-1 font-display text-sm font-bold">
              {w}
            </span>
          ))}
        </div>
      </section>
    </div>
  );
}
