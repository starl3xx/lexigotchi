"use client";
/**
 * Tell the server, once per wallet per UTC day, that this wallet is connected to the game
 * (lib/sightings.ts). It's how the operator console counts wallets that connect and then do nothing
 * onchain: a connect alone leaves no trace anywhere else.
 *
 * Fire-and-forget: it never blocks, retries, or shows anything. It waits for the viewer to resolve
 * so the "web" / "farcaster" label is right, and attaches a Quick Auth token when one exists, so the
 * server can store a VERIFIED FID beside the wallet. The day is marked only when the server stored
 * it, so a server without the table yet (migration 0012) hears again on the next visit.
 *
 * A tab left open across UTC midnight reports the new day too (useUtcDay), or "days seen" would miss
 * every return visit that never reloads the page (Bugbot on #166).
 */
import { useEffect, useState } from "react";
import { useAccount } from "wagmi";
import { useViewer } from "./useViewer";
import { maybeAuthedPostJson } from "./campaignClient";
import { sightingStorageKey, utcDay } from "@/lib/sightings";

/**
 * Today's UTC day number, updated at midnight and whenever the tab comes back into view (a sleeping
 * laptop or a background tab can hold a timer far past its time).
 */
function useUtcDay(): number {
  const [day, setDay] = useState(() => utcDay());
  useEffect(() => {
    const refresh = () => setDay(utcDay());
    // A second past midnight, so the new day has surely begun.
    const t = setTimeout(refresh, (day + 1) * 86_400_000 - Date.now() + 1_000);
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearTimeout(t);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [day]);
  return day;
}

export function useWalletSighting() {
  const { address } = useAccount();
  const { environment } = useViewer();
  const day = useUtcDay();
  useEffect(() => {
    if (!address || environment === "loading") return;
    const key = sightingStorageKey(address);
    const today = String(day);
    try {
      if (localStorage.getItem(key) === today) return;
    } catch {
      /* storage blocked: send anyway, the server counts a day once */
    }
    void maybeAuthedPostJson("/api/players/seen", { address, via: environment }).then((r) => {
      if (!r.ok) return;
      try {
        localStorage.setItem(key, today);
      } catch {
        /* storage blocked */
      }
    });
  }, [address, environment, day]);
}
