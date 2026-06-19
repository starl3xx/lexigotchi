/**
 * Canonical site URL + Farcaster Mini App embed/manifest config, in one place so the `/play`
 * page meta and `/.well-known/farcaster.json` stay in sync.
 *
 * Set `NEXT_PUBLIC_URL` to the deployed origin (no trailing slash). The `accountAssociation` proof
 * is domain-specific (signed for lexigotchi.fun) and baked into `farcasterManifest()` below; the
 * FARCASTER_HEADER / FARCASTER_PAYLOAD / FARCASTER_SIGNATURE env vars override it if needed.
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
  // NB: the Farcaster manifest validator rejects special chars (incl. `$` and `—`) in `description`.
  // Keep this to plain text — letters, spaces, commas, periods, hyphens only.
  description: "A tamagotchi-style word collection game on Base. Raise letters to UPPERCASE, claim words, and chase the daily jackpot.",
  primaryCategory: "games",
  tags: ["game", "word", "collection", "base", "tamagotchi"],
};

/**
 * The signed domain-manifest association for `lexigotchi.fun` — PUBLIC (it's served in the manifest),
 * generated with the Farcaster manifest tool and signed by the app's custody key (FID 6500). Baked in
 * so the manifest works without env config and stays version-controlled; env vars override it.
 * Regenerate + replace all three if the canonical domain ever changes (the payload encodes the domain).
 */
const ACCOUNT_ASSOCIATION = {
  header: "eyJmaWQiOjY1MDAsInR5cGUiOiJhdXRoIiwia2V5IjoiMHgzQ2VlNjMwMDc1REM1ODZENUJGZEZBODFGM2EyZDc3OTgwRjBkMjIzIn0",
  payload: "eyJkb21haW4iOiJsZXhpZ290Y2hpLmZ1biJ9",
  signature: "7QYqefY/k4mcO6xOzIXXnLc2n23S2DeB6xdx8C3ZXcMoxduL/7zEwJQDka+fc2q/UfoNOg7Ax+K3kFKDSrn5gBw=",
};

/** The full `/.well-known/farcaster.json` body. accountAssociation is baked in (env overrides). */
export function farcasterManifest() {
  return {
    accountAssociation: {
      header: process.env.FARCASTER_HEADER ?? ACCOUNT_ASSOCIATION.header,
      payload: process.env.FARCASTER_PAYLOAD ?? ACCOUNT_ASSOCIATION.payload,
      signature: process.env.FARCASTER_SIGNATURE ?? ACCOUNT_ASSOCIATION.signature,
    },
    miniapp: miniappConfig,
    frame: miniappConfig, // legacy alias for clients that still read `frame`
  };
}
