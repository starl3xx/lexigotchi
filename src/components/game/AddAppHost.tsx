"use client";
/**
 * AddAppHost — fires the one-time, post-mint "add the mini app" nudge. Watches the game store for
 * the player's first daily/pack mint and, once they're in a Farcaster client and haven't already
 * added the app, opens AddAppSheet a single time. The "prompted" flag lives in localStorage — the
 * no-backend stand-in for LHAW's "has seen onboarding" / "has added mini app" rows.
 *
 * It deliberately waits until no sheet is open, so the nudge slides up AFTER the player has enjoyed
 * their pack reveal rather than interrupting it. Renders nothing.
 */
import { useEffect } from "react";
import { useGame } from "./state";
import { useAddMiniApp } from "./useAddMiniApp";

const PROMPTED_KEY = "lexigotchi:addapp-prompted:v1";
function wasPrompted(): boolean {
  try {
    return localStorage.getItem(PROMPTED_KEY) === "1";
  } catch {
    return false;
  }
}
function markPrompted() {
  try {
    localStorage.setItem(PROMPTED_KEY, "1");
  } catch {
    /* storage unavailable — worst case the nudge can show again next session */
  }
}

export function AddAppHost() {
  const { state, openSheet } = useGame();
  const { added, inFarcaster, ready } = useAddMiniApp();
  const { mintCount, sheet } = state;

  useEffect(() => {
    if (!ready || !inFarcaster) return; // addMiniApp only works inside a Farcaster client
    if (wasPrompted()) return; // already nudged once — never nag again
    if (added) {
      markPrompted(); // already added → no need to ever prompt
      return;
    }
    if (mintCount < 1) return; // wait for their first daily/pack mint
    if (sheet !== null) return; // let any open sheet (e.g. the pack reveal) be dismissed first
    markPrompted();
    openSheet({ kind: "addapp" });
  }, [ready, inFarcaster, added, mintCount, sheet, openSheet]);

  return null;
}
