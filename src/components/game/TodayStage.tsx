"use client";
/**
 * The top of the Today tab: the word that needs the player most, at full size, in its mood, saying
 * what it needs, with the one button that does it (rules in stagePick.ts). The player's other
 * staked words sit underneath as small cards. It replaces the old "N words need feeding" card:
 * hunger was a text badge two taps away, and it is the reason a tamagotchi gets opened every day.
 */
import { useEffect, useRef, useState } from "react";
import { TileWord, type Gild } from "./TileCharacter";
import { WordTiles, careState } from "./LetterTile";
import { Button, HungerBadge } from "./primitives";
import { ReminderToggle } from "./ReminderToggle";
import { Cookie, Ticket } from "./ui/icons";
import { hunger, useGame } from "./state";
import { pickStage, stageLine, type StagePick } from "./stagePick";

/** Small cards under the stage; the rest are a tap away in the Bag. */
/** How long a fed word chews on stage before the next word takes its place. */
const EAT_MS = 1800;
/** A chain feed settles within ~20 s (lib/onchain/settle.ts); stop waiting a little after that. */
const FED_WAIT_MS = 30_000;
const MAX_OTHERS = 4;

/** The curtain's scalloped hem and the boards of the stage floor, from the game's palette. */
const CURTAIN = "radial-gradient(circle at 12px -2px, #7b1e26 13px, transparent 14px) 0 0 / 24px 20px repeat-x";
const FLOOR = "repeating-linear-gradient(90deg, #e8c98a 0 46px, #c7ae84 46px 49px)";

export function TodayStage() {
  const g = useGame();
  const { state } = g;
  const picked = state.status === "ready" ? pickStage(state.words, (w) => hunger(w)) : null;

  // A fed star chews before it steps aside. Once fed it is no longer the neediest word, so the
  // stage would hand the spot to the next one at once and the feed would go unseen. Hold the word
  // we fed on stage, eating, for EAT_MS after its hunger reads back as full (a chain feed lands
  // seconds after the tap).
  const [fed, setFed] = useState<string | null>(null);
  const [eatingWord, setEatingWord] = useState<string | null>(null);
  const fedNow = fed ? state.words.find((w) => w.word === fed) : undefined;
  const fedIsFull = !!fedNow && hunger(fedNow) === "fed";
  useEffect(() => {
    if (!fed || !fedIsFull) return;
    setEatingWord(fed);
    setFed(null);
  }, [fed, fedIsFull]);
  // A feed that never lands (wallet closed, rejected) stops waiting after FED_WAIT_MS.
  useEffect(() => {
    if (!fed) return;
    const id = window.setTimeout(() => setFed(null), FED_WAIT_MS);
    return () => window.clearTimeout(id);
  }, [fed]);
  useEffect(() => {
    if (!eatingWord) return;
    const id = window.setTimeout(() => setEatingWord(null), EAT_MS);
    return () => window.clearTimeout(id);
  }, [eatingWord]);
  const eatingNow = eatingWord ? state.words.find((w) => w.word === eatingWord) : undefined;
  const pick: StagePick | null =
    eatingNow && picked
      ? {
          word: eatingNow,
          mood: "full",
          needFood: picked.needFood,
          // The word that will take the stage next waits among the small cards meanwhile.
          others: [
            ...(picked.mood !== "unstaked" ? [{ word: picked.word, mood: picked.mood }] : []),
            ...picked.others,
          ].filter((o) => o.word.word !== eatingWord),
        }
      : picked;
  const eating = !!eatingNow;

  // Size the characters to the stage: five linked full-body tiles span about 4.7 tile widths.
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState(56);
  const shown = pick !== null;
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setSize(Math.max(40, Math.min(72, Math.floor((e.contentRect.width - 16) / 4.7)))));
    ro.observe(el);
    return () => ro.disconnect();
  }, [shown]);

  if (!pick) return null;
  const w = pick.word;
  const W = w.word;
  const gild = Math.max(0, Math.min(4, Math.round(w.prestigeLevel))) as Gild;
  const open = () => g.openSheet({ kind: "word", word: W });
  const others = pick.others.slice(0, MAX_OTHERS);
  const moreCount = pick.others.length - others.length;

  return (
    <section aria-label={`${W} on stage`} className="space-y-2">
      <div className="cel overflow-hidden rounded-2xl bg-night">
        <div className="h-5" style={{ background: CURTAIN }} aria-hidden />
        <div ref={box} className="flex flex-col items-center gap-3 px-2 pt-2">
          <p className="relative rounded-xl border-2 border-ink bg-paper px-3 py-1.5 text-center text-sm font-bold shadow-[2px_2px_0_#1b1714]">
            {eating ? `${W} is full again. Thank you!` : stageLine(pick)}
            <span
              aria-hidden
              className="absolute -bottom-[7px] left-1/2 h-3 w-3 -translate-x-1/2 rotate-45 border-b-2 border-r-2 border-ink bg-paper"
            />
          </p>
          <button onClick={open} aria-label={`Open ${W}`} className="tile-press rounded-2xl pt-1">
            <TileWord word={W} upper={w.upper} state={eating ? "eating" : pick.mood === "unstaked" ? "idle" : careState(w)} gild={gild} size={size} detail="full" />
          </button>
        </div>
        <div className="-mt-1 h-6 border-t-[3px] border-ink" style={{ background: FLOOR }} aria-hidden />
        <div className="flex gap-2 border-t-[3px] border-ink bg-night p-3">
          {(pick.mood === "hungry" || pick.mood === "peckish") && (
            <>
              <Button
                variant="teal"
                className="flex-1"
                onClick={() => {
                  setFed(W);
                  g.feed(W);
                }}
              >
                <Cookie weight="fill" /> Feed {W}
              </Button>
              {pick.needFood > 1 && (
                <Button
                  variant="ghost"
                  className="shrink-0"
                  onClick={() => {
                    setFed(W);
                    g.feedAll();
                  }}
                >
                  Feed all {pick.needFood}
                </Button>
              )}
            </>
          )}
          {pick.mood === "unstaked" && (
            <Button variant="teal" full onClick={() => g.toggleStake(W)}>
              <Ticket weight="fill" /> Stake {W}
            </Button>
          )}
          {pick.mood === "full" && (
            <Button variant="ghost" full onClick={open}>
              See {W}
            </Button>
          )}
        </div>
      </div>

      {pick.needFood > 0 && <ReminderToggle compact />}

      {others.length > 0 && (
        <div className="grid grid-cols-2 gap-2">
          {others.map(({ word: o }) => (
            <button
              key={o.word}
              onClick={() => g.openSheet({ kind: "word", word: o.word })}
              className="cel-sm press flex min-w-0 flex-col items-start gap-1 rounded-xl bg-paper px-2.5 py-2 text-left"
            >
              <WordTiles word={o.word} upper={o.upper} size={16} state={careState(o)} detail="bust" />
              <span className="flex w-full min-w-0 items-center gap-1.5">
                <span className="truncate font-display text-sm font-extrabold">{o.word}</span>
                <HungerBadge state={hunger(o)} />
              </span>
            </button>
          ))}
          {moreCount > 0 && (
            <button onClick={() => g.nav("bag")} className="col-span-2 text-center text-xs font-bold text-ink/60 underline">
              {moreCount} more in your Bag
            </button>
          )}
        </div>
      )}
    </section>
  );
}
