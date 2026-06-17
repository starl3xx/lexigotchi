"use client";
/**
 * First-run onboarding — a 4-step, swipe-free carousel that teaches the whole game in one screen:
 * Collect → Create → Roll → Feed & Win. Shown once (persisted in localStorage by the OnboardingHost in
 * GameApp); replayable from the FAQ. Matches the cel / rubber-hose aesthetic of the game.
 */
import { createContext, useContext, useState, type ReactNode } from "react";
import { WORD_COUNT } from "@/lib/dictionary";
import { Button } from "./primitives";
import { TileCharacter, TileWord } from "./TileCharacter";
import { Confetti, Cookie, DiceFive, Sparkle, Trophy } from "./ui/icons";

/** Lets any screen (e.g. the FAQ) replay the intro. Provided by GameApp's OnboardingHost. */
export const OnboardingContext = createContext<{ replay: () => void }>({ replay: () => {} });
export const useOnboarding = () => useContext(OnboardingContext);

interface Step {
  n: number;
  title: string;
  body: string;
  visual: ReactNode;
}

const STEPS: Step[] = [
  {
    n: 1,
    title: "Collect letters",
    body: "Mint one free lowercase letter every day, or grab a pack of five anytime. Every letter is a little character you own and raise.",
    visual: (
      <div className="flex items-end justify-center gap-1">
        {[..."WORD"].map((c, i) => (
          <TileCharacter key={i} char={c} detail="full" state="idle" size={76} />
        ))}
      </div>
    ),
  },
  {
    n: 2,
    title: "Create words",
    body: `Spell a 5-letter word from the ${WORD_COUNT.toLocaleString()}-word dictionary. Each word is a one-of-one — only one player can ever hold it. Staked words earn $WORD.`,
    visual: <TileWord word="CRANE" upper={[false, false, false, false, false]} detail="full" size={60} />,
  },
  {
    n: 3,
    title: "Roll to upgrade",
    body: "Letters arrive lowercase. Roll to raise one to UPPERCASE — odds start at 45% and climb with every near-miss, and a failed roll never harms your letter. UPPERCASE words earn the daily yield.",
    visual: (
      <div className="flex items-center justify-center gap-3">
        <TileCharacter char="R" detail="full" state="idle" size={68} />
        <DiceFive weight="fill" size={34} className="shrink-0 text-candy" />
        <TileCharacter char="R" upper detail="full" state="upgrade" size={94} />
      </div>
    ),
  },
  {
    n: 4,
    title: "Keep them fed and win",
    body: "Stake your words and feed them daily — a fed word stays in the running; a hungry one sits it out. One word wins the jackpot every day, and a weekly themed bounty pays everyone holding a match.",
    visual: (
      <div className="relative flex items-center justify-center">
        <Confetti weight="fill" size={150} className="absolute text-candy/30" />
        <Trophy weight="fill" size={104} className="relative text-gold-deep" />
        <span className="absolute -left-3 bottom-1 flex h-11 w-11 items-center justify-center rounded-full border-[3px] border-ink bg-paper text-candy shadow-[2px_2px_0_#1b1714]">
          <Cookie weight="fill" size={22} />
        </span>
        <Sparkle weight="fill" size={24} className="absolute -right-1 -top-1 text-gold" />
      </div>
    ),
  },
];

export function Onboarding({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState(0);
  const s = STEPS[step];
  const last = step === STEPS.length - 1;

  return (
    <div className="absolute inset-0 z-[60] flex flex-col bg-paper">
      <div
        className="pointer-events-none absolute inset-0 opacity-60"
        style={{ backgroundImage: "radial-gradient(#e7d7b0 0.5px, transparent 0.5px)", backgroundSize: "14px 14px" }}
      />

      <div className="relative flex items-center justify-between px-4 pt-5">
        <span className="font-display text-lg font-extrabold tracking-tight">LEXIGOTCHI</span>
        {!last && (
          <button onClick={onDone} className="text-sm font-bold text-ink/45 active:translate-y-[1px]">
            Skip
          </button>
        )}
      </div>

      <div key={step} className="relative flex flex-1 flex-col items-center justify-center gap-7 px-6 text-center animate-pop">
        <div className="flex min-h-[180px] items-center justify-center">{s.visual}</div>
        <div>
          <div className="mb-2 inline-flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-ink bg-candy text-sm font-extrabold text-paper">
              {s.n}
            </span>
            <h2 className="font-display text-2xl font-extrabold">{s.title}</h2>
          </div>
          <p className="mx-auto max-w-[20rem] leading-relaxed text-ink/70">{s.body}</p>
        </div>
      </div>

      <div className="relative px-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-2">
        <div className="mb-4 flex justify-center gap-1.5">
          {STEPS.map((_, i) => (
            <span
              key={i}
              className={`h-2 rounded-full transition-all ${i === step ? "w-5 bg-candy" : "w-2 bg-ink/20"}`}
            />
          ))}
        </div>
        <div className="flex items-center gap-2">
          {step > 0 && (
            <Button variant="ghost" onClick={() => setStep((p) => p - 1)}>
              Back
            </Button>
          )}
          <Button full size="lg" variant="primary" onClick={() => (last ? onDone() : setStep((p) => p + 1))}>
            {last ? "Start collecting →" : "Next"}
          </Button>
        </div>
      </div>
    </div>
  );
}
