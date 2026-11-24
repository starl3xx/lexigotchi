"use client";
/**
 * Tell the server, once per wallet per UTC day, that this wallet is connected to the game
 * (lib/sightings.ts). It's how the operator console counts wallets that connect and then do nothing
 * onchain: a connect alone leaves no trace anywhere else.
 *
 * Fire-and-forget: it never blocks, retries, or shows anything. It waits for the viewer to resolve
 * so the "web" / "farcaster" label is right, and attaches a Quick Auth token when one exists, so the
 * server can store a VERIFIED FID beside the wallet. The day is marked only when the server stored
 * it, so a server without the table yet (migration 0010) hears again on the next visit.
 */
import { useEffect } from "react";
import { useAccount } from "wagmi";
import { useViewer } from "./useViewer";
import { maybeAuthedPostJson } from "./campaignClient";
import { sightingStorageKey, utcDay } from "@/lib/sightings";

export function useWalletSighting() {
  const { address } = useAccount();
  const { environment } = useViewer();
  useEffect(() => {
    if (!address || environment === "loading") return;
    const key = sightingStorageKey(address);
    const today = String(utcDay());
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
  }, [address, environment]);
}
