import type { MetadataRoute } from "next";
import { SPLASH_BG } from "@/lib/site";

/**
 * The web app manifest (`/manifest.webmanifest`). Its practical job is browser push on iPhone:
 * Safari on iOS only offers push to a site the player has added to their Home Screen, and it reads
 * this file to do that. It opens straight into the game.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Lexigotchi",
    short_name: "Lexigotchi",
    description: "Raise your letters. Spell your words. Own the dictionary.",
    start_url: "/play",
    scope: "/",
    display: "standalone",
    background_color: SPLASH_BG,
    theme_color: SPLASH_BG,
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
