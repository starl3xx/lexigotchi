"use client";
/**
 * "Your next steps" on the Today tab: each row says what the player can do and does it from here
 * (the rules live in todaySteps.ts). Hidden when there is nothing to do.
 */
import { useState, type ReactNode } from "react";
import { Button, Card, SectionTitle } from "./primitives";
import { Coins, Crown, Sparkle, Ticket, TextAa } from "./ui/icons";
import { fmtWord, hunger, mineLower, mineUpper, useGame } from "./state";
import { pickStage } from "./stagePick";
import { nextSteps, type NextStep } from "./todaySteps";
import { useTakenWords } from "./useTodayPlan";

/** Rows shown before "Show more": a list of five read as a to-do list, not a nudge. */
const SHOWN = 3;

export function NextSteps() {
  const g = useGame();
  const { state } = g;
  const [all, setAll] = useState(false);
  const taken = useTakenWords();
  if (state.status !== "ready") return null;

  // Don't ask twice: the Today stage already asks for an unstaked star to be staked, and for a
  // brand-new player the stage and the letters card both point at getting letters ("start").
  const staged = pickStage(state.words, (w) => hunger(w));
  const stagedStake = staged?.mood === "unstaked" ? staged.word.word : null;
  const steps = nextSteps({
    words: state.words,
    claimables: g.claimables,
    lower: mineLower(state),
    upper: mineUpper(state),
    bagLetters: state.lower.reduce((a, b) => a + b, 0) + state.upper.reduce((a, b) => a + b, 0),
    pity: state.pity,
    rollProb: g.rollProb,
    taken,
  }).filter((s) => !(s.kind === "stake" && s.word === stagedStake) && s.kind !== "start");
  if (steps.length === 0) return null;
  const visible = all ? steps : steps.slice(0, SHOWN);
  const hidden = steps.length - visible.length;

  const claim = g.price("claim");
  const roll = g.price("roll");
  const getWord = (amount: number, action: string) => g.openSheet({ kind: "balance", need: { amount, action } });

  return (
    <Card>
      <SectionTitle>Your next steps</SectionTitle>
      <ul className="divide-y-2 divide-ink/10">
        {visible.map((s, i) => (
          <Row key={keyOf(s)} step={s} reveal={i >= SHOWN ? i - SHOWN : undefined}>
            {/* "Collect", never "Claim" (claiming is spelling a word); teal, as care and growth are */}
            {s.kind === "rewards" && (
              <Button size="sm" variant="teal" onClick={g.claimEarnings}>
                Collect
              </Button>
            )}
            {s.kind === "stake" && (
              <Button size="sm" variant="teal" onClick={() => g.toggleStake(s.word)}>
                Stake
              </Button>
            )}
            {s.kind === "spell" &&
              (g.canAfford(claim) ? (
                <Button size="sm" variant="teal" onClick={() => g.claim(s.word, s.upper)}>
                  Claim · {fmtWord(claim)}
                </Button>
              ) : (
                <Button size="sm" variant="ghost" onClick={() => getWord(claim, "a claim")}>
                  Get $WORD
                </Button>
              ))}
            {s.kind === "roll" &&
              (g.canAfford(roll) ? (
                <Button size="sm" variant="gold" onClick={() => g.openSheet({ kind: "roll", target: { kind: "word", word: s.word, pos: s.pos } })}>
                  Roll · {fmtWord(roll)}
                </Button>
              ) : (
                <Button size="sm" variant="ghost" onClick={() => getWord(roll, "a roll")}>
                  Get $WORD
                </Button>
              ))}
            {s.kind === "start" && (
              <Button size="sm" variant="primary" onClick={() => g.nav("mint")}>
                Get letters
              </Button>
            )}
          </Row>
        ))}
      </ul>
      {hidden > 0 && (
        <button onClick={() => setAll(true)} className="mt-2 w-full border-t-2 border-ink/10 pt-2 text-left text-xs font-bold text-ink/60 underline">
          Show {hidden} more {hidden === 1 ? "step" : "steps"}
        </button>
      )}
      {visible.some((s) => s.kind === "roll") && (
        <p className="mt-2 text-xs text-ink/60">A word earns $WORD once all 5 of its letters are UPPERCASE.</p>
      )}
    </Card>
  );
}

function keyOf(s: NextStep): string {
  if (s.kind === "spell") return `spell:${s.upper ? "U" : "l"}:${s.word}`;
  return s.kind === "stake" || s.kind === "roll" ? `${s.kind}:${s.word}` : s.kind;
}

/** One step: an icon, what to do and why, and the button that does it. */
function Row({ step, reveal, children }: { step: NextStep; reveal?: number; children: ReactNode }) {
  const { icon, text } = describe(step);
  return (
    // Rows revealed by "Show more" slide in one after another (globals.css, .row-in).
    <li
      className={`flex items-center gap-3 py-2.5 first:pt-1 last:pb-0 ${reveal !== undefined ? "row-in" : ""}`}
      style={reveal !== undefined ? { animationDelay: `${reveal * 45}ms` } : undefined}
    >
      <span className="shrink-0 text-ink/70" aria-hidden>
        {icon}
      </span>
      <span className="min-w-0 flex-1 text-sm leading-snug">{text}</span>
      <span className="shrink-0">{children}</span>
    </li>
  );
}

function describe(s: NextStep): { icon: ReactNode; text: ReactNode } {
  switch (s.kind) {
    case "rewards":
      return {
        icon: <Coins weight="fill" size={20} />,
        text: (
          <>
            <strong>{fmtWord(s.amount)} $WORD</strong> your words earned hasn’t been paid out yet.
          </>
        ),
      };
    case "stake":
      return {
        icon: <Ticket weight="fill" size={20} />,
        text: (
          <>
            <strong className="font-display">{s.word}</strong> isn’t staked. Stake it to enter the daily jackpot
            {s.earns ? " and earn $WORD every day" : ""}.
          </>
        ),
      };
    case "spell":
      return {
        icon: <TextAa weight="bold" size={20} />,
        text: (
          <>
            You can spell <strong className="font-display">{s.word}</strong> with your {s.upper ? "UPPERCASE " : ""}letters
            {s.upper ? ". It earns $WORD from day one once staked." : "."}
          </>
        ),
      };
    case "roll":
      return {
        icon: <Crown weight="fill" size={20} />,
        text: (
          <>
            Roll the <strong className="font-display">{s.letter}</strong> in <strong className="font-display">{s.word}</strong> to
            raise it: {Math.round(s.odds * 100)}% odds.
          </>
        ),
      };
    case "start":
      return {
        icon: <Sparkle weight="fill" size={20} />,
        text: <>Get your first letters: a pack of 5, or your free daily letter.</>,
      };
  }
}
