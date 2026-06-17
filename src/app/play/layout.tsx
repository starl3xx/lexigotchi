import type { Metadata } from "next";
import { miniAppEmbed, frameEmbed } from "@/lib/site";

/** The mini-app entry. Carries the `fc:miniapp` (+ legacy `fc:frame`) embed so a shared /play link
 *  renders a launchable Lexigotchi card in Farcaster clients. Renders full-bleed (no header/footer chrome). */
export const metadata: Metadata = {
  title: "Lexigotchi — play",
  description: "Raise your letters, claim words, and chase the daily $WORD jackpot.",
  other: {
    "fc:miniapp": JSON.stringify(miniAppEmbed),
    "fc:frame": JSON.stringify(frameEmbed),
  },
};

export default function PlayLayout({ children }: { children: React.ReactNode }) {
  return children;
}
