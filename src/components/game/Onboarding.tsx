"use client";
/**
 * First-run onboarding — a 4-step, swipe-free carousel that teaches the whole game in one screen:
 * Collect → Create → Roll → Feed & Win. Shown once (persisted in localStorage by the OnboardingHost in
 * GameApp); replayable from the FAQ. Matches the cel / rubber-hose aesthetic of the game.
 */
import { createContext, useContext, useState, type ReactNode } from "react";
import { HOW_IT_WORKS, type HowItWorksStep } from "@/lib/howItWorks";
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

/** The copy is shared with the landing page (src/lib/howItWorks.ts); only the visuals live here, by step. */
const VISUALS: Record<HowItWorksStep["id"], ReactNode> = {
  collect: (
    <div className="flex items-end justify-center gap-1">
      {[..."WORD"].map((c, i) => (
        <TileCharacter key={i} char={c} detail="full" state="idle" size={76} />
      ))}
    </div>
  ),
  raise: (
    <div className="flex items-center justify-center gap-3">
      <TileCharacter char="R" detail="full" state="idle" size={68} />
      <DiceFive weight="fill" size={34} className="shrink-0 text-candy-ink" />
      <TileCharacter char="R" upper detail="full" state="upgrade" size={94} />
    </div>
  ),
  spell: <TileWord word="CRANE" upper={[false, false, false, false, false]} detail="full" size={60} />,
  feed: (
    <div className="relative flex items-center justify-center">
      <Confetti weight="fill" size={150} className="absolute text-candy/30" />
      <Trophy weight="fill" size={104} className="relative text-gold-ink" />
      <span className="absolute -left-3 bottom-1 flex h-11 w-11 items-center justify-center rounded-full border-[3px] border-ink bg-card text-candy-ink shadow-[2px_2px_0_#1b1714]">
        <Cookie weight="fill" size={22} />
      </span>
      <Sparkle weight="fill" size={24} className="absolute -right-1 -top-1 text-gold" />
    </div>
  ),
};

const STEPS: Step[] = HOW_IT_WORKS.map((s) => ({ ...s, visual: VISUALS[s.id] }));

export function Onboarding({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState(0);
  const s = STEPS[step];
  const last = step === STEPS.length - 1;

  return (
    // Full screen below md; from md a centered card over the dimmed game, not a page-wide wall.
    <div className="absolute inset-0 z-[60] flex md:items-center md:justify-center md:bg-ink/60 md:p-6">
    <div className="relative flex h-full w-full flex-col overflow-hidden bg-paper md:h-[min(780px,90vh)] md:max-w-[520px] md:rounded-[2rem] md:border-[3px] md:border-ink md:shadow-[0_10px_0_#1b1714]">
      <div
        className="pointer-events-none absolute inset-0 opacity-60"
        style={{ backgroundImage: "radial-gradient(#e7d7b0 0.5px, transparent 0.5px)", backgroundSize: "14px 14px" }}
      />

      <div className="relative flex items-center justify-between px-4 pt-5">
        <span className="font-display text-lg font-extrabold tracking-tight">LEXIGOTCHI</span>
        {!last && (
          <button onClick={onDone} className="round-btn rounded-lg px-2 py-1 text-sm font-bold text-ink/45 hover:text-ink">
            Skip
          </button>
        )}
      </div>

      <div key={step} className="relative flex flex-1 flex-col items-center justify-center gap-7 px-6 text-center animate-drop">
        <div className="flex min-h-[180px] items-center justify-center">{s.visual}</div>
        <div>
          <div className="mb-2 inline-flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-ink bg-candy-deep text-sm font-extrabold text-paper">
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
              className={`h-2 rounded-full transition-[width] ${i === step ? "w-5 bg-ink" : "w-2 bg-ink/20"}`}
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
    </div>
  );
}
