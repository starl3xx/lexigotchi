"use client";
/**
 * Casting helper. Inside a Farcaster client it opens the native compose dialog
 * (`sdk.actions.composeCast`); on the web it falls back to the Warpcast compose intent. Every
 * showcase/swap cast embeds the /play link, so each share renders a launchable Lexigotchi card —
 * the organic growth loop the spec calls out (every showcase is an ad).
 */
import { useCallback } from "react";
import { useViewer } from "./useViewer";
import { useGame } from "./state";

const SITE_URL = (process.env.NEXT_PUBLIC_URL ?? "https://lexigotchi.vercel.app").replace(/\/$/, "");

export function useShare() {
  const v = useViewer();
  const g = useGame();

  return useCallback(
    async ({ text, embedPlay = true }: { text: string; embedPlay?: boolean }) => {
      const embeds = embedPlay ? ([`${SITE_URL}/play`] as [string]) : undefined;
      if (v.environment === "farcaster") {
        try {
          const sdk = (await import("@farcaster/miniapp-sdk")).default;
          await sdk.actions.composeCast({ text, embeds });
          return;
        } catch {
          /* fall through to the web composer */
        }
      }
      const url = new URL("https://warpcast.com/~/compose");
      url.searchParams.set("text", text);
      if (embeds) for (const e of embeds) url.searchParams.append("embeds[]", e);
      window.open(url.toString(), "_blank", "noopener,noreferrer");
      g.toast("Opening the cast composer…", "info");
    },
    [v.environment, g],
  );
}
