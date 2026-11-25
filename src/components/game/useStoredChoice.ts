"use client";
/**
 * A small per-viewer choice (a Bag sort or filter), remembered in this browser. Storage can be
 * missing or throw (private windows, blocked site data): then it's simply not remembered.
 */
import { useCallback, useEffect, useState } from "react";
import { validChoice } from "./bagView";

export function useStoredChoice<T extends string>(key: string, allowed: readonly T[], fallback: T): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(fallback);
  useEffect(() => {
    try {
      setValue(validChoice(window.localStorage.getItem(key), allowed, fallback));
    } catch {
      /* not remembered */
    }
  }, [key, allowed, fallback]);
  const set = useCallback(
    (v: T) => {
      setValue(v);
      try {
        window.localStorage.setItem(key, v);
      } catch {
        /* not remembered */
      }
    },
    [key],
  );
  return [value, set];
}
