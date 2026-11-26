"use client";
/**
 * A word's card: its front (the word in its scene, scenes/SceneFrame), its story on the back
 * (./CardBack), and a button in the top right corner that turns it over (starl3xx, 2026-11-25: "a flip icon/button ... maybe the top
 * right ... flip animation to the back"). The card turns in 3D (globals.css, `.sc`); under reduced
 * motion the faces cross-fade instead.
 *
 * - The flip belongs to the word: a host that shows another word in the same card (the Today
 *   stage's arrows) gets it on its scene, never on the last word's back.
 * - The back mounts the first time the card turns over, so a page of cards reads nothing and draws
 *   no backs until someone looks.
 * - While the back is up the front can't be reached (inert), and the host is told (`onFlip`), so it
 *   can hold the scene still: nobody sees it.
 * - The card in focus catches the light (./useCardLight): a faint band crosses its front now and
 *   then, and it leans a little toward the pointer. A card in a grid (`small`) never does, nor one
 *   whose word is hungry (its shine is gone until it is fed). The lean is outside the flip
 *   (`.sc-lean` holds `.sc-inner`), and it rests while the back is up or the card is turning.
 *
 * Controlled (`flipped` + `onFlip`) or not (it keeps its own state).
 */
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { hunger, type OwnedWord } from "../game/state";
import { CardBack } from "./CardBack";
import { askForTilt } from "./live/tilt";
import { canDrawLive } from "./live/support";
import { useLowPower, usePrefersReducedMotion } from "../game/TileCharacter";
import { CARD_SHEEN, useCardLight } from "./useCardLight";

/** How long the turn takes (globals.css, `.sc-inner`'s transition and `.sc.is-flipping`). */
export const FLIP_MS = 850;

export function SceneCard({
  word,
  front,
  flipped: controlled,
  onFlip,
  small = false,
  framed = false,
  onOpen,
  live = true,
  className = "",
}: {
  word: OwnedWord;
  /** The front: the word standing in its scene (scenes/SceneFrame). */
  front: ReactNode;
  flipped?: boolean;
  onFlip?: (back: boolean) => void;
  /** A thumbnail (the Bag's grid): the back's short form, and a smaller button. */
  small?: boolean;
  /** Draw the card's own outline and corners (a card on the page); off where the host frames it. */
  framed?: boolean;
  /** Tapping the card, either side, opens the word (a card in the Bag). A sibling of the flip
   *  button, never around it: one button can't hold another. */
  onOpen?: () => void;
  /** Draw a showing back live (./live): off while something covers the card (a sheet over the Today
   *  stage), so only the card in focus holds the one live context. */
  live?: boolean;
  className?: string;
}) {
  const reduced = usePrefersReducedMotion();
  const lowPower = useLowPower();
  // Uncontrolled: the flip, remembered with the word it belongs to.
  const [own, setOwn] = useState<{ word: string; back: boolean }>({ word: word.word, back: false });
  const back = controlled ?? (own.word === word.word && own.back);
  // The back, once mounted for this word, stays for the turn home.
  const [seen, setSeen] = useState<string | null>(null);
  const showBack = back || seen === word.word;
  const [turning, setTurning] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const flip = () => {
    const next = !back;
    if (next) setSeen(word.word);
    // the tap that turns a card in focus over is the one iOS lets ask for the tilt (live/tilt)
    if (next && !small && live && !reduced && !lowPower && canDrawLive()) askForTilt();
    setOwn({ word: word.word, back: next });
    onFlip?.(next);
    setTurning(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setTurning(false), FLIP_MS);
  };

  // The card's own light: only the card in focus, front up, at rest, with a word that isn't hungry.
  const root = useRef<HTMLDivElement>(null);
  const lean = useRef<HTMLDivElement>(null);
  const glare = useRef<HTMLElement>(null);
  const light = useCardLight({ root, lean, glare, tier: word.tier, active: live && !small && !back && !turning && !reduced && !lowPower && hunger(word) !== "hungry" });

  const W = word.word;
  return (
    <div
      ref={root}
      className={`sc ${back ? "is-back" : ""} ${turning ? "is-flipping" : ""} ${small ? "sc-small" : ""} ${framed ? "sc-framed" : ""} ${light.lit ? "is-lit" : ""} ${light.sheen ? "sc-moment" : ""} ${className}`}
      style={{ "--sc-sheen": CARD_SHEEN[word.tier] } as CSSProperties}
      {...light.handlers}
    >
      <div ref={lean} className="sc-lean">
        <div className="sc-inner">
          <div className="sc-face sc-front" inert={back} aria-hidden={back || undefined}>
            {front}
            {light.lit && <i ref={glare} aria-hidden className="sc-glare" />}
            {light.lit && <i aria-hidden className="sc-sheen" />}
          </div>
          {showBack && (
            <div className="sc-face sc-back" inert={!back} aria-hidden={!back || undefined}>
              <CardBack word={word} mini={small} live={back && live} />
            </div>
          )}
        </div>
        {onOpen && <button type="button" className="sc-open" onClick={onOpen} aria-label={`Open ${W}`} />}
        <button
          type="button"
          className="sc-flip"
          onClick={(e) => {
            // a card in a list opens its word when tapped: turning it over shouldn't
            e.stopPropagation();
            flip();
          }}
          aria-label={back ? `Show ${W}’s scene` : `Turn ${W} over`}
          title={back ? "Show the scene" : "Turn it over"}
        >
          <FlipIcon />
        </button>
      </div>
    </div>
  );
}

export function FlipIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden>
      <path d="M4 12a8 8 0 0 1 13.7-5.6" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
      <path d="M18.5 2.8v4.2h-4.2" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M20 12a8 8 0 0 1-13.7 5.6" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
      <path d="M5.5 21.2V17h4.2" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
