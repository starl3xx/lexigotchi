"use client";
/**
 * Whether the player shows their picture on their cards (decisions.md #48: "yes they can turn it
 * off"). On unless turned off, in the profile.
 *
 * Kept in this browser, not on the server: the stamp is only ever drawn by the player's own
 * browser (the back of their own words, and a video they make themselves), so there is nothing for
 * a server to obey, and no table to wait for. A player with two devices chooses on each.
 *
 * One value for the whole page: the profile's switch and every back on screen read the same store,
 * so a back answers the switch at once.
 */
import { useSyncExternalStore } from "react";

const KEY = "lexigotchi.cardStamp";
const listeners = new Set<() => void>();
/** The choice where storage can't keep it (a private window): for this page only. */
let memory: boolean | null = null;

function read(): boolean {
  if (memory !== null) return memory;
  try {
    return window.localStorage.getItem(KEY) !== "off";
  } catch {
    return true;
  }
}
function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  // another tab of the game changed it
  const other = (e: StorageEvent) => {
    if (e.key === KEY) fn();
  };
  window.addEventListener("storage", other);
  return () => {
    listeners.delete(fn);
    window.removeEventListener("storage", other);
  };
}

export function setCardStamp(on: boolean): void {
  try {
    if (on) window.localStorage.removeItem(KEY);
    else window.localStorage.setItem(KEY, "off");
    memory = null;
  } catch {
    memory = on;
  }
  listeners.forEach((l) => l());
}

/** [shown, set]. On the server and before the page takes over: shown (the default), with no picture to show yet. */
export function useCardStampChoice(): [boolean, (on: boolean) => void] {
  return [useSyncExternalStore(subscribe, read, () => true), setCardStamp];
}
