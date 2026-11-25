"use client";
/**
 * A card back's material, live (./liveSurface): a canvas over the CSS material, drawn only when the
 * light moves. The light sweeps across once as the back comes up, then follows the pointer over
 * the card, a finger dragging across it, or the phone's tilt (./tilt). Mounted only for a back
 * that is showing on the card in focus (CardBack's `live`), and gone, context and all, the moment
 * the card turns back or leaves.
 *
 * Each mount makes its own canvas: a canvas keeps one context for life, so once a context is let go
 * (`loseContext`) that canvas can never draw again, and React may mount the same component twice.
 *
 * The CSS material stays under it: until the first frame lands, and wherever WebGL won't start.
 */
import { useEffect, useRef, useState } from "react";
import type { CardMaterial } from "../material";
import { attachSurface } from "./liveSurface";
import { lightFromTilt, makeTiltFilter, tiltAllowed } from "./tilt";

export function LiveMaterial({ material }: { material: CardMaterial }) {
  const host = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const box = host.current;
    if (!box) return;
    const el = document.createElement("canvas");
    el.style.cssText = "display:block;width:100%;height:100%";
    box.appendChild(el);
    // A newer live back took the context (another card in focus): step aside for the CSS material.
    const surface = attachSurface(el, material, () => setReady(false));
    if (!surface) {
      el.remove();
      return;
    }
    setReady(true);
    surface.sweep();

    // the light follows the pointer anywhere over the card (a mouse, or a finger dragging)
    const card = (box.closest(".sc") as HTMLElement | null) ?? box;
    const onMove = (e: PointerEvent) => {
      const r = card.getBoundingClientRect();
      surface.light((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
    };
    card.addEventListener("pointermove", onMove);

    const ro = new ResizeObserver(() => surface.resize());
    ro.observe(box);

    // The phone's tilt, around how it was held when the back came up. Only real moves draw (the
    // hand's tremor doesn't, ./tilt makeTiltFilter), and nothing while the card is off screen.
    let rest: { beta: number } | null = null;
    const moved = makeTiltFilter();
    let onScreen = true;
    const io =
      typeof IntersectionObserver === "undefined"
        ? null
        : new IntersectionObserver(([e]) => void (onScreen = e.isIntersecting), { root: box.closest("main") });
    io?.observe(box);
    const onTilt = (e: DeviceOrientationEvent) => {
      if (!onScreen || (e.beta == null && e.gamma == null)) return;
      rest ??= { beta: e.beta ?? 0 };
      const [x, y] = lightFromTilt(e, rest);
      if (moved(x, y, performance.now())) surface.light(x, y);
    };
    let listening = false;
    const listen = () => {
      if (listening || !tiltAllowed()) return;
      listening = true;
      window.addEventListener("deviceorientation", onTilt);
    };
    listen();
    // iOS says yes a moment after the tap that asked (./tilt)
    window.addEventListener("lexi:tilt", listen);

    return () => {
      card.removeEventListener("pointermove", onMove);
      ro.disconnect();
      io?.disconnect();
      window.removeEventListener("deviceorientation", onTilt);
      window.removeEventListener("lexi:tilt", listen);
      surface.destroy();
      el.remove();
      setReady(false);
    };
  }, [material]);

  return <div ref={host} className={`cb-gl ${ready ? "is-ready" : ""}`} aria-hidden />;
}
