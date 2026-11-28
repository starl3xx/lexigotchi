"use client";
/**
 * The Jackpot page (the phone's "Win" tab): the daily jackpot, then the weekly bounty
 * (BountySection). Lexigotchi picks a secret word; hold it staked & fed → take the pot. Each half
 * is its own column from `lg`, the jackpot on the left; a phone stacks them, the jackpot first.
 *
 * **The secret word is a card** (decisions.md #50, part 4; starl3xx: "it reinforces that a card
 * has to be held, not individual letters"): face down until it is revealed (cards/FaceDownCard,
 * which is given nothing about the word), then face up. It was five dark tiles with a "?" on
 * each, and then the word as loose letters. A player who held it sees their own card: their
 * scene, their cases, their gilding.
 */
import type { ReactNode } from "react";
import { Button, Card, Countdown, SectionTitle, TweenNumber } from "../primitives";
import { DiceFive, Gift, SmileyMeh } from "../ui/icons";
import { EngravedMark } from "../EngravedMark";
import { fmtWord, hunger, jackpotEligible, useGame, type OwnedWord } from "../state";
import { BountySection } from "./BountySection";
import { FaceDownCard } from "../../cards/FaceDownCard";
import { SceneFrame } from "../../scenes/SceneFrame";
import { useWordScene } from "../../scenes/useWordScene";
import type { Gild } from "../TileCharacter";
import { DEFAULT_SCENE } from "@/lib/scenes";
import { useTierOf } from "../useRarity";

const PAST = ["MOTEL", "GRAPE", "QUILT"];

/** A card face up on the Jackpot page: it stands on the page as a card does, and it arrives without changing size. */
function FaceUp({ wide = false, children }: { wide?: boolean; children: ReactNode }) {
  return (
    <div className={`card-stand animate-drop mx-auto my-3 w-full ${wide ? "max-w-[20rem]" : "max-w-[15rem]"}`}>
      <div className="card-corner overflow-hidden border-[3px] border-ink">{children}</div>
    </div>
  );
}

/** The winner's own card, as they hold it: their scene, their cases, their gilding, and the letters cheering. */
function WonCard({ word }: { word: OwnedWord }) {
  const { scene } = useWordScene(word.word);
  const gild = Math.max(0, Math.min(5, Math.round(word.prestigeLevel))) as Gild;
  return (
    <FaceUp wide>
      <SceneFrame scene={scene} word={word.word} upper={word.upper} state="celebrate" gild={gild} tier={word.tier} />
    </FaceUp>
  );
}

export function JackpotScreen() {
  const tierOf = useTierOf();
  const g = useGame();
  const { state } = g;
  const tickets = state.words.filter(jackpotEligible);
  const ownedAnswer = state.words.find((w) => w.word === state.jackpotWord);
  const won = state.jackpotRevealed && !!ownedAnswer && jackpotEligible(ownedAnswer);

  return (
    <div className="space-y-5 lg:grid lg:grid-cols-2 lg:items-start lg:gap-4 lg:space-y-0">
      {/* the jackpot's column */}
      <div className="space-y-3 lg:space-y-4">
        {/* the draw */}
        <Card tint="gold" className="overflow-hidden text-center">
          <div className="text-sm font-bold text-ink/60">Daily jackpot</div>
          {!state.jackpotRevealed ? (
            <>
              <div className="fig my-1 text-4xl text-gold-deep">
                <TweenNumber value={state.jackpotPot} format={fmtWord} />
              </div>
              <div className="text-xs text-ink/60">$WORD · draws in <Countdown /></div>
              <FaceDownCard label="Today’s secret word: a card, face down" className="mx-auto my-4 max-w-[15rem]" />
              <Button
                full
                size="lg"
                variant="gold"
                onClick={() => {
                  const res = g.revealJackpot();
                  if (res === "win") g.toast("JACKPOT! You held the word", "good");
                  else if (res === "lose")
                    g.toast(
                      ownedAnswer ? "So close: you held it, but it wasn’t staked and awake" : "Not your word today. It rolls over",
                      ownedAnswer ? "bad" : "info",
                    );
                }}
              >
                <DiceFive weight="fill" /> Reveal today’s word
              </Button>
            </>
          ) : won ? (
            <div className="py-2">
              {/* No burst here: the winner's card is under these words, and its letters cheer with
                  their own engraved confetti (decisions.md #66, part 2). It was a bought icon that popped. */}
              <div className="font-display text-3xl font-extrabold text-gold-deep">JACKPOT!</div>
              <p className="text-sm text-ink/70">
                You held <strong>{state.jackpotWord}</strong>, staked &amp; awake. The pot is yours.
              </p>
              {ownedAnswer && <WonCard word={ownedAnswer} />}
            </div>
          ) : (
            <div className="py-2">
              <p className="text-sm text-ink/60">Today’s secret word was</p>
              {/* nobody's card: the word in the plain scene, in lowercase, with its rarity's frame */}
              <FaceUp>
                <SceneFrame scene={DEFAULT_SCENE} word={state.jackpotWord} upper={Array(5).fill(false)} tier={tierOf(state.jackpotWord)} small animated={false} />
              </FaceUp>
              <p className="text-sm">
                {ownedAnswer
                  ? "You owned it, but it wasn’t staked and awake. Wake your words!"
                  : "You didn’t hold it. The pot rolls over."}
              </p>
              <Button full variant="ghost" className="mt-3" onClick={g.skipDay}>
                On to tomorrow →
              </Button>
            </div>
          )}
        </Card>

        {/* your words in the running */}
        <Card>
          <SectionTitle action={<span className="text-xs text-ink/55">{tickets.length} in play</span>}>Your words in the running</SectionTitle>
          <p className="mb-2 text-xs text-ink/60">Every word that is staked and awake is in the running. If it’s today’s secret word, the pot is yours.</p>
          {tickets.length === 0 ? (
            <p className="text-sm text-candy-ink">None of your words is in the running. Stake one and wake it every day.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {tickets.map((w) => (
                <button
                  key={w.word}
                  onClick={() => g.openSheet({ kind: "word", word: w.word })}
                  className="cel-sm press inline-flex items-center gap-1 rounded-lg bg-card px-2 py-1 text-sm font-bold"
                >
                  {w.word}
                  {hunger(w) === "peckish" && <SmileyMeh weight="fill" size={13} className="text-gold-ink" />}
                </button>
              ))}
            </div>
          )}
        </Card>

        {/* LHAW bonus teaser: the practice game only. The bonus pool is a planned Phase-1 addition
            (decisions.md, "Jackpot architecture"); no contract pays it, so the real game must not
            promise it. The LHAW page already says each game pays its own pot. */}
        {!state.chainBacked && (
          <Card className="bg-teal/10">
            <div className="flex items-start gap-2">
              <Gift weight="fill" size={22} className="shrink-0 text-teal-ink" />
              <div>
                <div className="font-display font-extrabold">Bonus: Let’s Have A Word!</div>
                <p className="text-xs text-ink/60">
                  When an LHAW round’s secret word is one you simply <em>own</em>, you take a separate bonus pool. No
                  staking required.
                </p>
              </div>
            </div>
          </Card>
        )}

        {/* past winners */}
        <div>
          <SectionTitle>Recent jackpot words</SectionTitle>
          <div className="flex flex-wrap gap-2">
            {PAST.map((w) => (
              <span
                key={w}
                className="inline-flex items-center gap-1 rounded-lg border-2 border-ink bg-card px-2 py-1 font-display text-sm font-bold text-gold-ink"
              >
                <EngravedMark kind="star" size={13} className="text-ink" /> {w}
              </span>
            ))}
          </div>
        </div>
      </div>

      <BountySection />
    </div>
  );
}
