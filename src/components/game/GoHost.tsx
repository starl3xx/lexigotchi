"use client";
import { useEffect } from "react";
import { goTarget } from "@/lib/gameLinks";
import { useGame } from "./state";

/**
 * `?go=<key>`: a link into one part of the game (lib/gameLinks.ts), as a set's notice carries. Read
 * once, then removed from the address so a reload or a share of it doesn't repeat the jump. A value
 * that isn't a known key is dropped and the game opens as usual.
 */
export function GoHost() {
  const { nav } = useGame();
  useEffect(() => {
    const url = new URL(window.location.href);
    const go = url.searchParams.get("go");
    if (go === null) return;
    url.searchParams.delete("go");
    window.history.replaceState(null, "", url.pathname + url.search + url.hash);
    const to = goTarget(go);
    if (to) nav(to.view, to.section);
  }, [nav]);
  return null;
}
