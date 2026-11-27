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
import { showcaseBackPath, showcaseFacePath, showcasePostText, showcaseStagePath, showcaseUrl } from "@/lib/showcase";
import type { SceneId } from "@/lib/scenes";
import { canMakeLoop } from "./live/support";
import { MATERIAL_LINE, materialOf } from "./material";
import { useMyStamp } from "./CardStamp";
import { tileTierOf, useCollabLook } from "@/components/game/collabLooks";

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

export function ShareVideo({ word, text, scene, onMaking }: { word: OwnedWord; text: string; scene: SceneId; onMaking?: (making: boolean) => void }) {
  // The word's collab look, if it has one: its pictures' addresses name it, and its living letters wear its colors.
  const look = useCollabLook(word.word);
  const g = useGame();
  const inHost = useInHost();
  const reduced = usePrefersReducedMotion();
  const lowPower = useLowPower();
  const [progress, setProgress] = useState<number | null>(null);
  const [made, setMade] = useState<Made | null>(null);
  const abort = useRef<AbortController | null>(null);
  const plays = useRef(0);
  // the holder's stamp on the video's back, as on the game's (./CardStamp): their own picture, unless they turned it off
  const stampSrc = useMyStamp();

  // the made video belongs to this word and scene; a new pick starts over, and leaving lets it go
  const madeUrl = useRef<string | null>(null);
  const makingRef = useRef(onMaking);
  makingRef.current = onMaking;
  madeUrl.current = made?.url ?? null;
  useEffect(() => {
    return () => {
      abort.current?.abort();
      makingRef.current?.(false); // called off: the card above may draw live again
      if (madeUrl.current) URL.revokeObjectURL(madeUrl.current);
      madeUrl.current = null;
      setMade(null);
      setProgress(null);
    };
  }, [text, scene]);

  // Offered only where the browser can make it (asked without loading the loop's code: ./live/support)
  // and the file can leave (a share sheet that takes files, or a download outside a host).
  const [ok, setOk] = useState(false);
  useEffect(() => {
    if (inHost === null) return;
    let alive = true;
    void canMakeLoop().then((can) => {
      if (alive) setOk(can && (canShareVideo() || !inHost));
    });
    return () => {
      alive = false;
    };
  }, [inHost]);
  // the card above holds its live back off while the video is made (one WebGL context)
  useEffect(() => {
    onMaking?.(progress !== null);
  }, [progress, onMaking]);
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
        front: showcaseFacePath(text, scene, word.prestigeLevel, look?.mark),
        back: showcaseBackPath(text, word.prestigeLevel),
        // the front's letters, alive: drawn by the game's own rig over the card without its letters
        // (the letters wear the word's collab colors in place of its rarity's material, as in the game)
        live: { stage: showcaseStagePath(text, scene, word.prestigeLevel, look?.mark), word: word.word, upper: word.upper, tier: tileTierOf(word.tier, look), gild: word.prestigeLevel, scene },
        material: materialOf(word.tier),
        stamp: stampSrc ? { src: stampSrc, ink: MATERIAL_LINE[materialOf(word.tier)] } : undefined,
        signal: ctl.signal,
        onProgress: (p) => !ctl.signal.aborted && setProgress(p),
      });
      // called off meanwhile (another scene, the sheet closed): this video isn't wanted
      if (ctl.signal.aborted) return;
      plays.current = 0;
      setMade({ blob, url: URL.createObjectURL(blob) });
    } catch (e) {
      if (!ctl.signal.aborted) g.toast("Couldn’t make the video. Try again", "bad");
      void e;
    } finally {
      if (!ctl.signal.aborted) setProgress(null);
    }
  };

  const file = () => new File([made!.blob], `lexigotchi-${word.word.toLowerCase()}-${scene}.mp4`, { type: "video/mp4" });
  const share = async () => {
    try {
      // The sheet's target is unknown (X, Farcaster, a message), so no @-handle, which names
      // someone else on Farcaster; and the link, since the file carries none.
      await navigator.share({ files: [file()], text: `${showcasePostText(text)} ${showcaseUrl(text, scene, word.prestigeLevel)}` });
    } catch (e) {
      // the player closing the sheet isn't a failure
      // only point at Save video where there is one (a host has no download)
      if ((e as Error)?.name !== "AbortError") g.toast(inHost ? "Couldn’t share the video. Try again" : "Couldn’t share the video. Try Save video", "bad");
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
          // the whole row in a host, where there's no Save video beside it
          <Button variant="primary" className={inHost ? "col-span-2" : ""} onClick={() => void share()}>
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
