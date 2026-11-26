"use client";
/**
 * A word's card in its plastic case (decisions.md #42; lib/shop/cases says what a case is): a clear
 * slab, the kind a graded trading card is sealed in, with a paper label across the top and the
 * card held in a well (starl3xx, 2026-11-25: "a plastic case (like PSA-rated cards)... should be
 * able to rotate like the card does now"; then "the plastic case is SO COOL").
 *
 * It stands in for ./SceneCard wherever a cased word's card is in focus, and it is the card's one
 * turn: the case turns over, and the card's back is in its other side. There is no second flip
 * inside it.
 *
 * - **The label never names the word** (words are only ever set in Söhne, and the card under the
 *   label already says it). The front says what the card's ribbon says, in the ribbon's order: one
 *   of one, the number, the rarity. The back says who found the word, when it was cased, and that
 *   the game sealed it, with the game's seal, its rim in the label's ink.
 * - **The number is the chain's** (./useCardNumber), and the label leaves it out while unknown.
 * - **It turns with its corner button, and with a drag where `drag` is set** (an opened word; the
 *   Today stage's drag is the swipe between words). A drag is sideways only on a touch screen, so
 *   the page still scrolls under a finger. Let go, it rests on the nearer side, a little turned so
 *   the case's thickness shows.
 * - **It draws only while it is being turned.** There is no idle spin and no loop. Every angle,
 *   a drag's and the settle's, is written straight to the element, a frame at a time, with no CSS
 *   transition and no render (a restarted transition each frame cost a third of a core on the
 *   card's lean).
 * - **Which side shows is decided here, from the angle,** on every frame it is drawn, never by
 *   `backface-visibility`: WebKit doesn't hide these sides from behind, and drew the back mirrored
 *   over the front in the middle of a turn. So a let-go case rests on the side that is showing
 *   (`nearestSide` splits at the same 90 degrees), and no turn ever shows a side from behind.
 * - Under reduced motion nothing turns: the sides swap, and there is no drag.
 * - The back is the card's own (./CardBack), still: the live light isn't drawn under the plastic.
 */
import { useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { svgDataUri, svgDoc } from "@/lib/cardArt/engrave";
import { CARD_LOOKS } from "@/lib/cardArt/looks";
import { LOGO, logoB } from "@/lib/cardArt/logo";
import { cardDate, cardDigits } from "@/lib/cardFacts";
import { TierMark } from "../game/TierMark";
import { usePrefersReducedMotion } from "../game/TileCharacter";
import type { OwnedWord } from "../game/state";
import { CardBack, foundBySays } from "./CardBack";
import { FlipIcon } from "./SceneCard";
import { useCardFacts } from "./useCardFacts";
import { useCardNumber } from "./useCardNumber";

/** How the case rests: a little turned, so its thickness shows (degrees). */
export const CASE_REST = { x: -5, y: -14 } as const;
/** How long it takes to turn over, or to settle on a side when let go. */
export const CASE_TURN_MS = 560;
/** How far a pointer moves before a press becomes a drag (px): a tap on the card is not a turn. */
const DRAG_START = 5;
/** Degrees turned per pixel dragged sideways, and tilted per pixel up or down (a mouse only). */
const TURN_PER_PX = 0.55;
const TILT_PER_PX = 0.3;
const TILT_MAX = 22;

/** The angle the case rests at on a side (degrees round its upright axis): `turns` half-turns from the front. */
export function restAngle(turns: number): number {
  return turns * 180 + CASE_REST.y;
}

/** Whether an angle shows the case's back: past edge-on, either way round. */
export function showsBack(degrees: number): boolean {
  const a = ((degrees % 360) + 360) % 360;
  return a > 90 && a < 270;
}

/**
 * The side a dragged case rests on when let go, in half-turns from the front: the one that is
 * showing. It splits at edge-on, where `showsBack` does, so settling never passes edge-on.
 */
export function nearestSide(degrees: number): number {
  return Math.round(degrees / 180);
}

/** The settle's easing: fast, then gentle (an ease-out cubic). */
const ease = (t: number) => 1 - Math.pow(1 - t, 3);

/** Whether a count of half-turns shows the back. */
export function isBackSide(turns: number): boolean {
  return ((turns % 2) + 2) % 2 === 1;
}

/** The game's seal in colour (lib/cardArt/logo, B), round, as a picture a label can show. */
let sealUri: string | null = null;
const seal = () => (sealUri ??= svgDataUri(svgDoc(logoB({ round: true }), LOGO, LOGO)));

export function CardCase({
  word,
  front,
  since,
  drag = false,
  onFlip,
  className = "",
}: {
  word: OwnedWord;
  /** The card's front: the word standing in its scene (scenes/SceneFrame). */
  front: ReactNode;
  /** When the word went into its case (ms), for the back's label. Unknown: the label leaves it out. */
  since?: number | null;
  /** Turn it with a drag too (an opened word's card). Off where a drag means something else. */
  drag?: boolean;
  onFlip?: (back: boolean) => void;
  className?: string;
}) {
  const reduced = usePrefersReducedMotion();
  const number = useCardNumber(word.word);
  // Half-turns from the front. Odd is the back. It only ever counts on from where it is, so the
  // button always turns the case the same way round.
  const [turns, setTurns] = useState(0);
  const back = isBackSide(turns);
  // The back's story is read the first time the back is asked for, as a card's is.
  const [seen, setSeen] = useState(false);
  const [dragging, setDragging] = useState(false);

  const slab = useRef<HTMLDivElement>(null);
  const faces = useRef<{ front: HTMLDivElement | null; back: HTMLDivElement | null }>({ front: null, back: null });
  const frontBtn = useRef<HTMLButtonElement>(null);
  const backBtn = useRef<HTMLButtonElement>(null);
  const frame = useRef(0);
  const from = useRef<{ px: number; py: number; y: number; tilt: boolean; started: boolean } | null>(null);
  // where the case is drawn now: its angle round the upright axis, and its tilt
  const at = useRef<{ y: number; x: number }>({ y: CASE_REST.y, x: CASE_REST.x });

  /** Draw the case at an angle: its transform, and the one side that shows from there. */
  const draw = (y: number, x: number) => {
    at.current = { y, x };
    if (slab.current) slab.current.style.transform = `rotateX(${x.toFixed(1)}deg) rotateY(${y.toFixed(1)}deg)`;
    const backUp = showsBack(y);
    if (faces.current.front) faces.current.front.style.visibility = backUp ? "hidden" : "visible";
    if (faces.current.back) faces.current.back.style.visibility = backUp ? "visible" : "hidden";
  };
  useLayoutEffect(() => {
    draw(at.current.y, at.current.x);
    return () => cancelAnimationFrame(frame.current);
  }, []);

  /** Turn to a side (half-turns from the front), from wherever the case is, and say so. */
  const settle = (next: number, refocus: boolean) => {
    const nowBack = isBackSide(next);
    if (nowBack) setSeen(true);
    setTurns(next);
    if (nowBack !== back) onFlip?.(nowBack);
    cancelAnimationFrame(frame.current);
    const start = { ...at.current };
    const end = restAngle(next);
    const done = () => {
      draw(end, CASE_REST.x);
      // the button that was pressed is on the side now hidden: its twin takes the focus
      if (refocus) (nowBack ? backBtn : frontBtn).current?.focus({ preventScroll: true });
    };
    if (reduced) return done();
    const t0 = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / CASE_TURN_MS);
      if (t >= 1) return done();
      const k = ease(t);
      draw(start.y + (end - start.y) * k, start.x + (CASE_REST.x - start.x) * k);
      frame.current = requestAnimationFrame(step);
    };
    frame.current = requestAnimationFrame(step);
  };

  const down = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag || reduced || e.button !== 0 || (e.target as Element).closest("button")) return;
    from.current = { px: e.clientX, py: e.clientY, y: at.current.y, tilt: e.pointerType === "mouse", started: false };
  };
  const up = () => {
    const f = from.current;
    from.current = null;
    if (!f?.started) return;
    setDragging(false);
    settle(nearestSide(at.current.y), false);
  };

  const move = (e: ReactPointerEvent<HTMLDivElement>) => {
    const f = from.current;
    if (!f) return;
    const dx = e.clientX - f.px;
    const dy = e.clientY - f.py;
    // A mouse moving with no button held turns nothing: a press let go somewhere else leaves no
    // drag behind, and a turn whose release was never seen (the pointer couldn't be held, and it
    // was let go outside the case) ends here, on the side that is showing.
    if (e.pointerType === "mouse" && e.buttons === 0) return up();
    if (!f.started) {
      if (Math.abs(dx) < DRAG_START && (!f.tilt || Math.abs(dy) < DRAG_START)) return;
      // A finger turns the case only with a move that is more sideways than up-and-down: the
      // other is the page scrolling, and a scroll that drifts sideways must not start a turn.
      if (!f.tilt && Math.abs(dx) <= Math.abs(dy)) {
        from.current = null;
        return;
      }
      f.started = true;
      cancelAnimationFrame(frame.current);
      f.y = at.current.y; // from where a settle in flight had got to
      f.px = e.clientX;
      f.py = e.clientY;
      setSeen(true);
      setDragging(true);
      // the turn goes on when the pointer leaves the case; a pointer that can't be held (it has
      // already ended) still turns it while it is over the case
      try {
        e.currentTarget.setPointerCapture?.(e.pointerId);
      } catch {
        /* nothing to hold */
      }
      return;
    }
    draw(f.y + dx * TURN_PER_PX, f.tilt ? Math.max(-TILT_MAX, Math.min(TILT_MAX, CASE_REST.x - dy * TILT_PER_PX)) : CASE_REST.x);
  };
  const look = CARD_LOOKS[word.tier];
  const digits = cardDigits(number);
  const W = word.word;
  const flipButton = (isBack: boolean) => (
    <button
      ref={isBack ? backBtn : frontBtn}
      type="button"
      className="sc-flip"
      onClick={() => settle(turns + 1, true)}
      aria-label={isBack ? `Show ${W}’s scene` : `Turn ${W} over`}
      title={isBack ? "Show the scene" : "Turn it over"}
    >
      <FlipIcon />
    </button>
  );
  const face = (isBack: boolean, label: ReactNode, card: ReactNode) => (
    <div
      ref={(el) => {
        faces.current[isBack ? "back" : "front"] = el;
      }}
      className={`cc-face ${isBack ? "cc-backface" : "cc-frontface"}`}
      inert={back !== isBack}
      aria-hidden={back !== isBack || undefined}
    >
      <i aria-hidden className="cc-plastic" />
      <div className={`cc-label ${isBack ? "cc-label-back" : "cc-label-front"}`}>{label}</div>
      <div className="cc-well">
        <div className="cc-card">
          {card}
          {flipButton(isBack)}
        </div>
      </div>
      <i aria-hidden className="cc-gloss" />
    </div>
  );

  return (
    <div
      className={`cc ${back ? "is-back" : ""} ${dragging ? "is-dragging" : ""} ${drag && !reduced ? "cc-drag" : ""} ${className}`}
      style={{ "--cc-ink": look.ink } as CSSProperties}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      onPointerLeave={() => {
        if (from.current && !from.current.started) from.current = null;
      }}
    >
      <div ref={slab} className="cc-slab">
        {face(
          false,
          <>
            {/* the ribbon's order: one of one, the number, the rarity */}
            <span className="cc-one cf-caps">One of one</span>
            <span className="cc-num">
              {digits && (
                <>
                  <small>No.</small>
                  {digits}
                </>
              )}
            </span>
            <span className="cc-tier">
              <TierMark tier={word.tier} className="cc-mark" />
              <span className="cf-caps">{word.tier}</span>
            </span>
          </>,
          front,
        )}
        {face(true, seen ? <BackLabel word={word} since={since} /> : null, seen ? <CardBack word={word} live={false} /> : null)}
        <i aria-hidden className="cc-edge cc-edge-l" />
        <i aria-hidden className="cc-edge cc-edge-r" />
        <i aria-hidden className="cc-edge cc-edge-t" />
        <i aria-hidden className="cc-edge cc-edge-b" />
      </div>
    </div>
  );
}

/**
 * The back's label: who found the word, when it was cased, and the game's seal. It reads the word's
 * story (./useCardFacts), so it is mounted only once the back is asked for, as the card's back is.
 */
function BackLabel({ word, since }: { word: OwnedWord; since?: number | null }) {
  const facts = useCardFacts(word);
  return (
    <>
      <span className="cc-small">
        Found by <b>{foundBySays(facts.found)}</b>
      </span>
      <span className="cc-small cc-mid">
        {since ? (
          <>
            Cased <b>{cardDate(Math.floor(since / 1000))}</b>
          </>
        ) : null}
      </span>
      <span className="cc-small cc-sealed">
        <span>Sealed by Lexigotchi</span>
        <i aria-hidden className="cc-seal" style={{ backgroundImage: `url("${seal()}")` }} />
      </span>
    </>
  );
}

/**
 * A case with nothing in it but a card's art, for the Shop's own card of the case: still, flat,
 * and with no word on it.
 */
export function CaseThumb({ children }: { children: ReactNode }) {
  return (
    <div className="cc cc-thumb" style={{ "--cc-ink": CARD_LOOKS.Rare.ink } as CSSProperties}>
      <div className="cc-slab">
        <div className="cc-face cc-frontface">
          <i aria-hidden className="cc-plastic" />
          <div className="cc-label cc-label-thumb">
            <span className="cc-one cf-caps">One of one</span>
            <i aria-hidden className="cc-seal" style={{ backgroundImage: `url("${seal()}")` }} />
          </div>
          <div className="cc-well">
            <div className="cc-card">{children}</div>
          </div>
          <i aria-hidden className="cc-gloss" />
        </div>
      </div>
    </div>
  );
}
