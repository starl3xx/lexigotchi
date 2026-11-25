"use client";
/**
 * Sharing. `usePostToX` is the first choice (lib/showcase: X first, Farcaster second); `useShare`
 * casts. Inside a mini-app host both go through the SDK (the host decides how to open a link, and
 * a plain window.open is often swallowed there); on the web they open the site's composer in a new
 * tab. Every cast embeds a link, so each share renders a launchable Lexigotchi card: the organic
 * growth loop the spec calls out (every showcase is an ad).
 */
import { useCallback, useEffect, useRef } from "react";
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

/**
 * Open a page outside the game (the docs, say) without losing the game: inside a Farcaster client
 * through the host's openUrl (a mini app has no back button, so a same-tab link would strand the
 * player), elsewhere in a new tab.
 */
export function useOpenUrl() {
  const v = useViewer();
  return useCallback(
    async (url: string) => {
      if (v.environment === "farcaster") {
        try {
          const sdk = (await import("@farcaster/miniapp-sdk")).default;
          await sdk.actions.openUrl(url);
          return;
        } catch {
          /* fall through to a new tab */
        }
      }
      // No await before this on the web path: a popup opened outside the tap's own task is blocked.
      window.open(url, "_blank", "noopener,noreferrer");
    },
    [v.environment],
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

/** A phone or tablet: saving goes through the share sheet, whose "Save Image" reaches the camera roll. */
const touchFirst = () => typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;

/**
 * Save a picture (a shared word's card) to the device (starl3xx, 2026-11-24: "allow users to download
 * their image somehow (or save to camera roll)"). `src` is same-origin, so its bytes can be read.
 *
 * - A phone gets the share sheet with the file: "Save Image" puts it in the camera roll. iOS opens
 *   the sheet only from the tap itself, and a card can take seconds to draw, so on phones the bytes
 *   are fetched AHEAD, shortly after the word or scene settles. A sheet the tap's activation no
 *   longer covers is refused (NotAllowedError); the bytes are ready by then, so a second tap works.
 * - A computer downloads the file.
 * - A mini-app host with no share sheet opens the picture in the browser (a download in its web
 *   view does nothing), where pressing and holding saves it.
 */
export function useSaveImage(src: string | null, filename: string) {
  const v = useViewer();
  const g = useGame();
  const ready = useRef<{ src: string; blob: Blob } | null>(null);
  // Inside ANY mini-app host, asked of the SDK itself: `v.environment` says "farcaster" only when the
  // host hands over a FID, and the Base app doesn't, so its players read as "web" (Bugbot on #183).
  const host = useRef<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const sdk = (await import("@farcaster/miniapp-sdk")).default;
        const inMini = await sdk.isInMiniApp(); // a definitive boolean, with its own timeout
        if (alive) host.current = inMini;
      } catch {
        if (alive) host.current = false;
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!src || !touchFirst()) return;
    const ctl = new AbortController();
    // Waits out a player flicking through scenes, so only the one they stop on is fetched.
    const id = window.setTimeout(() => {
      fetch(src, { signal: ctl.signal })
        .then((r) => (r.ok ? r.blob() : null))
        .then((blob) => {
          if (blob) ready.current = { src, blob };
        })
        .catch(() => {});
    }, 800);
    return () => {
      window.clearTimeout(id);
      ctl.abort();
    };
  }, [src]);

  return useCallback(async () => {
    if (!src) return;
    const inHost = host.current ?? v.environment === "farcaster";
    // A download in a host's web view does nothing, so a host never falls back to one: it opens the
    // picture in the browser, or says it couldn't (never "saved" for a download that didn't happen).
    const openInBrowser = async () => {
      try {
        const sdk = (await import("@farcaster/miniapp-sdk")).default;
        await sdk.actions.openUrl(new URL(src, window.location.href).toString());
        g.toast("Press and hold the picture to save it", "info");
      } catch {
        g.toast("Couldn’t open the picture. Try again", "bad");
      }
    };
    const sheet = touchFirst() && typeof navigator.canShare === "function";
    // A host with no share sheet can't keep a file: open the picture without fetching it.
    if (inHost && !sheet) return openInBrowser();

    let blob = ready.current?.src === src ? ready.current.blob : null;
    if (!blob) {
      try {
        const r = await fetch(src);
        if (!r.ok) throw new Error(String(r.status));
        blob = await r.blob();
        ready.current = { src, blob };
      } catch {
        g.toast("Couldn’t get the picture. Try again", "bad");
        return;
      }
    }
    const file = new File([blob], filename, { type: blob.type || "image/png" });
    if (sheet && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file] });
      } catch (e) {
        const name = (e as { name?: string })?.name;
        // AbortError: the player closed the sheet, which is an answer, not a failure.
        if (name === "NotAllowedError") g.toast("The picture is ready. Tap Save image again", "info");
        else if (name !== "AbortError") g.toast("Couldn’t open the share sheet", "bad");
      }
      return;
    }
    // A sheet that can't take this file: a host opens it in the browser, the web downloads it.
    if (inHost) return openInBrowser();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Revoked later, not at once: some browsers read the link after click() returns.
    window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
    g.toast("Saving the picture to your downloads", "good");
  }, [src, filename, v.environment, g]);
}
