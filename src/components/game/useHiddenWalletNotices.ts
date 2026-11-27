"use client";
/**
 * The game wallet notices a player has hidden (GameWalletNotice's ×), kept in this browser.
 *
 * One value for the whole page: Today and the Bag read the same store, so a notice hidden on one is
 * hidden on the other at once, and on the first frame (a read in an effect would show it for a
 * frame each time a screen opened). A hidden notice stays hidden until it names a wallet it didn't
 * name before (`adviceKeys` in lib/profile/gameWalletAdvice.ts). Nothing is lost by hiding it: the
 * profile's Wallets card shows every wallet's holdings and offers Move.
 */
import { useSyncExternalStore } from "react";
import { hideNotice } from "@/lib/profile/gameWalletAdvice";

const KEY = "lexigotchi:hidden-wallet-notices";
const listeners = new Set<() => void>();
/** What storage can't keep (a private window, a host frame that blocks it): for this page only. */
let memory: string | null = null;

function read(): string | null {
  if (memory !== null) return memory;
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
}
function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  // another tab of the game hid one
  const other = (e: StorageEvent) => {
    if (e.key === KEY) fn();
  };
  window.addEventListener("storage", other);
  return () => {
    listeners.delete(fn);
    window.removeEventListener("storage", other);
  };
}

export function hideWalletNotice(keys: readonly string[]): void {
  const next = hideNotice(read(), keys);
  try {
    window.localStorage.setItem(KEY, next);
    memory = null;
  } catch {
    memory = next;
  }
  listeners.forEach((l) => l());
}

/** What storage holds, raw (a string, so the snapshot compares equal between reads); parse it in render. */
export function useHiddenWalletNotices(): string | null {
  return useSyncExternalStore(subscribe, read, () => null);
}
