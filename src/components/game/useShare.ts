"use client";
/**
 * Sharing. `usePostToX` is the first choice (lib/showcase: X first, Farcaster second); `useShare`
 * casts. Inside a mini-app host both go through the SDK (the host decides how to open a link, and
 * a plain window.open is often swallowed there); on the web they open the site's composer in a new
 * tab. Every cast embeds a link, so each share renders a launchable Lexigotchi card: the organic
 * growth loop the spec calls out (every showcase is an ad).
 */
import { useCallback } from "react";
import { useViewer } from "./useViewer";
import { useGame } from "./state";
import { SITE_URL } from "@/lib/site";
import { xIntentUrl } from "@/lib/showcase";

export function useShare() {
  const v = useViewer();
  const g = useGame();

  return useCallback(
    /** `embed` is the link the cast carries (default `/play`); `embedPlay: false` sends none. */
    async ({ text, embedPlay = true, embed }: { text: string; embedPlay?: boolean; embed?: string }) => {
      const embeds = embedPlay ? ([embed ?? `${SITE_URL}/play`] as [string]) : undefined;
      if (v.environment === "farcaster") {
        try {
          const sdk = (await import("@farcaster/miniapp-sdk")).default;
          await sdk.actions.composeCast({ text, embeds });
          return;
        } catch {
          /* fall through to the web composer */
        }
      }
      const url = new URL("https://farcaster.xyz/~/compose");
      url.searchParams.set("text", text);
      if (embeds) for (const e of embeds) url.searchParams.append("embeds[]", e);
      window.open(url.toString(), "_blank", "noopener,noreferrer");
      g.toast("Opening the cast composer…", "info");
    },
    [v.environment, g],
  );
}

/** Open X's composer with the words and a link. X draws the link's card, so pick a link with one. */
export function usePostToX() {
  const v = useViewer();
  const g = useGame();

  return useCallback(
    async ({ text, url }: { text: string; url: string }) => {
      const intent = xIntentUrl(text, url);
      if (v.environment === "farcaster") {
        try {
          const sdk = (await import("@farcaster/miniapp-sdk")).default;
          await sdk.actions.openUrl(intent);
          return;
        } catch {
          /* fall through to a new tab */
        }
      }
      // No await before this on the web path: a popup opened outside the tap's own task is blocked.
      window.open(intent, "_blank", "noopener,noreferrer");
      g.toast("Opening X…", "info");
    },
    [v.environment, g],
  );
}
