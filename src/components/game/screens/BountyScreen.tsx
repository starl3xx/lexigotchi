"use client";
/** Bounty — the weekly featured category. Hold matching words, staked & fed, to share the pool. */
import { TIER_WEIGHT } from "@/lib/economy";
import { Button, Card, EmptyState, SectionTitle } from "../primitives";
import { WordCard } from "../WordCard";
import { THEMES, fmtWord, hunger, useGame } from "../state";

const POOL = 9_400_000;
const LEADERBOARD = [
  { who: "wordsmith.eth", n: 11 },
  { who: "@gridlock", n: 8 },
  { who: "vowelhoarder", n: 6 },
];

export function BountyScreen() {
  const g = useGame();
  const { state } = g;
  const theme = THEMES[state.bountyTheme];
  const matching = state.words.filter((w) => theme.test(w.word));
  const eligible = matching.filter((w) => w.staked && hunger(w) !== "hungry");

  // rarity-weighted share preview (mirrors the sim's tier-proportional default)
  const myWeight = eligible.reduce((a, w) => a + TIER_WEIGHT[w.tier], 0);
  const fieldWeight = 240; // mock total field weight
  const share = myWeight / (fieldWeight + myWeight);

  return (
    <div className="space-y-3">
      <Card className="bg-gradient-to-b from-teal/15 to-paper">
        <div className="flex items-start justify-between">
          <div>
            <div className="text-xs font-bold uppercase tracking-wide text-teal">This week&apos;s bounty</div>
            <div className="font-display text-xl font-extrabold">{theme.name}</div>
          </div>
          <span className="text-4xl" aria-hidden>🏅</span>
        </div>
        <div className="mt-2 flex items-end justify-between">
          <div>
            <div className="font-display text-2xl font-extrabold text-teal">{fmtWord(POOL)}</div>
            <div className="text-xs text-ink/60">pool · fresh theme each week</div>
          </div>
          <div className="text-right">
            <div className="font-display text-lg font-extrabold">~{fmtWord(POOL * share)}</div>
            <div className="text-xs text-ink/60">your projected cut</div>
          </div>
        </div>
      </Card>

      <Card>
        <SectionTitle action={<span className="text-xs text-ink/55">{eligible.length}/{matching.length} eligible</span>}>
          Your matching words
        </SectionTitle>
        <p className="mb-2 text-xs text-ink/60">
          Must be <strong>staked &amp; not hungry</strong>. Rarer matches earn a bigger slice (tier-weighted).
        </p>
        {matching.length === 0 ? (
          <EmptyState emoji="🔍" title="No matches yet" sub="Claim or raise words that fit the theme to get in." />
        ) : (
          <div className="space-y-2">
            {matching.map((w) => <WordCard key={w.id} word={w} />)}
          </div>
        )}
        <Button full variant="teal" className="mt-3" onClick={() => g.nav("claim")}>
          Spell a matching word →
        </Button>
      </Card>

      <Card>
        <SectionTitle>Leaderboard</SectionTitle>
        <div className="space-y-1.5">
          {[{ who: "you", n: eligible.length }, ...LEADERBOARD]
            .sort((a, b) => b.n - a.n)
            .map((r, i) => (
              <div
                key={r.who}
                className={`flex items-center justify-between rounded-lg border-2 border-ink px-3 py-1.5 text-sm ${r.who === "you" ? "bg-candy/15 font-extrabold" : "bg-paper"}`}
              >
                <span className="flex items-center gap-2">
                  <span className="font-display text-ink/50">#{i + 1}</span>
                  {r.who}
                </span>
                <span className="font-bold">{r.n} words</span>
              </div>
            ))}
        </div>
      </Card>
    </div>
  );
}
