"use client";
/**
 * The daily note: once per payout, a toast says what the player's words earned ("Your words earned
 * 120K $WORD today"). Earnings land in the wallet by themselves (decisions.md #16), so without it a
 * player would only see their balance tick up. Remembered per browser, so a reload doesn't repeat it.
 * Mounted once by GameApp.
 */
import { useEffect } from "react";
import { fmtWord, useGame } from "./state";
import { payoutWhen } from "./earnings";

const KEY = "lexigotchi:earnings-seen";

export function useEarningsNote() {
  const g = useGame();
  const at = g.earnings?.latestAt ?? null;
  const latest = g.earnings?.latest ?? 0;
  const { toast } = g;
  useEffect(() => {
    if (!at || latest <= 0) return;
    let seen = 0;
    try {
      seen = Number(window.localStorage.getItem(KEY)) || 0;
    } catch {
      /* storage blocked: say it once per page instead */
    }
    if (seen >= at) return;
    try {
      window.localStorage.setItem(KEY, String(at));
    } catch {
      /* storage blocked */
    }
    toast(`Your words earned ${fmtWord(latest)} $WORD ${payoutWhen(at)}`, "good");
  }, [at, latest, toast]);
}
