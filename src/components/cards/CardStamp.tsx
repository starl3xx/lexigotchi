"use client";
/**
 * The player's picture as a stamp on the back of their card (./stamp says what it is and why it is
 * one ink). A back shows only for the player's own words, so the stamp is always their own picture:
 * the one their profile shows (useProfile's resolveIdentity), from Farcaster or X.
 */
import { useState } from "react";
import { svgDataUri } from "@/lib/cardArt/engrave";
import { Card } from "../game/primitives";
import { useViewer } from "../game/useViewer";
import { resolveIdentity, useProfile } from "../game/useProfile";
import { stampRingSvg } from "./stamp";
import { useCardStampChoice } from "./useCardStamp";

/** The picture to stamp: the player's own, when they have one and haven't turned the stamp off. */
export function useMyStamp(): string | null {
  const viewer = useViewer();
  const profile = useProfile();
  const [shown] = useCardStampChoice();
  const me = resolveIdentity(viewer, profile.profile);
  return shown ? me.pfpUrl : null;
}

// One ring a colour, built the first time a stamp of that colour shows.
const rings = new Map<string, string>();
function ringImage(ink: string): string {
  let url = rings.get(ink);
  if (!url) rings.set(ink, (url = `url("${svgDataUri(stampRingSvg(ink))}")`));
  return url;
}

/**
 * `place`: beside the number (it sits in the number's own line, so it follows the digits at every
 * size), the top left corner (a card with no number yet), or a thumbnail's (over the pressed seal).
 * A picture that fails to load takes the whole stamp with it: no empty ring.
 */
export function CardStamp({ src, ink, place }: { src: string; ink: string; place: "number" | "corner" | "mini" }) {
  const [failed, setFailed] = useState<string | null>(null);
  if (failed === src) return null;
  return (
    <span className={`cb-stamp cb-stamp-${place}`} aria-hidden>
      <span className="cb-stamp-face" style={{ background: ink }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(src)} />
      </span>
      <span className="cb-stamp-ring" style={{ backgroundImage: ringImage(ink) }} />
    </span>
  );
}

/**
 * The switch, in the profile: shown only to a player with a picture to stamp. The choice is kept on
 * this device (./useCardStamp says why), and the card says so.
 */
export function CardStampChoice() {
  const [shown, set] = useCardStampChoice();
  return (
    <Card className="mb-3">
      <div className="font-display font-extrabold">Your cards</div>
      <label className="mt-2 flex items-start gap-2 text-sm">
        <input type="checkbox" checked={shown} onChange={(e) => set(e.target.checked)} className="mt-0.5 h-4 w-4 shrink-0 accent-[#2a9d8f]" />
        <span className="min-w-0">
          <span className="block font-bold leading-tight">Show my picture on my cards</span>
          <span className="block text-xs text-ink/60">A small stamp of your picture on the back of your cards, and in the videos you make of them. This choice is kept on this device.</span>
        </span>
      </label>
    </Card>
  );
}
