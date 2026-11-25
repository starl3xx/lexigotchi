"use client";
/**
 * The top of the Today tab: one word at full size, standing in its scene, in its mood, saying what
 * it needs, with the one button that does it (rules in stagePick.ts). It opens on the word that
 * needs the player most; ← and → (or a swipe, or the arrow keys) walk the rest of the player's
 * words, staked neediest first, then the ones waiting to be staked (starl3xx, 2026-11-24: "the
 * featured word/scene should have ← and → arrows on the sides to switch between words"). Under it,
 * the next three words as cards, and the Bag for all of them.
 *
 * It replaces the old "N words need feeding" card: hunger was a text badge two taps away, and it
 * is the reason a tamagotchi gets opened every day.
 */
import { useEffect, useState, type KeyboardEvent } from "react";
import type { Gild } from "./TileCharacter";
import { WordTiles, careState } from "./LetterTile";
import { Button, HungerBadge, Pill } from "./primitives";
import { ReminderToggle } from "./ReminderToggle";
import { Backpack, CaretLeft, CaretRight, Cookie, Palette, Sparkle, TextAa, Ticket } from "./ui/icons";
import { hunger, useGame } from "./state";
import { stageLine, stageLineup, upNext } from "./stagePick";
import { useEmptyStageCase } from "./useTodayPlan";
import { WORDS_READ_FAILED } from "./WordsPending";
import { SceneFrame, toneOf } from "../scenes/SceneFrame";
import { useWordScene } from "../scenes/useWordScene";

/** How long a fed word chews on stage before the next word takes its place. */
const EAT_MS = 1800;
/** A chain feed settles within ~20 s (lib/onchain/settle.ts); stop waiting a little after that. */
const FED_WAIT_MS = 30_000;
/** Word cards under the stage; the fourth tile is the Bag, with all of them. */
const UP_NEXT = 3;

export function TodayStage() {
  const g = useGame();
  const { state } = g;
  const { items, needFood } = state.status === "ready" ? stageLineup(state.words, (w) => hunger(w)) : { items: [], needFood: 0 };

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

  // The word the player put on stage (arrows, swipe, keys, or a card). Until they choose one, the
  // stage shows the neediest word, holding a fed one while it eats.
  const [chosen, setChosen] = useState<string | null>(null);
  // Which side the next word slides in from (SceneFrame). None on first show.
  const [enter, setEnter] = useState<"next" | "prev" | null>(null);
  useEffect(() => {
    if (!eatingWord) return;
    const id = window.setTimeout(() => {
      // The meal is over: the next hungry word steps up, from the right.
      setEnter("next");
      setEatingWord(null);
    }, EAT_MS);
    return () => window.clearTimeout(id);
  }, [eatingWord]);

  const indexOf = (name: string | null) => (name ? items.findIndex((i) => i.word.word === name) : -1);
  const featured = indexOf(chosen) >= 0 ? chosen : indexOf(eatingWord) >= 0 ? eatingWord : (items[0]?.word.word ?? null);
  const idx = indexOf(featured);
  const item = idx >= 0 ? items[idx] : null;
  // The featured word stands in its own scene (scenes/useWordScene: the player's pick, else the Stage).
  const { scene } = useWordScene(item?.word.word);

  if (!item) return state.status === "ready" ? <EmptyStage /> : null;
  const w = item.word;
  const W = w.word;
  const eating = W === eatingWord;
  const mood = eating ? "full" : item.mood;
  const gild = Math.max(0, Math.min(4, Math.round(w.prestigeLevel))) as Gild;
  const open = () => g.openSheet({ kind: "word", word: W });
  const face = eating ? "eating" : mood === "unstaked" ? "idle" : careState(w);
  const many = items.length > 1;

  const show = (name: string, side: "next" | "prev") => {
    setEnter(side);
    setChosen(name);
  };
  const go = (step: 1 | -1) => {
    if (!many) return;
    show(items[(idx + step + items.length) % items.length].word.word, step === 1 ? "next" : "prev");
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "ArrowRight") go(1);
    else if (e.key === "ArrowLeft") go(-1);
    else return;
    e.preventDefault();
  };

  const arrow = (step: 1 | -1) => {
    const Icon = step === 1 ? CaretRight : CaretLeft;
    return (
      <button
        onClick={() => go(step)}
        aria-label={step === 1 ? "Next word" : "Previous word"}
        className={`group round-btn pointer-events-auto absolute top-[calc(58%-1.25rem)] grid h-10 w-10 place-items-center rounded-full border-2 border-ink bg-card/90 shadow-[2px_2px_0_#1b1714] ${step === 1 ? "right-2.5" : "left-2.5"}`}
      >
        <Icon weight="bold" size={16} className={`transition-transform duration-200 ${step === 1 ? "motion-safe:group-hover:translate-x-0.5" : "motion-safe:group-hover:-translate-x-0.5"}`} />
      </button>
    );
  };

  return (
    <section aria-label={`${W} on stage`} className="space-y-2" onKeyDown={onKeyDown}>
      <div className="cel overflow-hidden rounded-2xl bg-night">
        <SceneFrame
          scene={scene}
          word={W}
          upper={w.upper}
          state={face}
          tone={toneOf(face)}
          gild={gild}
          enter={enter}
          onWord={open}
          wordLabel={`Open ${W}`}
          onSwipe={many ? go : undefined}
          overlay={
            <>
              {/* Under the valance, over the scene: the star's one line, in a bubble of its own so
                  it reads on a bright scene as well as a dark one. */}
              <div className="pointer-events-none absolute inset-x-0 top-[7%] flex justify-center px-12">
                <p key={W} className="scene-fade-in relative max-w-[30ch] rounded-xl border-2 border-ink bg-card px-3 py-1.5 text-center text-sm font-bold shadow-[2px_2px_0_#1b1714]">
                  {eating ? `${W} is full again. Thank you!` : stageLine({ word: w, mood })}
                  <span
                    aria-hidden
                    className="absolute -bottom-[7px] left-1/2 h-3 w-3 -translate-x-1/2 rotate-45 border-b-2 border-r-2 border-ink bg-card"
                  />
                </p>
              </div>
              {many && arrow(-1)}
              {many && arrow(1)}
            </>
          }
        />
        <div className="flex gap-2 border-t-[3px] border-ink bg-night p-3">
          {(mood === "hungry" || mood === "peckish") && (
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
              {needFood > 1 && (
                <Button
                  variant="ghost"
                  className="shrink-0"
                  onClick={() => {
                    setFed(W);
                    g.feedAll();
                  }}
                >
                  Feed all {needFood}
                </Button>
              )}
            </>
          )}
          {mood === "unstaked" && (
            <Button variant="teal" className="flex-1" onClick={() => g.toggleStake(W)}>
              <Ticket weight="fill" /> Stake {W}
            </Button>
          )}
          {mood === "full" && (
            <Button variant="ghost" className="flex-1" onClick={open}>
              See {W}
            </Button>
          )}
          <Button
            variant="ghost"
            className="shrink-0 !px-3"
            aria-label={`Pick ${W}’s scene`}
            title="Pick a scene"
            onClick={() => g.openSheet({ kind: "scene", word: W })}
          >
            <Palette weight="fill" size={18} />
          </Button>
        </div>
      </div>

      {needFood > 0 && <ReminderToggle compact />}

      {/* Up next: the words → brings, then the Bag. A card puts its word on stage. */}
      <div className="grid grid-cols-2 gap-2">
        {upNext(items, idx, UP_NEXT).map(({ word: o, mood: m }) => (
          <button
            key={o.word}
            onClick={() => show(o.word, "next")}
            aria-label={`Put ${o.word} on stage`}
            className="cel-sm press flex min-w-0 flex-col items-start gap-1 rounded-xl bg-card px-2.5 py-2 text-left"
          >
            <WordTiles word={o.word} upper={o.upper} size={16} state={careState(o)} detail="bust" />
            <span className="flex w-full min-w-0 items-center gap-1.5">
              <span className="truncate font-display text-sm font-extrabold">{o.word}</span>
              {m === "unstaked" ? <Pill className="bg-ink/10">not staked</Pill> : <HungerBadge state={hunger(o)} />}
            </span>
          </button>
        ))}
        <button
          onClick={() => g.nav("bag")}
          className="cel-sm press flex min-w-0 items-center gap-2.5 rounded-xl bg-card px-2.5 py-2 text-left"
        >
          <Backpack weight="bold" size={26} className="press-icon shrink-0" />
          <span className="min-w-0">
            <span className="block font-display text-sm font-extrabold">My Bag</span>
            <span className="block text-xs text-ink/60">
              {state.words.length === 1 ? "Your 1 word" : `All ${state.words.length} words`}
            </span>
          </span>
        </button>
      </div>
    </section>
  );
}

/**
 * No word of the connected wallet's to stand on the stage: the stage waits, curtains up, and says
 * what to do for this player (emptyStageCase). The top left of Today is the player's words, so it is
 * never blank: it shows where their words will live and the one step toward the first.
 */
function EmptyStage() {
  const g = useGame();
  const shape = useEmptyStageCase();
  const say: Record<typeof shape, string | null> = {
    loading: null,
    error: WORDS_READ_FAILED,
    elsewhere: "Your words live in your other wallet. Connect it to look after them here.",
    spell: "Your letters can spell a word now. Spell it, and it moves in here.",
    more: "Your words will live here. A few more letters, and you can spell your first.",
    start: "Your words will live here, each in its own scene. Start with some letters.",
  };
  return (
    <section aria-label="Your stage" aria-busy={shape === "loading"} className="cel overflow-hidden rounded-2xl bg-night">
      <SceneFrame
        scene="stage"
        word=""
        upper={[]}
        overlay={
          say[shape] && (
            <div className="pointer-events-none absolute inset-x-0 top-[28%] flex justify-center px-6">
              <p className="max-w-[30ch] rounded-xl border-2 border-ink bg-card px-3 py-1.5 text-center text-sm font-bold shadow-[2px_2px_0_#1b1714]">
                {say[shape]}
              </p>
            </div>
          )
        }
      />
      <div className="flex gap-2 border-t-[3px] border-ink bg-night p-3">
        {shape === "loading" && (
          <Button variant="ghost" full disabled>
            Bringing out your words…
          </Button>
        )}
        {shape === "error" && (
          <Button variant="ghost" full onClick={() => g.reloadWords?.()}>
            Try again
          </Button>
        )}
        {shape === "elsewhere" && (
          <Button variant="ghost" full onClick={() => g.nav("bag")}>
            <Backpack weight="bold" /> See them in your Bag
          </Button>
        )}
        {shape === "spell" && (
          <Button variant="teal" full onClick={() => g.nav("claim")}>
            <TextAa weight="bold" /> Spell your first word
          </Button>
        )}
        {(shape === "more" || shape === "start") && (
          <Button variant="primary" full onClick={() => g.nav("mint")}>
            <Sparkle weight="fill" /> {shape === "start" ? "Get letters" : "Mint more letters"}
          </Button>
        )}
      </div>
    </section>
  );
}
