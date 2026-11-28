"use client";
/**
 * The top of the Today tab: one word's card at full size, and under it a placard, as under a
 * picture in a museum (decisions.md #39): the word's three status marks in fixed places (Fed,
 * Jackpot, Earns: ./stageMarks), the one button that does what it needs (rules in stagePick.ts),
 * and a pager. Nothing is drawn over the card's art: the speech bubble and the arrows that sat on
 * it are gone. The placard never names the word; the card above it does (starl3xx, 2026-11-25:
 * "seeing JAZZY immediately underneath the card is redundant"). It opens on the word that
 * needs the player most; ← and → (or a swipe, or the arrow keys) walk the rest of the player's
 * words, staked neediest first, then the ones waiting to be staked (starl3xx, 2026-11-24: "the
 * featured word/scene should have ← and → arrows on the sides to switch between words"). Under it,
 * the next three words as cards, and the Bag for all of them.
 *
 * It replaces the old "N words need feeding" card: hunger was a text badge two taps away, and it
 * is the reason a tamagotchi gets opened every day.
 */
import { useState, type KeyboardEvent } from "react";
import type { Gild } from "./TileCharacter";
import { WordTiles, careState } from "./LetterTile";
import { Button, HungerBadge, Pill } from "./primitives";
import { ReminderToggle } from "./ReminderToggle";
import { Backpack, CaretLeft, CaretRight, Alarm, Palette, Sparkle, Storefront, TextAa, Ticket } from "./ui/icons";
import { fmtWord, hunger, useGame } from "./state";
import { payoutWhen } from "./earnings";
import { EarningsLine } from "./EarningsLine";
import { stageLine, stageLineup, upNext } from "./stagePick";
import { useForSale } from "./useForSale";
import { feedAllLabel, wordsToFeed } from "./feedAll";
import { useEmptyStageCase } from "./useTodayPlan";
import { WORDS_READ_FAILED } from "./WordsPending";
import { SceneFrame, toneOf } from "../scenes/SceneFrame";
import { SceneCard } from "../cards/SceneCard";
import { CardCase } from "../cards/CardCase";
import { flipKey, useFlipOf } from "../cards/useFlipOf";
import { useWordCases } from "./useShop";
import { useWordScene } from "../scenes/useWordScene";
import { useCardNumber } from "../cards/useCardNumber";
import { StatusMarks } from "./StatusMarks";
import { markInput, stageMarks } from "./stageMarks";
import { usePrefersReducedMotion } from "./motionPrefs";
import type { OwnedWord } from "./state";
import type { StageMood } from "./stagePick";
import { useWakeAct } from "./wake/useWakeAct";
import { useWake, useWakeRun } from "./wake/wakeRun";

/** Word cards under the stage; the fourth tile is the Bag, with all of them. */
const UP_NEXT = 3;
/** The placard's buttons: each on one line; the main one takes the room, and the row wraps before a label does. */
const PRIMARY = "flex-1 whitespace-nowrap !px-3";
const SECOND = "shrink-0 whitespace-nowrap !px-3";
/** The pager draws a dot a word up to this many; past it, the count alone says where you are. */
const PAGER_DOTS = 8;

/**
 * A word waiting under the stage: its letters, its name, and how it is. A tap puts it on stage.
 * It has a small part in a wake (./wake): it keeps the look it had until its turn, then its
 * letters hop once and its badge says awake.
 */
function UpNextCard({ word: o, mood: m, onShow }: { word: OwnedWord; mood: StageMood; onShow: () => void }) {
  const act = useWakeAct(o.word, false);
  // held: the wake is on its way, or it is not this card's turn yet
  const held = act.states !== undefined;
  return (
    <button
      onClick={onShow}
      aria-label={`Put ${o.word} on stage`}
      className={`cel-sm press flex min-w-0 flex-col items-start gap-1 rounded-xl bg-card px-2.5 py-2 text-left ${act.hop ? "wk-hop" : ""}`}
    >
      <WordTiles word={o.word} upper={o.upper} size={16} state={held ? act.states![0] : careState(o)} detail="bust" tier={o.tier} still />
      <span className="flex w-full min-w-0 items-center gap-1.5">
        <span className="truncate font-display text-sm font-extrabold">{o.word}</span>
        {m === "forSale" ? (
          <Pill className="bg-gold/25 text-gold-ink">for sale</Pill>
        ) : m === "unstaked" ? (
          <Pill className="bg-ink/10">not staked</Pill>
        ) : (
          <HungerBadge state={held ? (act.states![0] === "hungry" ? "hungry" : "peckish") : hunger(o)} />
        )}
      </span>
    </button>
  );
}

export function TodayStage() {
  const g = useGame();
  const { state } = g;
  const forSale = useForSale();
  const { items } =
    state.status === "ready" ? stageLineup(state.words, (w) => hunger(w), new Set(forSale.keys())) : { items: [] };
  // Every word Feed all would feed (yours and the ones you care for), whichever word is on stage.
  const toFeed = state.status === "ready" ? wordsToFeed(state.words) : [];

  // A woken star takes its bow before it steps aside (./wake; decisions.md #64). Once awake it
  // is no longer the neediest word, so the stage would hand the spot to the next one at once and
  // the wake would go unseen. The wake in hand names the word that was on stage when the player
  // pressed Wake: it holds the stage from the tap until its act ends (or the wake comes to nothing).
  const wake = useWake();
  const reduced = usePrefersReducedMotion();
  const held = useWakeRun()?.focus ?? null;

  // The word the player put on stage (arrows, swipe, keys, or a card). Until they choose one, the
  // stage shows the neediest word, holding a woken one while it takes its bow.
  const [chosen, setChosen] = useState<string | null>(null);
  // Which side the next word slides in from (SceneFrame). None on first show.
  const [enter, setEnter] = useState<"next" | "prev" | null>(null);
  // The act is over: the next sleepy word steps up, from the right. The side is set WHILE
  // rendering, in the very render the stage lets go of the woken word: SceneFrame takes the side
  // at the moment its word changes, so an effect (one render late) would leave the next word to
  // pop in with no slide (Bugbot on #334).
  const [heldSeen, setHeldSeen] = useState<string | null>(null);
  if (held !== heldSeen) {
    setHeldSeen(held);
    if (heldSeen && !held) setEnter("next");
  }

  const indexOf = (name: string | null) => (name ? items.findIndex((i) => i.word.word === name) : -1);
  const featured = indexOf(chosen) >= 0 ? chosen : indexOf(held) >= 0 ? held : (items[0]?.word.word ?? null);
  const idx = indexOf(featured);
  const item = idx >= 0 ? items[idx] : null;
  // The featured word stands in its own scene (scenes/useWordScene: the player's pick, else the stock card).
  const { scene } = useWordScene(item?.word.word);
  const number = useCardNumber(item?.word.word);
  // A word in a case shows in it (cards/CardCase; decisions.md #42).
  const cases = useWordCases();
  const casedNow = item ? cases.cased.has(item.word.word) : false;
  // The card turned over, remembered with its word and how it is shown (bare, or in its case): the
  // next word opens on its scene, and so does a card that has just gone into a case or come out.
  const [isBack, setIsBack] = useFlipOf(item ? flipKey(item.word.word, casedNow) : null);

  // This card's part in a wake: what its letters wear from the tap to the bow.
  const act = useWakeAct(item?.word.word ?? "", true);

  if (!item) return state.status === "ready" ? <EmptyStage /> : null;
  const w = item.word;
  const W = w.word;
  const mood = item.mood;
  const gild = Math.max(0, Math.min(5, Math.round(w.prestigeLevel))) as Gild; // 5 = Holographic
  const open = () => g.openSheet({ kind: "word", word: W });
  const face = mood === "unstaked" || mood === "forSale" ? "idle" : careState(w);
  const many = items.length > 1;
  const cased = casedNow;
  // What the star earned at the latest payout, for its line (only when it earned something).
  const mineEarned = g.earnings?.byWord[W];
  const earnedLatest =
    mineEarned && mineEarned.latest > 0 && g.earnings?.latestAt
      ? { amount: fmtWord(mineEarned.latest), when: payoutWhen(g.earnings.latestAt) }
      : undefined;

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

  const marks = stageMarks(markInput(w, mood, { justFed: act.acting, earned: earnedLatest }));
  // The pager's arrows: beside the count on the placard, off the art.
  const pagerArrow = (step: 1 | -1) => {
    const Icon = step === 1 ? CaretRight : CaretLeft;
    return (
      <button onClick={() => go(step)} aria-label={step === 1 ? "Next word" : "Previous word"} className="tt-nav round-btn group">
        <Icon weight="bold" size={14} className={`transition-transform duration-200 ${step === 1 ? "motion-safe:group-hover:translate-x-0.5" : "motion-safe:group-hover:-translate-x-0.5"}`} />
      </button>
    );
  };

  const stageFront = (
    <SceneFrame
      scene={scene}
      word={W}
      upper={w.upper}
      state={face}
      states={act.states}
      armsUp={act.armsUp}
      moments={act.moments}
      tone={act.tone ?? toneOf(face)}
      gild={gild}
      tier={w.tier}
      number={number}
      enter={enter}
      animated={!isBack && !state.sheet}
      // a tap on the word opens it; while it takes its bow, a tap ends the act
      onWord={act.acting ? act.hurry : open}
      wordLabel={`Open ${W}`}
      onSwipe={many ? go : undefined}
    />
      
  );

  return (
    <section aria-label={`${W} on stage`} className="space-y-3" onKeyDown={onKeyDown}>
      <div className="tt">
        {/* The word's card: its front, and its story on the back (components/cards). The card
            holds still while nobody can see it: its back is up, or a sheet covers it (the opened
            word's own card moves then, and one moving card at a time is the rule). */}
        {cased ? (
          // in its case (cards/CardCase): turned with its corner button here, since a drag on the
          // stage is the swipe to the next word
          <CardCase key={W} word={w} className="tt-case" since={cases.cased.get(W)} onFlip={setIsBack} front={stageFront} />
        ) : (
          <SceneCard word={w} framed className="tt-card card-stand" flipped={isBack} onFlip={setIsBack} live={!state.sheet} front={stageFront} />
        )}
        {/* The placard: how the word stands, the one thing to do, and which of your words this is. */}
        <div className="tt-plate">
          {/* the same status as one sentence, for a screen reader, said again when it changes */}
          <p className="sr-only" aria-live="polite">
            {act.acting ? `${W} is awake again. Thank you!` : stageLine({ word: w, mood }, earnedLatest)}
          </p>
          <StatusMarks marks={marks} />
          <div className="tt-actions">
            {(mood === "hungry" || mood === "peckish") && (
              <>
                <Button
                  variant="teal"
                  className={PRIMARY}
                  onClick={() => wake([w], { focus: W, reduced })}
                >
                  <Alarm weight="fill" /> Wake {W}
                </Button>
                {toFeed.length > 1 && (
                  <Button
                    variant="ghost"
                    className={SECOND}
                    onClick={() => wake(toFeed, { all: true, focus: W, reduced })}
                  >
                    Wake all {toFeed.length}
                  </Button>
                )}
              </>
            )}
            {mood === "unstaked" && (
              <Button variant="teal" className={PRIMARY} onClick={() => g.toggleStake(W)}>
                <Ticket weight="fill" /> Stake {W}
              </Button>
            )}
            {mood === "full" && (
              <Button variant="ghost" className={PRIMARY} onClick={open}>
                Open {W}
              </Button>
            )}
            {mood === "forSale" && (
              <Button variant="ghost" className={PRIMARY} onClick={() => g.nav("swap")}>
                <Storefront weight="fill" /> See it in the Market
              </Button>
            )}
            {/* The star is full (or waiting to be staked) but others want food: Feed all stays one tap
                away, whichever word the pager has put on stage. */}
            {mood !== "hungry" && mood !== "peckish" && toFeed.length > 0 && (
              <Button variant="ghost" className={SECOND} onClick={() => wake(toFeed, { all: true, reduced })}>
                <Alarm weight="fill" /> {feedAllLabel(toFeed)}
              </Button>
            )}
            <Button
              variant="ghost"
              className="shrink-0 !px-3"
              aria-label={`Pick ${W}’s card face`}
              title="Pick a card face"
              onClick={() => g.openSheet({ kind: "scene", word: W })}
            >
              <Palette weight="fill" size={18} />
            </Button>
          </div>
          {/* What the words earned at the latest payout (decisions.md #16); opens Your earnings. */}
          <div className="empty:hidden">
            <EarningsLine />
          </div>
          {/* Which of your words this is, and the way to the others (a swipe and the arrow keys too). */}
          {many && (
            <div className="tt-pager">
              {pagerArrow(-1)}
              {items.length <= PAGER_DOTS && (
                <span className="tt-dots" aria-hidden>
                  {items.map((it, k) => (
                    <i key={it.word.word} className={k === idx ? "on" : ""} />
                  ))}
                </span>
              )}
              <span className="tt-count">
                Word {idx + 1} of {items.length}
              </span>
              {pagerArrow(1)}
            </div>
          )}
        </div>
      </div>

      {toFeed.length > 0 && <ReminderToggle compact />}

      {/* Up next: the words → brings, then the Bag. A card puts its word on stage. */}
      <div className="grid grid-cols-2 gap-2">
        {upNext(items, idx, UP_NEXT).map(({ word: o, mood: m }) => (
          <UpNextCard key={o.word} word={o} mood={m} onShow={() => show(o.word, "next")} />
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
 * No word of the connected wallet's to stand on the stage: a blank stock card waits, and its
 * placard says what to do for this player (emptyStageCase). The top left of Today is the player's words, so it is
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
    start: "Your words will live here, each on a card of its own. Start with some letters.",
  };
  return (
    <section aria-label="Your stage" aria-busy={shape === "loading"} className="tt">
      {/* a blank stock card where the player's first word will stand */}
      <div className="tt-card card-stand">
        <div className="tt-blank card-corner">
          <SceneFrame scene="stock" word="" upper={[]} />
        </div>
      </div>
      {/* the placard: the one line for this player, and its one button */}
      <div className="tt-plate">
        {say[shape] && <p className="text-balance text-center text-sm font-bold">{say[shape]}</p>}
        <div className="tt-actions">
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
      </div>
    </section>
  );
}
