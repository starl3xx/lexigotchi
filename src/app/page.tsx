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
  // The guide's page title and share description (docs/messaging.md, decisions.md #23).
  title: "Lexigotchi: a word-pet game on Base",
  description: "Collect letters, raise them, and spell words only you can own.",
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
