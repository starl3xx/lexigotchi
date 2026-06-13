"use client";
/** Today — the daily hub: care alert, daily letter, jackpot teaser, bounty, quick actions. */
import { Button, Card, Countdown, SectionTitle } from "../primitives";
import { COST, THEMES, fmtWord, hunger, jackpotEligible, useGame, type View } from "../state";

export function HomeScreen() {
  const g = useGame();
  const { state } = g;
  const needFood = state.words.filter((w) => w.staked && hunger(w) !== "fed");
  const ownsAnswer = state.words.find((w) => w.word === state.jackpotWord);
  const theme = THEMES[state.bountyTheme];

  return (
    <div className="space-y-3">
      {/* hero — daily jackpot */}
      <Card className="bg-gradient-to-b from-paper to-gold/15">
        <div className="flex items-start justify-between">
          <div>
            <div className="text-xs font-bold uppercase tracking-wide text-ink/60">Today&apos;s jackpot</div>
            <div className="font-display text-3xl font-extrabold text-gold-deep">{fmtWord(state.jackpotPot)}</div>
            <div className="text-xs text-ink/60">$WORD · draws in <Countdown /></div>
          </div>
          <div className="text-4xl" aria-hidden>🎰</div>
        </div>
        <div className="mt-3 rounded-xl border-2 border-dashed border-ink/30 p-2 text-center text-sm">
          {state.jackpotRevealed ? (
            <span>
              Today&apos;s word was <strong className="font-display">{state.jackpotWord}</strong>
            </span>
          ) : ownsAnswer && jackpotEligible(ownsAnswer) ? (
            <span className="font-bold text-candy">You may be holding today&apos;s secret word 👀</span>
          ) : ownsAnswer ? (
            <span className="font-bold text-candy">You hold today&apos;s word — stake &amp; feed it to be in the draw!</span>
          ) : (
            <span className="text-ink/60">The secret word is hidden until the draw.</span>
          )}
        </div>
        <Button full variant="gold" className="mt-3" onClick={() => g.nav("jackpot")}>
          Open the jackpot
        </Button>
      </Card>

      {/* care alert */}
      {needFood.length > 0 ? (
        <Card className="bg-candy/10">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="font-display font-extrabold">
                {needFood.length} {needFood.length === 1 ? "word is" : "words are"} hungry
              </div>
              <div className="text-xs text-ink/60">Hungry words stop earning and can&apos;t win the jackpot.</div>
            </div>
            <Button variant="teal" onClick={g.feedAll}>🍪 Feed all</Button>
          </div>
        </Card>
      ) : (
        <Card className="flex items-center justify-between bg-teal/10">
          <div className="font-display font-bold">Your collection is fed 😊</div>
          <span className="text-2xl" aria-hidden>🍪</span>
        </Card>
      )}

      {/* daily letter */}
      <Card>
        <SectionTitle>Daily letter</SectionTitle>
        {state.dailyMinted ? (
          <div className="flex items-center justify-between text-sm">
            <span className="text-ink/70">Claimed today ✓ · streak 🔥 {state.streak}</span>
            <span className="text-xs text-ink/50">resets in <Countdown /></span>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-3">
            <div className="text-sm text-ink/70">
              One free-ish pull a day keeps the streak alive.
              <div className="text-xs text-ink/50">{fmtWord(COST.daily)} $WORD · FID-gated</div>
            </div>
            <Button
              variant="primary"
              disabled={!g.canAfford(COST.daily)}
              onClick={() => {
                const idx = g.dailyMint();
                if (idx === null) g.toast(state.dailyMinted ? "Already claimed today" : "Not enough $WORD for the daily", "info");
              }}
            >
              Pull 🎟
            </Button>
          </div>
        )}
      </Card>

      {/* bounty teaser */}
      <button onClick={() => g.nav("bounty")} className="w-full text-left">
        <Card className="bg-teal/10 transition-all active:translate-x-[2px] active:translate-y-[2px] active:shadow-none">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs font-bold uppercase tracking-wide text-teal">This week&apos;s bounty</div>
              <div className="font-display font-extrabold">{theme.name}</div>
              <div className="text-xs text-ink/60">Hold matching words, staked &amp; fed, to share the pool.</div>
            </div>
            <span className="text-2xl" aria-hidden>🏅</span>
          </div>
        </Card>
      </button>

      {/* quick actions */}
      <SectionTitle>Do something</SectionTitle>
      <div className="grid grid-cols-2 gap-3">
        <Quick icon="✨" label="Mint letters" sub="packs & daily" to="mint" />
        <Quick icon="🔤" label="Spell a word" sub="claim it forever" to="claim" />
        <Quick icon="📖" label="Lexidex" sub="4,438 words" to="lexidex" />
        <Quick icon="🎭" label="Showcase" sub="flex & cast" to="showcase" />
        <Quick icon="🔁" label="Swap" sub="trade letters" to="swap" />
        <Quick icon="🎒" label="My bag" sub="letters & words" to="bag" />
      </div>
    </div>
  );
}

function Quick({ icon, label, sub, to }: { icon: string; label: string; sub: string; to: View }) {
  const { nav } = useGame();
  return (
    <button onClick={() => nav(to)} className="cel flex flex-col gap-0.5 rounded-2xl bg-paper p-3 text-left transition-all active:translate-x-[2px] active:translate-y-[2px] active:shadow-none">
      <span className="text-2xl" aria-hidden>{icon}</span>
      <span className="font-display text-sm font-extrabold leading-tight">{label}</span>
      <span className="text-[11px] text-ink/55">{sub}</span>
    </button>
  );
}
