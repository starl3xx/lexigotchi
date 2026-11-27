"use client";
/**
 * What a player's device asks about motion: less of it, or a still game. In a file of their own
 * (they were in the letter rig) so that something small, like the game's lockup, can ask without
 * bringing the whole rig to a page (the earnings page draws no letters of its own).
 */
import { useEffect, useState } from "react";

// ---------------------------------------------------------------------------
// prefers-reduced-motion (client-only; SSR-safe default = false)
// ---------------------------------------------------------------------------
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const on = () => setReduced(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return reduced;
}

/**
 * A device that should get the still finishes: a low-end phone (2 GB of memory or less, which only
 * Chromium reports) or Save-Data on. Read once (it can't change mid-session) and SSR-safe (false
 * until mounted). Not the core count: WebKit reports at most 2 on iOS (a fingerprinting guard), so
 * it would keep every iPhone still, the mini app's hosts included. The finishes' motion is cheap by
 * design instead: a moment every few seconds, only for the word in focus (useFinishMoment).
 */
let lowPowerCache: boolean | null = null;
function readLowPower(): boolean {
  if (lowPowerCache !== null) return lowPowerCache;
  const nav = navigator as Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } };
  lowPowerCache = (typeof nav.deviceMemory === "number" && nav.deviceMemory <= 2) || nav.connection?.saveData === true;
  return lowPowerCache;
}
export function useLowPower(): boolean {
  const [low, setLow] = useState(false);
  useEffect(() => setLow(readLowPower()), []);
  return low;
}
