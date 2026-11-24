import type { Metadata } from "next";
import { LandingPage } from "@/components/landing/LandingPage";
import { miniAppEmbed, frameEmbed, BASE_APP_ID } from "@/lib/site";
import { xEnabled } from "@/lib/profile/x";
import { emailEnabled } from "@/lib/notify/email";

/**
 * The front door on the open web. The game itself stays at `/play`, which is also the mini app's
 * `homeUrl` and launch URL (src/lib/site.ts), so Farcaster and Base App hosts never open this page.
 *
 * `/` used to redirect to `/play`, so a shared root link picked up the game's launch card. The
 * same `fc:miniapp` / `fc:frame` / `base:app_id` tags are emitted here so that keeps working.
 */
export const metadata: Metadata = {
  title: "Lexigotchi: raise your letters, spell your words, own the dictionary",
  description:
    "A letter-collecting game on Base. Collect little letter characters, roll them up to UPPERCASE, spell 1-of-1 words, and keep them fed to chase the daily $WORD jackpot. Any wallet plays.",
  alternates: { canonical: "/" },
  other: {
    "fc:miniapp": JSON.stringify(miniAppEmbed),
    "fc:frame": JSON.stringify(frameEmbed),
    "base:app_id": BASE_APP_ID,
  },
};

export default function Home() {
  // Read on the server, so the page offers X and email only while the game can use them.
  return <LandingPage xOn={xEnabled()} emailOn={emailEnabled()} />;
}
