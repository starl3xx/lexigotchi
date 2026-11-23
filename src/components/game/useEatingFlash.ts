"use client";
/**
 * A word chews for a moment when it gets fed: the rig's "eating" state for EAT_MS after its hunger
 * drops back to full. Driven by the word's own state, not the Feed tap, because a chain feed lands
 * seconds after the tap (or not at all, if the wallet is closed).
 */
import { useEffect, useRef, useState } from "react";
import type { Hunger } from "./state";

const EAT_MS = 1600;

export function useEatingFlash(key: string, h: Hunger): boolean {
  const prev = useRef<{ key: string; h: Hunger } | null>(null);
  const [eating, setEating] = useState(false);
  useEffect(() => {
    const was = prev.current;
    prev.current = { key, h };
    // Only the same word going from wanting food to full. A different word taking the stage is not
    // a feed.
    if (was && was.key === key && was.h !== "fed" && h === "fed") setEating(true);
  }, [key, h]);
  // Its own effect, keyed on `eating` alone: when the timer lived in the effect above, a key or
  // hunger change mid-flash cleared it and left the tiles chewing for good (Bugbot on #125).
  useEffect(() => {
    if (!eating) return;
    const id = window.setTimeout(() => setEating(false), EAT_MS);
    return () => window.clearTimeout(id);
  }, [eating]);
  return eating;
}
