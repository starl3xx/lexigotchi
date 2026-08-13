"use client";
/**
 * Feed the live $WORD price into the peg cell and re-render whoever mounted this.
 *
 * Mounted ONCE per surface, at the top of the tree (GameApp, AdminConsole) — the state update here
 * is what re-renders the children so their call-time `usdOf`/`usdToWord` reads pick up the new
 * cell. Mounting it lower would update the cell but repaint only part of the screen: two USD
 * numbers side by side could disagree about the peg.
 *
 * Refreshes every 5 minutes while mounted. A dormant micro-cap doesn't move faster than that, and
 * the server caches at 60s anyway — this cadence is about surviving a long-lived admin tab, not
 * about tick-by-tick accuracy.
 */
import { useEffect, useState } from "react";
import { setLiveWordUsd, currentWordUsd } from "@/lib/params";
import type { WordPrice } from "@/lib/oracle/wordPrice";

const REFRESH_MS = 5 * 60_000;

export function useWordPrice(): { wordUsd: number; live: WordPrice | null } {
  const [live, setLive] = useState<WordPrice | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function pull() {
      try {
        const res = await fetch("/api/oracle/word");
        const data = (await res.json()) as { ok?: boolean } & WordPrice;
        if (!cancelled && data?.ok && data.source === "geckoterminal") {
          setLiveWordUsd(data.priceUsd); // guarded in params.ts — garbage is ignored
          setLive(data);
        }
        // source: "fallback" changes nothing — the cell already holds the same constant.
      } catch {
        /* keep whatever the cell holds; the price display degrades, never breaks */
      }
    }
    void pull();
    const timer = setInterval(pull, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  return { wordUsd: currentWordUsd(), live };
}
