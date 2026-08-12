"use client";
/** Win — the daily jackpot. Lexigotchi picks a secret word; hold it staked & fed → take the pot. */
import { Button, Card, Countdown, SectionTitle } from "../primitives";
import { WordTiles } from "../LetterTile";
import { Confetti, DiceFive, Gift, SmileyMeh, Star } from "../ui/icons";
import { fmtWord, hunger, jackpotEligible, useGame } from "../state";

const PAST = ["MOTEL", "GRAPE", "QUILT"];

export function JackpotScreen() {
  const g = useGame();
  const { state } = g;
  const tickets = state.words.filter(jackpotEligible);
  const ownedAnswer = state.words.find((w) => w.word === state.jackpotWord);
  const won = state.jackpotRevealed && !!ownedAnswer && jackpotEligible(ownedAnswer);

  return (
    <div className="space-y-3">
      {/* the draw */}
      <Card className="overflow-hidden bg-gradient-to-b from-gold/20 to-paper text-center">
        <div className="text-xs font-bold uppercase tracking-wide text-ink/60">Daily jackpot</div>
        {!state.jackpotRevealed ? (
          <>
            <div className="my-1 font-display text-4xl font-extrabold text-gold-deep">{fmtWord(state.jackpotPot)}</div>
            <div className="text-xs text-ink/60">$WORD · draws in <Countdown /></div>
            <div className="my-4 flex justify-center gap-1.5">
              {Array.from({ length: 5 }).map((_, i) => (
                <div
                  key={i}
                  className="flex h-12 w-12 items-center justify-center rounded-lg border-[3px] border-ink bg-ink/80 font-display text-2xl text-paper"
                >
                  ?
                </div>
              ))}
            </div>
            <Button
              full
              size="lg"
              variant="gold"
              onClick={() => {
                const res = g.revealJackpot();
                if (res === "win") g.toast("JACKPOT! You held the word", "good");
                else if (res === "lose")
                  g.toast(
                    ownedAnswer ? "So close — you held it, but not staked & fed" : "Not your word today — it rolls over",
                    ownedAnswer ? "bad" : "info",
                  );
              }}
            >
              <DiceFive weight="fill" /> Reveal today&apos;s word
            </Button>
          </>
        ) : won ? (
          <div className="py-2">
            <Confetti weight="fill" size={48} className="mx-auto animate-pop text-gold-deep" />
            <div className="font-display text-3xl font-extrabold text-gold-deep">JACKPOT!</div>
            <p className="text-sm text-ink/70">
              You held <strong>{state.jackpotWord}</strong>, staked &amp; fed. The pot is yours.
            </p>
            <div className="my-3 flex justify-center">
              <WordTiles word={state.jackpotWord} upper={Array(5).fill(true)} state="celebrate" size={54} detail="bust" />
            </div>
          </div>
        ) : (
          <div className="py-2">
            <p className="text-sm text-ink/60">Today&apos;s secret word was</p>
            <div className="my-2 flex justify-center">
              <WordTiles word={state.jackpotWord} upper={Array(5).fill(false)} size={40} />
            </div>
            <p className="text-sm">
              {ownedAnswer
                ? "You owned it — but it wasn't staked & fed. Feed your words!"
                : "You didn't hold it. The pot rolls over."}
            </p>
            <Button full variant="ghost" className="mt-3" onClick={g.skipDay}>
              On to tomorrow →
            </Button>
          </div>
        )}
      </Card>

      {/* your tickets */}
      <Card>
        <SectionTitle action={<span className="text-xs text-ink/55">{tickets.length} in play</span>}>Your tickets</SectionTitle>
        <p className="mb-2 text-xs text-ink/60">Any staked, not-hungry word is a ticket. If it&apos;s today&apos;s secret word, you win.</p>
        {tickets.length === 0 ? (
          <p className="text-sm text-candy">No eligible words — stake &amp; feed to get in the draw.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {tickets.map((w) => (
              <button
                key={w.word}
                onClick={() => g.openSheet({ kind: "word", word: w.word })}
                className="inline-flex items-center gap-1 rounded-lg border-2 border-ink bg-paper px-2 py-1 text-sm font-bold"
              >
                {w.word}
                {hunger(w) === "peckish" && <SmileyMeh weight="fill" size={13} className="text-gold-deep" />}
              </button>
            ))}
          </div>
        )}
      </Card>

      {/* LHAW bonus teaser */}
      <Card className="bg-teal/10">
        <div className="flex items-start gap-2">
          <Gift weight="fill" size={22} className="shrink-0 text-teal" />
          <div>
            <div className="font-display font-extrabold">Bonus: Let&apos;s Have A Word!</div>
            <p className="text-xs text-ink/60">
              When an LHAW round&apos;s secret word is one you simply <em>own</em>, you take a separate bonus pool — no
              staking required.
            </p>
          </div>
        </div>
      </Card>

      {/* past winners */}
      <div>
        <SectionTitle>Recent winning words</SectionTitle>
        <div className="flex flex-wrap gap-2">
          {PAST.map((w) => (
            <span
              key={w}
              className="inline-flex items-center gap-1 rounded-lg border-2 border-ink bg-paper px-2 py-1 font-display text-sm font-bold text-gold-deep"
            >
              <Star weight="fill" size={12} /> {w}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
