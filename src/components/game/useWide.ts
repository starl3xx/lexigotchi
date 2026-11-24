"use client";
/**
 * Is the window as wide as Tailwind's `lg` (1024 px)? For a layout whose ORDER changes with width,
 * which CSS alone can't do without parting what's read from what's seen (Today: two columns on a
 * wide screen, one stack in priority order on a phone; HomeScreen). Width only, like the rest of
 * /play's responsive layout: never the host environment.
 */
import { useSyncExternalStore } from "react";

const QUERY = "(min-width: 1024px)";

function subscribe(fn: () => void) {
  const mq = window.matchMedia(QUERY);
  mq.addEventListener("change", fn);
  return () => mq.removeEventListener("change", fn);
}

export function useWide(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(QUERY).matches,
    () => false,
  );
}
