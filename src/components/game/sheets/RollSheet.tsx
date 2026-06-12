"use client";
/** Roll & Shine — commit→reveal an upgrade. Fail is a no-op (the asset is never harmed). */
import { useState } from "react";
import { Rig } from "@/components/characters/Rig";
import { Button, PityMeter, Sheet } from "../primitives";
import { COST, fmtWord, idxToChar, useGame, type RollTarget } from "../state";

type Phase = "ready" | "rolling" | "win" | "miss";

export function RollSheet({ target }: { target: RollTarget }) {
  const g = useGame();
  const { state } = g;
  const [phase, setPhase] = useState<Phase>("ready");

  const loose = target.kind === "loose";
  const word = !loose ? state.words.find((w) => w.id === target.id) : undefined;
  const char = loose ? idxToChar(target.idx) : word ? word.word[target.pos] : "?";
  const pity = loose ? state.pity[target.idx] : 0;

  const close = () => {
    // returning from a word-position roll? pop back to the word sheet for flow
    if (!loose && word) g.openSheet({ kind: "word", id: word.id });
    else g.closeSheet();
  };

  const reveal = () => {
    if (!g.canAfford(COST.roll)) {
      g.toast("Not enough $WORD to roll", "bad");
      return;
    }
    setPhase("rolling");
    const success = loose ? g.rollLoose(target.idx) : g.rollWord(target.id, target.pos);
    window.setTimeout(() => setPhase(success ? "win" : "miss"), 850);
  };

  const looseLeft = loose ? state.lower[target.idx] : 0;

  return (
    <Sheet open onClose={close} title="Raise a letter">
      <div className="flex flex-col items-center gap-3 pb-2">
        {/* the character */}
        <div className="relative flex h-44 items-end justify-center">
          {phase === "win" ? (
            <Rig letter={char} variant="upper" state="celebrate" earning size={150} />
          ) : (
            <Rig letter={char} variant="lower" state={phase === "rolling" ? "peckish" : "idle"} size={140} />
          )}
          {phase === "rolling" && (
            <div className="absolute inset-0 overflow-hidden">
              <div className="absolute inset-y-0 w-1/3 animate-sheen bg-paper/40" />
            </div>
          )}
        </div>

        {phase === "win" && (
          <div className="text-center">
            <div className="font-display text-2xl font-extrabold text-gold-deep">RAISED! 👑</div>
            <p className="text-sm text-ink/60">A glow-up — top hat, monocle, 2× yield.</p>
          </div>
        )}
        {phase === "miss" && (
          <div className="text-center">
            <div className="font-display text-2xl font-extrabold text-candy">No luck</div>
            <p className="text-sm text-ink/60">Your letter is untouched — never burned. Pity climbs.</p>
          </div>
        )}
        {(phase === "ready" || phase === "rolling") && (
          <div className="w-full max-w-[16rem]">
            <PityMeter pity={pity} />
          </div>
        )}
      </div>

      <div className="mt-3">
        {phase === "ready" && (
          <Button full size="lg" variant="gold" disabled={!g.canAfford(COST.roll)} onClick={reveal}>
            Roll · {fmtWord(COST.roll)} $WORD
          </Button>
        )}
        {phase === "rolling" && (
          <Button full size="lg" variant="gold" disabled>
            Rolling…
          </Button>
        )}
        {(phase === "win" || phase === "miss") && (
          <div className="flex gap-2">
            <Button full variant="ghost" onClick={close}>
              Done
            </Button>
            {loose && looseLeft > 0 && (
              <Button full variant="gold" onClick={() => setPhase("ready")}>
                Roll again
              </Button>
            )}
          </div>
        )}
      </div>
    </Sheet>
  );
}
