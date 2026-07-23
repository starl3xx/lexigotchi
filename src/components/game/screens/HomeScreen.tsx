"use client";
/** Today — the daily hub: care alert, daily letter, jackpot teaser, bounty, quick actions. */
import { Button, Card, Countdown, SectionTitle } from "../primitives";
import {
  ArrowsLeftRight,
  Backpack,
  BookOpen,
  Check,
  Cookie,
  Eye,
  Fire,
  MaskHappy,
  Medal,
  Smiley,
  Sparkle,
  TextAa,
  Ticket,
  Trophy,
} from "../ui/icons";
import { COST, THEMES, fmtWord, hunger, jackpotEligible, useGame, type View } from "../state";
import { useViewer } from "../useViewer";

export function HomeScreen() {
  const g = useGame();
  const { state } = g;
  const viewer = useViewer();
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
          <Trophy weight="fill" size={40} className="text-gold-deep" />
        </div>
        <div className="mt-3 rounded-xl border-2 border-dashed border-ink/30 p-2 text-center text-sm">
          {state.jackpotRevealed ? (
            <span>
              Today&apos;s word was <strong className="font-display">{state.jackpotWord}</strong>
            </span>
          ) : ownsAnswer && jackpotEligible(ownsAnswer) ? (
            <span className="inline-flex items-center gap-1 font-bold text-candy">
              You may be holding today&apos;s secret word <Eye weight="fill" size={14} />
            </span>
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
                {needFood.length} {needFood.length === 1 ? "word needs" : "words need"} feeding
              </div>
              <div className="text-xs text-ink/60">
                Peckish words earn half; hungry ones (3+ days) earn nothing and can&apos;t win the jackpot.
              </div>
            </div>
            <Button variant="teal" onClick={g.feedAll}>
              <Cookie weight="fill" /> Feed all
            </Button>
          </div>
        </Card>
      ) : (
        <Card className="flex items-center justify-between bg-teal/10">
          <div className="font-display font-bold">Your collection is fed</div>
          <Smiley weight="fill" size={26} className="text-teal" />
        </Card>
      )}

      {/* daily letter */}
      <Card>
        <SectionTitle>Daily letter</SectionTitle>
        {state.dailyMinted ? (
          <div className="flex items-center justify-between text-sm">
            <span className="inline-flex items-center gap-1 text-ink/70">
              Claimed today <Check weight="bold" size={13} className="text-teal" /> · streak{" "}
              <Fire weight="fill" size={13} className="text-candy" /> {state.streak}
            </span>
            <span className="text-xs text-ink/50">resets in <Countdown /></span>
          </div>
        ) : !viewer.isAuthed ? (
          // The daily single is FID-gated (v0.2 §5.3) — mirror the Mint screen so a signed-out web
          // player can't claim it (and bump their streak) from here. Inside a Farcaster client the
          // viewer is auto-authed, so this branch never shows.
          <div className="flex items-center justify-between gap-3">
            <div className="text-sm text-ink/70">
              One free letter a day — the daily is FID-gated.
              <div className="text-xs text-ink/50">
                {viewer.environment === "loading" ? "Checking your Farcaster…" : "Connect Farcaster to unlock it."}
              </div>
            </div>
            <Button variant="teal" disabled={viewer.environment === "loading"} onClick={viewer.signIn}>
              <Ticket weight="fill" /> Connect
            </Button>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-3">
            <div className="text-sm text-ink/70">
              One free pull a day keeps the streak alive.
              <div className="text-xs text-ink/50">Free · on the house</div>
            </div>
            <Button
              variant="primary"
              onClick={() => {
                const idx = g.dailyMint();
                // the daily is FREE (COST.daily = 0), so the only null case is "already pulled"
                if (idx === null) g.toast("Already claimed today", "info");
              }}
            >
              <Ticket weight="fill" /> Pull
            </Button>
          </div>
        )}
      </Card>

      {/* bounty teaser */}
      <button onClick={() => g.nav("bounty")} className="w-full text-left">
        <Card className="bg-teal/10 transition-all active:translate-x-[2px] active:translate-y-[2px] active:shadow-none">
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="text-xs font-bold uppercase tracking-wide text-teal">This week&apos;s bounty</div>
              <div className="font-display font-extrabold">{theme.name}</div>
              <div className="text-xs text-ink/60">Hold matching words, staked &amp; fed, to share the pool.</div>
            </div>
            <Medal weight="fill" size={30} className="shrink-0 text-teal" />
          </div>
        </Card>
      </button>

      {/* quick actions */}
      <SectionTitle>Do something</SectionTitle>
      <div className="grid grid-cols-2 gap-3">
        <Quick Icon={Sparkle} label="Mint letters" sub="packs & daily" to="mint" />
        <Quick Icon={TextAa} label="Spell a word" sub="claim it forever" to="claim" />
        <Quick Icon={BookOpen} label="Lexidex" sub="4,438 words" to="lexidex" />
        <Quick Icon={MaskHappy} label="Showcase" sub="flex & cast" to="showcase" />
        <Quick Icon={ArrowsLeftRight} label="Swap" sub="trade letters" to="swap" />
        <Quick Icon={Backpack} label="My bag" sub="letters & words" to="bag" />
      </div>
    </div>
  );
}

function Quick({ Icon, label, sub, to }: { Icon: typeof Sparkle; label: string; sub: string; to: View }) {
  const { nav } = useGame();
  return (
    <button
      onClick={() => nav(to)}
      className="cel flex flex-col gap-1 rounded-2xl bg-paper p-3 text-left transition-all active:translate-x-[2px] active:translate-y-[2px] active:shadow-none"
    >
      <Icon size={26} weight="bold" className="text-candy" />
      <span className="font-display text-sm font-extrabold leading-tight">{label}</span>
      <span className="text-[11px] text-ink/55">{sub}</span>
    </button>
  );
}
