"use client";
/**
 * The card's own light (decisions.md #34): the only motion a card with a still scene has, and only
 * on the card in focus (the Today stage, an opened word). starl3xx, 2026-11-25: "the only
 * animation for still scenes should be something that makes the card itself look cool, not the
 * objects in the scene", and then, of the first version: "much more subtle/transparent".
 *
 * - **A band of light crosses the front** a moment after the card appears, then every few seconds
 *   (the rarity's own beat, lib/rarityFinish: rarer cards more often), and when the pointer arrives.
 *   The band is DRAWN: ruled lines that stand still on the card, shown through a soft window that
 *   crosses it, under the letters (decisions.md #58, part 3; lib/cardArt/light; the front draws it,
 *   scenes/SceneFrame). It was a soft white gradient over the whole front.
 * - **The card leans toward the pointer** by a few degrees, and **the pointer moves the band**
 *   (decisions.md #65): while a mouse is over the card the band stands under it, and no timed
 *   pass plays. Only a mouse has a pointer to lean to: on a phone the band passes by itself.
 *   There was a round white glare under the pointer. It is gone: a bright spot is a hot spot, it
 *   lay over the letters, and the cards are matte (decisions.md #58).
 *
 * Each is an element sliding or turning (globals.css, `.cf-light`, `.sc-lean`), so the scene and
 * the letters are not redrawn for it. One timer a card; nothing loops.
 *
 * Two things keep the lean and the held band cheap, both measured in WebKit with the pointer
 * moving all the time:
 * - The transforms are written straight onto the elements, never passed down as custom
 *   properties: those are inherited, so every shape inside the card had its style worked out again.
 * - No CSS transition while it follows. A transition restarted on every frame cost a third of a
 *   processor core; following directly costs nothing measurable. The card and the band ease only
 *   as the pointer arrives and as it leaves (`.sc-ease`, for a moment).
 */
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { Tier } from "@/lib/economy";
import { finishFor } from "@/lib/rarityFinish";
import { lightBand } from "@/lib/cardArt/light";

/** The most the card leans toward the pointer, in degrees (up and down, side to side). */
const LEAN_X = 2.5;
const LEAN_Y = 3.5;
/** How long the band takes to cross (globals.css, cf-light), and a little more. */
const SHEEN_MS = 1360;
/** A Common card has no finish and so no beat of its own: it takes the slowest. */
const PLAIN_PERIOD = 11;

/**
 * The band's window, in hundredths of the card's width (cqw in the styles): how wide it is, and
 * where its left edge stands when it rests off the card's left side and off its right.
 */
const BAND = lightBand().box;
const OFF_LEFT = -BAND;
const OFF_RIGHT = 100;

type Move = { clientX: number; clientY: number; pointerType?: string };
const isMouse = (e: { pointerType?: string }) => !e.pointerType || e.pointerType === "mouse";

export function useCardLight({
  root,
  lean,
  active,
  tier,
}: {
  /** The card: the pointer is read against its box, and it is watched for being on screen. */
  root: RefObject<HTMLElement | null>;
  /** The element that leans (the two faces and the buttons, together). */
  lean: RefObject<HTMLElement | null>;
  /** The card is in focus, its front is up, and motion is welcome. */
  active: boolean;
  tier: Tier;
}) {
  // Off screen, the band has nobody to cross for.
  const [seen, setSeen] = useState(true);
  useEffect(() => {
    const el = root.current;
    if (!active || !el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => setSeen(e.isIntersecting));
    io.observe(el);
    return () => io.disconnect();
  }, [root, active]);
  const lit = active && seen;

  // The band: one moment at a time.
  const [sheen, setSheen] = useState(false);
  const busy = useRef(false);
  const ending = useRef(0);
  // A mouse on the card holds the band under it: the timed pass waits until it has gone.
  const held = useRef(false);
  const play = useCallback(() => {
    if (!lit || busy.current || held.current) return;
    busy.current = true;
    setSheen(true);
    ending.current = window.setTimeout(() => {
      busy.current = false;
      setSheen(false);
    }, SHEEN_MS);
  }, [lit]);
  const period = finishFor(tier)?.period ?? PLAIN_PERIOD;
  useEffect(() => {
    if (!lit) return;
    let next = window.setTimeout(function tick() {
      play();
      next = window.setTimeout(tick, period * 1000);
    }, 1200);
    return () => {
      window.clearTimeout(next);
      window.clearTimeout(ending.current);
      busy.current = false;
      setSheen(false);
    };
  }, [lit, period, play]);

  // The lean and the held band: at most once a frame, eased only on the way in and out.
  const frame = useRef(0);
  const easing = useRef(0);
  const letGo = useRef(0);
  const at = useRef({ x: 0, y: 0 });
  // The band is the front's to draw (scenes/SceneFrame), so the card finds it: the window, and
  // the ruled lines inside it. The two always move by the same length, opposite ways, so the
  // lines stand still on the card (as in the timed pass: globals.css, cf-light, cf-light-back).
  const band = useCallback(() => {
    const win = root.current?.querySelector<HTMLElement>(".sc-front .cf-light");
    const lines = win?.firstElementChild as HTMLElement | null | undefined;
    return win && lines ? { win, lines } : null;
  }, [root]);
  /** Stand the window with its left edge `left` hundredths of the card's width in; null lets it rest. */
  const stand = useCallback(
    (left: number | null) => {
      const b = band();
      if (!b) return;
      b.win.style.transform = left === null ? "" : `translateX(${left.toFixed(2)}cqw)`;
      b.lines.style.transform = left === null ? "" : `translateX(${(-left).toFixed(2)}cqw)`;
    },
    [band],
  );
  /**
   * Where the window stands NOW, in the same measure, read from the screen: a timed pass, or the
   * slide off after the pointer's last visit, may be carrying it. Null if it can't be read.
   */
  const standing = (b: { win: HTMLElement; lines: HTMLElement }) => {
    const card = b.lines.offsetWidth; // the lines are as wide as the card
    if (!card || typeof DOMMatrixReadOnly === "undefined") return null;
    const left = (new DOMMatrixReadOnly(getComputedStyle(b.win).transform).m41 / card) * 100;
    return Number.isFinite(left) ? left : null;
  };
  /** Where the window's left edge stands for a pointer `x` across the card (-1 to 1): its middle under the pointer. */
  const under = (x: number) => ((Math.max(-1, Math.min(1, x)) + 1) / 2) * 100 - BAND / 2;
  const read = useCallback(
    (e: Move) => {
      const r = root.current?.getBoundingClientRect();
      if (!r || !r.width || !r.height) return false;
      at.current = { x: ((e.clientX - r.left) / r.width) * 2 - 1, y: ((e.clientY - r.top) / r.height) * 2 - 1 };
      return true;
    },
    [root],
  );
  const ease = useCallback(
    (ms: number) => {
      lean.current?.classList.add("sc-ease");
      window.clearTimeout(easing.current);
      easing.current = window.setTimeout(() => lean.current?.classList.remove("sc-ease"), ms);
    },
    [lean],
  );
  const settle = useCallback(() => {
    window.cancelAnimationFrame(frame.current);
    frame.current = 0;
    if (lean.current) lean.current.style.transform = "";
  }, [lean]);
  // A card that stops being lit (it turned over, a sheet covered it, it left the screen) stands
  // straight, and lets the band go: no pointer holds a card that is not lit.
  useEffect(() => {
    if (lit) return;
    settle();
    window.clearTimeout(letGo.current);
    held.current = false;
    stand(null);
  }, [lit, settle, stand]);
  useEffect(
    () => () => {
      window.cancelAnimationFrame(frame.current);
      window.clearTimeout(easing.current);
      window.clearTimeout(letGo.current);
    },
    [],
  );

  /**
   * A mouse arrives: it came onto the card, or it moved on a card that was lit under it (a card
   * turned back to its front is told of no "enter"). The band comes to the pointer FROM WHERE IT
   * IS, eased: part way across, if a timed pass or the slide off after the last visit was
   * carrying it, or else from off the side the pointer is nearer. Never a jump (Bugbot on #335:
   * a pointer back within the slide threw the band off the card first, and a card lit under a
   * still pointer had its band pop in).
   */
  const arrive = (e: Move) => {
    held.current = true;
    window.clearTimeout(letGo.current);
    const b = band();
    const seen = read(e);
    if (b && seen) {
      const now = standing(b);
      const onCard = now !== null && now > OFF_LEFT + 0.5 && now < OFF_RIGHT - 0.5;
      // A timed pass ends here, at once: its animation outranks the pointer for as long as it
      // runs. (The class is React's, and the render that follows takes it off too.)
      root.current?.classList.remove("sc-moment");
      // written with no transition first, so the ease that follows starts from there
      lean.current?.classList.remove("sc-ease");
      stand(onCard ? now : at.current.x < 0 ? OFF_LEFT : OFF_RIGHT);
      void b.win.offsetWidth;
    }
    window.clearTimeout(ending.current);
    busy.current = false;
    setSheen(false);
    ease(240);
    if (b && seen) stand(under(at.current.x));
  };

  const handlers = lit
    ? {
        onPointerEnter: (e: Move) => {
          // a touch has no pointer to hold the band: it passes, as it does on its own beat
          if (!isMouse(e)) return play();
          arrive(e);
        },
        onPointerMove: (e: Move) => {
          if (!isMouse(e)) return; // a touch has no pointer to lean to
          // not held yet: the card was lit under a pointer that never left it, and this is its arrival
          if (!held.current) arrive(e);
          else if (!read(e)) return;
          if (frame.current) return;
          frame.current = window.requestAnimationFrame(() => {
            frame.current = 0;
            const x = Math.max(-1, Math.min(1, at.current.x));
            const y = Math.max(-1, Math.min(1, at.current.y));
            if (lean.current) lean.current.style.transform = `rotateX(${(-y * LEAN_X).toFixed(2)}deg) rotateY(${(x * LEAN_Y).toFixed(2)}deg)`;
            stand(under(x));
          });
        },
        onPointerLeave: () => {
          ease(280);
          settle();
          // the band slides off the side nearer the pointer, then rests where the styles keep it
          held.current = false;
          stand(at.current.x < 0 ? OFF_LEFT : OFF_RIGHT);
          window.clearTimeout(letGo.current);
          letGo.current = window.setTimeout(() => stand(null), 300);
        },
      }
    : {};
  return { lit, sheen: sheen && lit, handlers };
}
