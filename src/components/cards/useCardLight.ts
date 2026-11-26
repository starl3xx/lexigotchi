"use client";
/**
 * The card's own light (decisions.md #33): the only motion a card with a still scene has, and only
 * on the card in focus (the Today stage, an opened word). starl3xx, 2026-11-25: "the only
 * animation for still scenes should be something that makes the card itself look cool, not the
 * objects in the scene", and then, of the first version: "much more subtle/transparent".
 *
 * - **A band of light crosses the front** a moment after the card appears, then every few seconds
 *   (the rarity's own beat, lib/rarityFinish: rarer cards more often), and when the pointer arrives.
 * - **The card leans toward the pointer** by a few degrees, and a faint round glare follows it.
 *   Only a mouse has a pointer to lean to: on a phone the band alone plays.
 *
 * Each is one element sliding or turning (globals.css, `.sc-sheen`, `.sc-glare`, `.sc-lean`), so
 * the scene and the letters are not redrawn for it. One timer a card; nothing loops.
 *
 * Two things keep the lean cheap, both measured in WebKit with the pointer moving all the time:
 * - The transforms are written straight onto the two elements, never passed down as custom
 *   properties: those are inherited, so every shape inside the card had its style worked out again.
 * - No CSS transition while it follows. A transition restarted on every frame cost a third of a
 *   processor core; following directly costs nothing measurable. The card eases only as the
 *   pointer arrives and as it leaves (`.sc-ease`, for a moment).
 */
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { Tier } from "@/lib/economy";
import { finishFor } from "@/lib/rarityFinish";

/** The most the card leans toward the pointer, in degrees (up and down, side to side). */
const LEAN_X = 2.5;
const LEAN_Y = 3.5;
/** How long the band takes to cross (globals.css, sc-sheen), and a little more. */
const SHEEN_MS = 1360;
/** A Common card has no finish and so no beat of its own: it takes the slowest. */
const PLAIN_PERIOD = 11;

/**
 * The band, drawn at full strength here and shown faint (globals.css gives it its peak opacity).
 * White for most, warm for Legendary, a spectrum for Mythic: the rainbow is Mythic's and
 * Holographic's alone, as on the tiles.
 */
export const CARD_SHEEN: Record<Tier, string> = {
  Common: "linear-gradient(100deg, transparent, rgb(255 255 255 / 0.7) 45%, rgb(255 255 255 / 0.25) 58%, transparent)",
  Uncommon: "linear-gradient(100deg, transparent, rgb(255 255 255 / 0.7) 45%, rgb(255 255 255 / 0.25) 58%, transparent)",
  Rare: "linear-gradient(100deg, transparent, rgb(255 255 255 / 0.75) 45%, rgb(255 255 255 / 0.28) 58%, transparent)",
  Legendary: "linear-gradient(100deg, transparent, rgb(255 236 180 / 0.85) 42%, rgb(255 255 255 / 0.6) 52%, rgb(255 226 150 / 0.4) 62%, transparent)",
  Mythic: "linear-gradient(100deg, transparent, rgb(255 154 213 / 0.5) 28%, rgb(255 226 138 / 0.55) 41%, rgb(255 255 255 / 0.75) 50%, rgb(143 240 208 / 0.55) 59%, rgb(142 197 255 / 0.5) 72%, transparent)",
};

type Move = { clientX: number; clientY: number; pointerType?: string };

export function useCardLight({
  root,
  lean,
  glare,
  active,
  tier,
}: {
  /** The card: the pointer is read against its box, and it is watched for being on screen. */
  root: RefObject<HTMLElement | null>;
  /** The element that leans (the two faces and the buttons, together). */
  lean: RefObject<HTMLElement | null>;
  glare: RefObject<HTMLElement | null>;
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
  const play = useCallback(() => {
    if (!lit || busy.current) return;
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

  // The lean and the glare: at most once a frame, eased only on the way in and out.
  const frame = useRef(0);
  const easing = useRef(0);
  const at = useRef({ x: 0, y: 0 });
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
    if (glare.current) glare.current.style.transform = "";
  }, [lean, glare]);
  // A card that stops being lit (it turned over, a sheet covered it, it left the screen) stands straight.
  useEffect(() => {
    if (!lit) settle();
  }, [lit, settle]);
  useEffect(
    () => () => {
      window.cancelAnimationFrame(frame.current);
      window.clearTimeout(easing.current);
    },
    [],
  );

  const handlers = lit
    ? {
        onPointerEnter: (e: { pointerType?: string }) => {
          play();
          if (!e.pointerType || e.pointerType === "mouse") ease(200);
        },
        onPointerMove: (e: Move) => {
          if (e.pointerType && e.pointerType !== "mouse") return; // a touch has no pointer to lean to
          const el = root.current;
          if (!el) return;
          const r = el.getBoundingClientRect();
          if (!r.width || !r.height) return;
          at.current = { x: ((e.clientX - r.left) / r.width) * 2 - 1, y: ((e.clientY - r.top) / r.height) * 2 - 1 };
          if (frame.current) return;
          frame.current = window.requestAnimationFrame(() => {
            frame.current = 0;
            const x = Math.max(-1, Math.min(1, at.current.x));
            const y = Math.max(-1, Math.min(1, at.current.y));
            if (lean.current) lean.current.style.transform = `rotateX(${(-y * LEAN_X).toFixed(2)}deg) rotateY(${(x * LEAN_Y).toFixed(2)}deg)`;
            if (glare.current) glare.current.style.transform = `translate(${(x * 62).toFixed(1)}%, ${(y * 34).toFixed(1)}%)`;
          });
        },
        onPointerLeave: () => {
          ease(280);
          settle();
        },
      }
    : {};
  return { lit, sheen: sheen && lit, handlers };
}
