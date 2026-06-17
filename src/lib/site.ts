/**
 * Canonical site URL + Farcaster Mini App embed/manifest config, in one place so the `/play`
 * page meta and `/.well-known/farcaster.json` stay in sync.
 *
 * Set `NEXT_PUBLIC_URL` to the deployed origin (no trailing slash). The `accountAssociation`
 * proof is domain-specific and must be generated with the Farcaster Manifest Tool for the final
 * domain, then supplied via the FARCASTER_HEADER / FARCASTER_PAYLOAD / FARCASTER_SIGNATURE env.
 */
export const SITE_URL = (process.env.NEXT_PUBLIC_URL ?? "https://lexigotchi.vercel.app").replace(/\/$/, "");
export const SPLASH_BG = "#f4ead2"; // game's aged-paper cream

/**
 * Pre-launch campaign gate. When `NEXT_PUBLIC_PRELAUNCH === "1"`, `/play` shows the
 * `PreLaunchScreen` (add-the-app + share-a-cast → free pack at launch) INSTEAD of the game.
 * Unset/empty (or anything other than "1") = game is live — the safe, failure-open default.
 * The `/admin` console is unaffected. Flip to "1" to run the campaign; remove it the day you launch.
 */
export const PRELAUNCH = process.env.NEXT_PUBLIC_PRELAUNCH === "1";

const launchAction = (type: "launch_miniapp" | "launch_frame") => ({
  type,
  name: "Lexigotchi",
  url: `${SITE_URL}/play`,
  splashImageUrl: `${SITE_URL}/icon-image`,
  splashBackgroundColor: SPLASH_BG,
});

/** The `fc:miniapp` share-embed (current spec). `frameEmbed` is the legacy `fc:frame` alias. */
export const miniAppEmbed = {
  version: "1",
  imageUrl: `${SITE_URL}/embed-image`,
  button: { title: "Play Lexigotchi", action: launchAction("launch_miniapp") },
};
export const frameEmbed = {
  version: "1",
  imageUrl: `${SITE_URL}/embed-image`,
  button: { title: "Play Lexigotchi", action: launchAction("launch_frame") },
};

const miniappConfig = {
  version: "1",
  name: "Lexigotchi",
  iconUrl: `${SITE_URL}/icon-image`,
  homeUrl: `${SITE_URL}/play`,
  imageUrl: `${SITE_URL}/embed-image`,
  buttonTitle: "Play Lexigotchi",
  splashImageUrl: `${SITE_URL}/icon-image`,
  splashBackgroundColor: SPLASH_BG,
  subtitle: "Raise letters. Own words.",
  description: "A tamagotchi-style $WORD collection game on Base — raise letters to UPPERCASE, claim words, stake for the daily jackpot.",
  primaryCategory: "games",
  tags: ["game", "word", "collection", "base", "tamagotchi"],
};

/** The full `/.well-known/farcaster.json` body. accountAssociation comes from env (see above). */
export function farcasterManifest() {
  return {
    accountAssociation: {
      header: process.env.FARCASTER_HEADER ?? "",
      payload: process.env.FARCASTER_PAYLOAD ?? "",
      signature: process.env.FARCASTER_SIGNATURE ?? "",
    },
    miniapp: miniappConfig,
    frame: miniappConfig, // legacy alias for clients that still read `frame`
  };
}
