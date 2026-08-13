"use client";
/** Bounty — the weekly featured category. Hold matching words, staked & fed, to share the pool. */
import { TIER_WEIGHT } from "@/lib/economy";
import { Button, Card, EmptyState, SectionTitle } from "../primitives";
import { WordCard } from "../WordCard";
import { MagnifyingGlass, Medal } from "../ui/icons";
import { THEMES, fmtWord, hunger, useGame } from "../state";

// Mock-flavor leaderboard — hidden on chain, where no such feed exists yet (absent beats fake).
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

  // The pot is real on chain (FeeRouter.bountyBalance); the share preview needs the whole field's
  // weight, which only the mock invents — so the projection renders mock-only.
  const POOL = state.bountyPool;
  const myWeight = eligible.reduce((a, w) => a + TIER_WEIGHT[w.tier], 0);
  const fieldWeight = 240; // mock total field weight
  const share = state.chainBacked ? 0 : myWeight / (fieldWeight + myWeight);
  const claimTotal = g.claimables.reduce((a, c) => a + c.amount, 0);

  return (
    <div className="space-y-3">
      <Card className="bg-gradient-to-b from-teal/15 to-paper">
        <div className="flex items-start justify-between">
          <div>
            <div className="text-xs font-bold uppercase tracking-wide text-teal">This week&apos;s bounty</div>
            <div className="font-display text-xl font-extrabold">{theme.name}</div>
          </div>
          <Medal weight="fill" size={40} className="text-teal" />
        </div>
        <div className="mt-2 flex items-end justify-between">
          <div>
            <div className="font-display text-2xl font-extrabold text-teal">{fmtWord(POOL)}</div>
            <div className="text-xs text-ink/60">pool · fresh theme each week</div>
          </div>
          {!state.chainBacked && (
            <div className="text-right">
              <div className="font-display text-lg font-extrabold">~{fmtWord(POOL * share)}</div>
              <div className="text-xs text-ink/60">your projected cut</div>
            </div>
          )}
        </div>
      </Card>

      {/* claimable earnings — the keeper's published epochs (yield + bounty), union-bag wide */}
      {state.chainBacked && g.claimables.length > 0 && (
        <Card className="border-gold bg-gold/10">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="font-display font-extrabold">
                {fmtWord(claimTotal)} $WORD to claim
              </div>
              <div className="text-xs text-ink/60">
                {g.claimables.length} reward{g.claimables.length === 1 ? "" : "s"} across yield + bounty epochs —
                each pays its own wallet, so one tap collects for your whole bag.
              </div>
            </div>
            <Button variant="gold" onClick={() => g.claimEarnings()}>
              Claim all
            </Button>
          </div>
        </Card>
      )}

      <Card>
        <SectionTitle action={<span className="text-xs text-ink/55">{eligible.length}/{matching.length} eligible</span>}>
          Your matching words
        </SectionTitle>
        <p className="mb-2 text-xs text-ink/60">
          Must be <strong>staked &amp; not hungry</strong>. Rarer matches earn a bigger slice (tier-weighted).
        </p>
        {matching.length === 0 ? (
          <EmptyState Icon={MagnifyingGlass} title="No matches yet" sub="Claim or raise words that fit the theme to get in." />
        ) : (
          <div className="space-y-2">
            {matching.map((w) => <WordCard key={w.word} word={w} />)}
          </div>
        )}
        <Button full variant="teal" className="mt-3" onClick={() => g.nav("claim")}>
          Spell a matching word →
        </Button>
      </Card>

      {!state.chainBacked && (
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
      )}
    </div>
  );
}
