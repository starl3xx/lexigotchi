"use client";
/**
 * The lockup, drawn live (decisions.md #56; lib/cardArt/logo `lockup`): the tile that is the name's
 * L, then EXIGOTCHI. With `alive` its eyes blink and glance, as a letter's do (starl3xx,
 * 2026-11-27: "9E is amazing").
 *
 * - **Moments, never a loop.** One timer a lockup sets a class on the drawing for the moment of a
 *   blink or a glance, and takes it off. Nothing runs between: a loop inside a drawing makes WebKit
 *   redraw it every frame, and this one is in the header of every screen.
 * - **A lockup nobody sees does nothing:** a hidden tab, or the copy the screen's width hides (the
 *   rail on a phone, the header's on a wide screen). Reduced motion and a low-power device get a
 *   still one.
 * - **Each drawing has its own ids.** Two lockups are in the page at once (the rail's and the
 *   header's), and a gradient named twice can resolve to the hidden one and paint nothing.
 * - A blink is a swap of two drawings (globals.css, .lk), as a letter's is. Nothing changes size.
 */
import { useEffect, useId, useMemo, useRef } from "react";
import { lockup } from "@/lib/cardArt/logo";
import { useLowPower, usePrefersReducedMotion } from "../game/TileCharacter";

/** How long the eyes stay shut, and how long a glance is held (ms). */
export const BLINK_MS = 130;
export const GLANCE_MS = 1500;

export function Lockup({ height, alive = false, tone = "paper", className = "" }: { /** The whole drawing's height in px: the tile is 88% of it, the capitals 51%. */ height: number; alive?: boolean; tone?: "paper" | "dark"; className?: string }) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
  const art = useMemo(() => lockup({ tone, alive, prefix: `lk${id}-` }), [tone, alive, id]);
  const ref = useRef<SVGSVGElement>(null);
  const reduced = usePrefersReducedMotion();
  const lowPower = useLowPower();
  useEffect(() => {
    const el = ref.current;
    if (!alive || reduced || lowPower || !el) return;
    const pending = new Set<number>();
    const later = (fn: () => void, ms: number) => {
      const t = window.setTimeout(() => {
        pending.delete(t);
        fn();
      }, ms);
      pending.add(t);
    };
    const flash = (cls: string, ms: number) => {
      el.classList.add(cls);
      later(() => el.classList.remove(cls), ms);
    };
    const moment = () => {
      later(moment, 2600 + Math.random() * 3200);
      if (document.hidden || el.getClientRects().length === 0) return;
      if (Math.random() < 0.72) {
        flash("is-blink", BLINK_MS);
        if (Math.random() < 0.25) later(() => flash("is-blink", BLINK_MS), 280); // now and then, twice
      } else flash(Math.random() < 0.5 ? "is-left" : "is-right", GLANCE_MS);
    };
    later(moment, 1400 + Math.random() * 1600);
    return () => {
      pending.forEach((t) => window.clearTimeout(t));
      el.classList.remove("is-blink", "is-left", "is-right");
    };
  }, [alive, reduced, lowPower]);
  return (
    <svg
      ref={ref}
      className={className ? `lk ${className}` : "lk"}
      viewBox={`0 0 ${art.width} ${art.height}`}
      width={Math.round((height * art.width) / art.height)}
      height={height}
      role="img"
      aria-label="Lexigotchi"
      dangerouslySetInnerHTML={{ __html: art.markup }}
    />
  );
}
