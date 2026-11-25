"use client";
/**
 * The share loop, offered under an opened word's Share (decisions.md #27): a six-second
 * video of the word's card turning over and home, made in the browser (./loop/makeLoop), to share or
 * save. A link's card on X shows only a still, so the turn goes out as a video attached to the post.
 *
 * Two taps, on purpose: one to make the video (a few seconds), one to share or save it. iOS opens
 * the share sheet only from the tap itself, and a sheet asked for seconds later is refused.
 *
 * Offered only where the file can leave: a share sheet that takes files (phones), or a download
 * outside a mini-app host. A host with no share sheet can't keep a file (and the image's "open it
 * in the browser" can't carry one), so there the video isn't offered; the link still is.
 *
 * The preview plays twice and rests: a video that loops forever is a page that never rests.
 */
import { useEffect, useRef, useState } from "react";
import { Button } from "../game/primitives";
import { DownloadSimple, FilmStrip, ShareNetwork } from "../game/ui/icons";
import { useGame, type OwnedWord } from "../game/state";
import { useLowPower, usePrefersReducedMotion } from "../game/TileCharacter";
import { showcaseBackPath, showcaseCardPath, showcaseXText } from "@/lib/showcase";
import type { SceneId } from "@/lib/scenes";
import { canDrawLive } from "./live/support";
import { materialOf } from "./material";

/** A phone's share sheet that takes a video file. */
function canShareVideo(): boolean {
  if (typeof navigator === "undefined" || typeof navigator.canShare !== "function") return false;
  try {
    return navigator.canShare({ files: [new File([new Uint8Array(1)], "x.mp4", { type: "video/mp4" })] });
  } catch {
    return false;
  }
}

/** Whether the page is inside a mini-app host (asked of the SDK; null until it answers). */
function useInHost(): boolean | null {
  const [inHost, setInHost] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const sdk = (await import("@farcaster/miniapp-sdk")).default;
        const v = await sdk.isInMiniApp();
        if (alive) setInHost(v);
      } catch {
        if (alive) setInHost(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);
  return inHost;
}

type Made = { blob: Blob; url: string };

export function ShareVideo({ word, text, scene }: { word: OwnedWord; text: string; scene: SceneId }) {
  const g = useGame();
  const inHost = useInHost();
  const reduced = usePrefersReducedMotion();
  const lowPower = useLowPower();
  const [progress, setProgress] = useState<number | null>(null);
  const [made, setMade] = useState<Made | null>(null);
  const abort = useRef<AbortController | null>(null);
  const plays = useRef(0);

  // the made video belongs to this word and scene; a new pick starts over, and leaving lets it go
  const madeUrl = useRef<string | null>(null);
  madeUrl.current = made?.url ?? null;
  useEffect(() => {
    return () => {
      abort.current?.abort();
      if (madeUrl.current) URL.revokeObjectURL(madeUrl.current);
      madeUrl.current = null;
      setMade(null);
      setProgress(null);
    };
  }, [text, scene]);

  const [ok, setOk] = useState(false);
  useEffect(() => {
    if (inHost === null) return;
    void import("./loop/makeLoop").then(({ canMakeLoop }) => {
      const leaves = canShareVideo() || !inHost;
      setOk(canMakeLoop() && canDrawLive() && leaves);
    });
  }, [inHost]);
  // A device that should save its power (Save-Data, a low-end phone) isn't offered a burst of
  // drawing it didn't ask for; reduced motion is asked for the page, not for a file, so it's offered.
  if (!ok || lowPower) return null;

  const make = async () => {
    abort.current?.abort();
    const ctl = new AbortController();
    abort.current = ctl;
    setProgress(0);
    try {
      const { makeLoop } = await import("./loop/makeLoop");
      const blob = await makeLoop({
        front: showcaseCardPath(text, "x", scene),
        back: showcaseBackPath(text),
        material: materialOf(word.tier),
        signal: ctl.signal,
        onProgress: (p) => setProgress(p),
      });
      plays.current = 0;
      setMade({ blob, url: URL.createObjectURL(blob) });
    } catch (e) {
      if (!ctl.signal.aborted) g.toast("Couldn’t make the video. Try again", "bad");
      void e;
    } finally {
      setProgress(null);
    }
  };

  const file = () => new File([made!.blob], `lexigotchi-${word.word.toLowerCase()}-${scene}.mp4`, { type: "video/mp4" });
  const share = async () => {
    try {
      await navigator.share({ files: [file()], text: showcaseXText(text) });
    } catch (e) {
      // the player closing the sheet isn't a failure
      if ((e as Error)?.name !== "AbortError") g.toast("Couldn’t share the video. Try Save video", "bad");
    }
  };

  if (!made) {
    return (
      <Button full variant="ghost" disabled={progress !== null} onClick={() => void make()}>
        <FilmStrip weight="bold" />
        {progress !== null ? ` Making the video… ${Math.round(progress * 100)}%` : " Make a video of the card"}
      </Button>
    );
  }
  return (
    <div className="space-y-2">
      {/* plays twice, then rests on its last frame (no loop: a page that never rests) */}
      <video
        src={made.url}
        muted
        playsInline
        autoPlay={!reduced}
        controls={reduced}
        onEnded={(e) => {
          plays.current += 1;
          if (plays.current < 2) void e.currentTarget.play();
        }}
        className="aspect-video w-full rounded-xl border-2 border-ink bg-paper"
        aria-label={`${word.word}’s card turning over`}
      />
      <div className="grid grid-cols-2 gap-2">
        {canShareVideo() ? (
          <Button variant="primary" onClick={() => void share()}>
            <ShareNetwork weight="fill" /> Share video
          </Button>
        ) : null}
        {!inHost && (
          <a
            href={made.url}
            download={`lexigotchi-${word.word.toLowerCase()}-${scene}.mp4`}
            className={`cel-sm press flex items-center justify-center gap-1.5 rounded-xl bg-card px-3 py-2 text-sm font-bold ${canShareVideo() ? "" : "col-span-2"}`}
          >
            <DownloadSimple weight="bold" /> Save video
          </a>
        )}
      </div>
      <p className="text-center text-xs text-ink/55">On X, add the video to your post: a link shows only a still.</p>
    </div>
  );
}
