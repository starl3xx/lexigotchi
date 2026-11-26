"use client";
/**
 * Try to ascend a word: the roll sheet's shape, for a whole word (starl3xx, 2026-11-25: "ascend
 * need its own animation like roll does for letters... where the word's letters get nervous").
 *
 * The word stands at full size, its five letters holding hands. While a try is out they can't look
 * (the rig's rolling state, each letter out of step with the last). Then the result passes along
 * the word letter by letter: on a hit each one opens its eyes in its new gold and the word cheers;
 * on a miss each one droops, then they settle beside the new odds. The result's own button tries
 * again at once, so climbing a word never means closing the sheet and opening it again.
 *
 * The rules are in ../ascendFlow.ts (pure, tested). The one that matters most: a try costs its fee
 * whatever it gives back, so another try is offered only after a result the chain has confirmed.
 */
import { useEffect, useRef, useState } from "react";
import { HOLOGRAPHIC_LEVEL, stageName } from "@/lib/ascension";
import { MISS_POINTS, STAGE_SHARE } from "@/lib/howItWorks";
import { LINK_OVERLAP } from "@/components/scenes/layout";
import type { Stage } from "@/lib/onchain/stageOverlay";
import { TileWord, usePrefersReducedMotion, type Gild, type TileState } from "../TileCharacter";
import { Button, Sheet } from "../primitives";
import { Star } from "../ui/icons";
import { fmtWord, useGame, wordCase, type ActionOutcome } from "../state";
import { nextTry, phaseAfter, resultToast, shownStage, stageAfter, waveOf, type AscendPhase } from "../ascendFlow";

/** The practice game has no chain to wait for: its letters still get a moment to be nervous in. */
const PRACTICE_BEAT_MS = 1400;
/** The result reaches one more letter this often. */
const WAVE_STEP_MS = 110;
/** How long the word cheers a hit, and droops at a miss, before it stands at rest again. */
const CHEER_MS = 2600;
const DROOP_MS = 1300;
/** If the store still disagrees with a result this long after it, the store is right. */
const EXPECTED_HOLD_MS = 8000;

/** A full-size word is this many letter-widths wide: its letters overlap to hold hands. */
const rowWidths = (letters: number) => letters - (letters - 1) * LINK_OVERLAP;
const gildOf = (level: number) => Math.max(0, Math.min(HOLOGRAPHIC_LEVEL, Math.round(level))) as Gild;

export function AscendSheet({ word: wordKey }: { word: string }) {
  const g = useGame();
  const word = g.state.words.find((w) => w.word === wordKey);
  const reduced = usePrefersReducedMotion();

  const [phase, setPhase] = useState<AscendPhase>("ready");
  const [stranded, setStranded] = useState("");
  // The stage at the tap, held while the try is out and while its result passes along the word.
  const [from, setFrom] = useState<Stage | null>(null);
  // What the result leaves, shown until the store's own read agrees (ascendFlow.shownStage).
  const [expected, setExpected] = useState<Stage | null>(null);
  // How many letters the result has reached, left to right.
  const [reached, setReached] = useState(0);
  // The word's mood once the result has reached every letter: a cheer or a droop, then at rest.
  const [mood, setMood] = useState<TileState>("idle");

  const timers = useRef<number[]>([]);
  const later = (fn: () => void, ms: number) => void timers.current.push(window.setTimeout(fn, ms));
  const clearTimers = () => {
    timers.current.forEach((id) => window.clearTimeout(id));
    timers.current = [];
  };
  // The practice store applies a result at the tap, and the sheet shows it a beat later. If the
  // sheet is closed inside that beat, the result is said in a toast on the way out, as the chain
  // store says one that lands after its sheet has gone: a result is shown or said, once, always.
  const unsaid = useRef<{ hit: boolean; level: number } | null>(null);
  const toast = useRef(g.toast);
  toast.current = g.toast;
  useEffect(
    () => () => {
      clearTimers();
      const left = unsaid.current;
      if (!left) return;
      const said = resultToast(wordKey, left.hit, left.level);
      toast.current(said.text, said.tone);
    },
    [wordKey],
  );

  // The word as large as the sheet allows (a phone's sheet fits it at about 78 px a letter).
  const stage = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState(64);
  const letters = wordKey.length;
  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const fit = () => setSize(Math.max(44, Math.min(104, Math.floor(el.clientWidth / rowWidths(letters)))));
    fit();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [letters]);

  // Back to the word's own sheet, where this one was opened.
  const close = () => g.openSheet({ kind: "word", word: wordKey });

  if (!word) {
    return (
      <Sheet open onClose={g.closeSheet} title="Ascend">
        <p className="py-6 text-center text-ink/60">This word is no longer in your bag.</p>
      </Sheet>
    );
  }

  const maxLevel = g.maxPrestigeLevel;
  const live: Stage = { level: word.prestigeLevel, pity: word.prestigePity };
  const landed = reached >= letters; // the result has reached every letter
  const result = phase === "hit" || phase === "miss";
  // The sheet reads as "still trying" until the last letter has had the result.
  const waiting = phase === "trying" || (result && !landed);
  // Where the word stands, and what the sheet says: the same, except while a result is passing
  // along the word. Then the letters tell it one by one, and the stars, the odds, and the price
  // stay as they were at the tap until the last letter has it.
  const stands = shownStage(phase, live, from, expected);
  const shown = result && !landed && from ? from : stands;
  const atTop = shown.level >= maxLevel;

  const goal = Math.min(shown.level + 1, maxLevel);
  const prob = g.prestigeProb(shown.level, shown.pity);
  const firstTry = g.prestigeProb(shown.level, 0);
  const total = g.prestigePrice(shown.level) + g.price("prestigeSnack");
  const canAct = (word.mine || word.care === true) && word.staked && wordCase(word) === "UPPERCASE" && !atTop;
  const short = !g.canAfford(total);

  // `known`: where the chain has the word after this result (the chain store reads it with the
  // reveal). The practice store has no chain, and its rule is exactly stageAfter's. Never guess
  // when the chain has said: a signed success that no longer counted is a miss that adds no pity.
  const land = (hit: boolean, at: Stage, known?: Stage) => {
    setExpected(known ?? stageAfter(at, hit));
    later(() => setExpected(null), EXPECTED_HOLD_MS);
    setMood(hit ? "celebrate" : "peckish");
    setPhase(hit ? "hit" : "miss");
    // The result passes along the word; with reduced motion it is simply there.
    if (reduced) setReached(letters);
    else for (let i = 1; i <= letters; i++) later(() => setReached(i), i * WAVE_STEP_MS);
    const settled = (reduced ? 0 : letters * WAVE_STEP_MS) + (hit ? CHEER_MS : DROOP_MS);
    later(() => {
      setMood("idle");
      setFrom(null);
    }, settled);
  };

  const finish = (outcome: ActionOutcome, at: Stage) => {
    unsaid.current = null; // the sheet is here to show it
    const next = phaseAfter(outcome);
    if (next === "hit" || next === "miss") return land(next === "hit", at, outcome.status === "resolved" ? outcome.stage : undefined);
    if (outcome.status === "stranded") setStranded(outcome.note);
    setFrom(null);
    setPhase(next);
  };

  const attempt = () => {
    if (waiting) return;
    clearTimers();
    const at = shown; // the stage this try is paid at
    setFrom(at);
    setExpected(null);
    setReached(0);
    setMood("idle");
    setPhase("trying");
    const res = g.prestige(word.word);
    if (res instanceof Promise) {
      void res
        .then((outcome) => finish(outcome, at))
        // A rejection says nothing about whether the fee was taken, so it is treated as paid:
        // withholding another try costs a tap, and offering one could cost a second fee.
        .catch(() => finish({ status: "stranded", note: "We lost track of this attempt. Reopen to check before trying again" }, at));
      return;
    }
    // The practice store answers at once (null: it never tried, and said why in a toast).
    if (res === null) return finish({ status: "not-started" }, at);
    unsaid.current = { hit: res, level: stageAfter(at, res).level };
    later(() => finish({ status: "resolved", success: res }, at), PRACTICE_BEAT_MS);
  };

  // How each letter stands. A result in passing: the letters it has reached wear it, the rest still
  // can't look. Otherwise the whole word shares one state.
  const wave = result && !landed ? waveOf(letters, reached, mood, gildOf(shown.level), gildOf(stands.level)) : null;
  const wordState: TileState = phase === "trying" ? "rolling" : result ? mood : "idle";
  const cheering = phase === "hit" && landed && mood === "celebrate";
  const again = result && landed ? nextTry(phase, shown.level, maxLevel) : null;
  const tryLabel = `${fmtWord(total)} $WORD`;
  // A try is on offer, or out: the line under the buttons says what its price includes.
  const offered = !atTop && (phase === "ready" || waiting || again !== null);

  return (
    <Sheet open onClose={close} title={`Ascend ${word.word}`}>
      <div className="flex flex-col items-center gap-3 pb-2">
        {/* The word. Nothing is drawn over it while a try is out; a hit's rays turn behind it. */}
        <div ref={stage} className="relative flex w-full items-end justify-center pt-3" style={{ minHeight: Math.round(size * 1.5) }}>
          {cheering && <div aria-hidden className={`asc-rays ${shown.level >= HOLOGRAPHIC_LEVEL ? "asc-rays-holo" : ""}`} />}
          <TileWord
            word={word.word}
            upper={word.upper}
            state={wordState}
            gild={gildOf(shown.level)}
            states={wave?.states}
            gilds={wave?.gilds}
            size={size}
            detail="full"
            tier={word.tier}
            className="relative"
          />
        </div>

        <Ladder level={shown.level} max={maxLevel} goal={atTop ? null : goal} pulsing={waiting} />

        {/* What the phase says. The box keeps one height, the tallest phase's, so the word above it
            never jumps when a result takes the place of the odds: a phone's sheet grows from the
            bottom edge, and a taller message would push the word up the screen mid-cheer. */}
        <div className="flex min-h-[8.5rem] w-full max-w-[20rem] flex-col justify-start" role="status" aria-live="polite">
          {phase === "hit" && landed && (
            <div className="w-full text-center">
              <div className="flex items-center justify-center gap-1.5 font-display text-2xl font-extrabold text-gold-deep">
                {stageName(shown.level)}! <Star weight="fill" />
              </div>
              <p className="text-sm text-ink/60">
                {word.word} climbed a stage, and its share of earnings and the bounty grew {STAGE_SHARE}.
                {atTop ? " It stands at the top of the ladder." : ""}
              </p>
              {!atTop && (
                <p className="mt-1 text-sm text-ink/60">
                  {stageName(goal)} is next, at <strong className="font-bold text-ink">{pct(prob)}</strong> on the first try.
                </p>
              )}
            </div>
          )}
          {/* The new odds, shown at once, with the meter: "the odds went up" over an unchanged
              number reads as "nothing happened". */}
          {phase === "miss" && landed && (
            <div className="w-full text-center">
              <div className="font-display text-2xl font-extrabold text-candy-ink">Held its ground</div>
              <p className="text-sm text-ink/60">
                {word.word} is untouched. Your next try for {stageName(goal)} is{" "}
                <strong className="font-bold text-ink">{pct(prob)}</strong>.
              </p>
              <div className="mt-2 text-left">
                <OddsMeter prob={prob} firstTry={firstTry} pity={shown.pity} />
              </div>
            </div>
          )}
          {/* Paid, and not known to be finished. No try is offered here: it would pay a second fee
              on top of an attempt that may still be open. */}
          {phase === "stranded" && (
            <div className="w-full text-center">
              <div className="font-display text-2xl font-extrabold text-gold-deep">Still finishing</div>
              <p className="text-sm text-ink/60">{stranded}</p>
            </div>
          )}
          {(phase === "ready" || waiting) && (
            <div className="w-full">
              {atTop ? (
                <p className="text-center text-sm text-ink/60">{word.word} stands at the top of the ladder.</p>
              ) : (
                <>
                  <OddsMeter prob={prob} firstTry={firstTry} pity={shown.pity} />
                  <p className="mt-2 text-xs text-ink/60">
                    A hit raises its share of earnings and the bounty {STAGE_SHARE}. A miss never harms it, and raises the next
                    try’s odds {MISS_POINTS} points.
                  </p>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* The buttons: one row of one height in every phase, and one line under it, for the same
          reason as the box above. */}
      <div className="mt-3">
        <div className="flex min-h-[58px] gap-2">
          {phase === "ready" && !atTop && (
            <Button full size="lg" variant="gold" disabled={!canAct || short} onClick={attempt}>
              Try for {stageName(goal)} · {tryLabel}
            </Button>
          )}
          {phase === "ready" && atTop && (
            <Button full size="lg" variant="ghost" onClick={close}>
              Done
            </Button>
          )}
          {/* "Attempting", never "Ascending": the try may miss (starl3xx, 2026-11-25). */}
          {waiting && (
            <Button full size="lg" variant="gold" disabled>
              Attempting ascension…
            </Button>
          )}
          {phase === "stranded" && (
            <Button full size="lg" variant="ghost" onClick={close}>
              Close
            </Button>
          )}
          {/* The second button tries at once (one tap a try), so its price is on it. Done sizes to
              its text so the priced label fits beside it on a phone. */}
          {result && landed && (
            <>
              <Button full={!again} variant="ghost" onClick={close}>
                Done
              </Button>
              {again && (
                <Button variant="gold" className="flex-1" disabled={!canAct || short} onClick={attempt}>
                  {again === "again" ? "Try again" : `Try for ${stageName(goal)}`} · {tryLabel}
                </Button>
              )}
            </>
          )}
        </div>
        <p className="mt-2 min-h-4 text-center text-xs text-ink/55">
          {!offered
            ? ""
            : !word.staked
              ? "Stake it first to ascend."
              : `The price includes a ${fmtWord(g.price("prestigeSnack"))} $WORD snack, burned with each try.`}
        </p>
        {offered && !waiting && word.staked && short && <GetMore amount={total} />}
      </div>
    </Sheet>
  );
}

const pct = (p: number) => `${Math.round(p * 100)}%`;

/** Short of $WORD for a try: one tap to the sheet that gets more, with what this try needs. */
function GetMore({ amount }: { amount: number }) {
  const g = useGame();
  return (
    <p className="mt-2 text-center text-xs text-candy-ink">
      You don’t have enough $WORD for this try.{" "}
      <button className="font-bold underline" onClick={() => g.openSheet({ kind: "balance", need: { amount, action: "an ascension try" } })}>
        Get more
      </button>
    </p>
  );
}

/**
 * The word ladder as a row of stars: gold for each stage the word has reached, and a ring around
 * the one this try is for (it pulses while the try is out). Stars mean ascension everywhere in the
 * game (the word sheet's title, the tile's pips).
 */
function Ladder({ level, max, goal, pulsing }: { level: number; max: number; goal: number | null; pulsing: boolean }) {
  if (max <= 0) return null;
  const label = goal ? `${stageName(level)}, trying for ${stageName(goal)}` : stageName(level);
  return (
    <div className="flex flex-col items-center gap-1">
      <div className="flex items-center gap-1.5" role="img" aria-label={label}>
        {Array.from({ length: max }, (_, i) => {
          const n = i + 1;
          const has = n <= level;
          const next = n === goal;
          return (
            <span
              key={n}
              title={stageName(n)}
              className={`flex h-7 w-7 items-center justify-center rounded-full border-2 ${
                next ? `border-gold-deep bg-gold/15 ${pulsing ? "asc-goal" : ""}` : "border-transparent"
              }`}
            >
              <Star weight={has ? "fill" : "regular"} size={16} className={has ? "text-gold-deep" : next ? "text-gold-ink" : "text-ink/30"} />
            </span>
          );
        })}
      </div>
      <div className="text-sm font-bold text-ink/70">
        {goal ? (
          <>
            {stageName(level)} <span className="text-ink/40">→</span> <span className="text-gold-ink">{stageName(goal)}</span>
          </>
        ) : (
          stageName(level)
        )}
      </div>
    </div>
  );
}

/** This try's odds: gold, the game's color for chance. Says what the misses so far have added. */
function OddsMeter({ prob, firstTry, pity }: { prob: number; firstTry: number; pity: number }) {
  const added = Math.round((prob - firstTry) * 100);
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs font-bold text-ink/70">
        <span>odds this try</span>
        <span className="font-display text-sm text-ink">{pct(prob)}</span>
      </div>
      <div className="h-3 overflow-hidden rounded-full border-2 border-ink bg-paper-dark">
        <div className="h-full bg-gold transition-[width]" style={{ width: `${prob * 100}%` }} />
      </div>
      {pity > 0 && added > 0 && (
        <div className="text-xs text-ink/60">
          +{added} points from {pity} {pity === 1 ? "miss" : "misses"} · resets on a hit
        </div>
      )}
    </div>
  );
}
