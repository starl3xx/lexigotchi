"use client";
/**
 * A number that counts to its new value instead of jumping: balances and pots tick up or down over
 * TWEEN_MS when they change, so a spend or a win reads as money moving. The first value shows at
 * once (nothing counts up on page load), and prefers-reduced-motion jumps straight to the target.
 * Also reports which way the last change went, for a brief color cue.
 */
import { useEffect, useRef, useState } from "react";

const TWEEN_MS = 650;
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

export function useTween(target: number): { value: number; delta: "up" | "down" | null } {
  const [value, setValue] = useState(target);
  const [delta, setDelta] = useState<"up" | "down" | null>(null);
  const shown = useRef(target);
  useEffect(() => {
    const from = shown.current;
    if (!Number.isFinite(target) || !Number.isFinite(from) || from === target) {
      shown.current = target;
      setValue(target);
      return;
    }
    setDelta(target > from ? "up" : "down");
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      shown.current = target;
      setValue(target);
    }
    let raf = 0;
    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / TWEEN_MS);
      const v = from + (target - from) * easeOut(t);
      shown.current = v;
      setValue(v);
      if (t < 1) raf = requestAnimationFrame(step);
    };
    if (!reduce) raf = requestAnimationFrame(step);
    const clear = window.setTimeout(() => setDelta(null), TWEEN_MS + 250);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(clear);
    };
  }, [target]);
  return { value, delta };
}
