/**
 * A Showcase share: any letters a player arranged, in any case, as a link with its own card.
 *
 * Built for X first, Farcaster second. X shows a large picture only when the shared link's page
 * carries its own `og:image`, and the old share posted `/play`, whose card is the generic logo. So
 * each showcase gets a page, `/s/<letters>`, whose card draws those letters (`/s/<letters>/card`):
 * a 1.91:1 picture for X's large card, and a 3:2 one for the Farcaster embed, whose spec requires
 * 3:2. The case in the path is the case of each tile: `/s/HeLLo` is H and LL UPPERCASE.
 *
 * Nothing here checks ownership. A showcase is vanity ("any letters, any order, no dictionary
 * check"), so the page claims only what a link can prove: these letters, arranged.
 */
import { SITE_URL, X_HANDLE } from "./site";

/** The rack holds at most 8 tiles, and sharing needs at least 2 (ShowcaseScreen). */
export const SHOWCASE_MIN = 2;
export const SHOWCASE_MAX = 8;

export interface ShowcaseTile {
  char: string;
  upper: boolean;
}

/** Letters only, A to Z in either case, 2 to 8 of them. Anything else is not a showcase. */
export function parseShowcase(raw: string): ShowcaseTile[] | null {
  let text = raw;
  try {
    text = decodeURIComponent(raw);
  } catch {
    return null;
  }
  if (!new RegExp(`^[A-Za-z]{${SHOWCASE_MIN},${SHOWCASE_MAX}}$`).test(text)) return null;
  return [...text].map((c) => ({ char: c.toUpperCase(), upper: c === c.toUpperCase() }));
}

/** The tiles back as the path text: UPPERCASE tiles as capitals, lowercase as small letters. */
export function showcaseText(tiles: readonly ShowcaseTile[]): string {
  return tiles.map((t) => (t.upper ? t.char.toUpperCase() : t.char.toLowerCase())).join("");
}

export function showcaseUrl(text: string): string {
  return `${SITE_URL}/s/${text}`;
}

/** The card picture. X: 1200×630 (1.91:1). Farcaster: 1200×800 (3:2, the embed spec). */
export function showcaseCardUrl(text: string, ratio: "x" | "fc" = "x"): string {
  return `${SITE_URL}/s/${text}/card${ratio === "fc" ? "?ratio=3x2" : ""}`;
}

/** The cast's words. The link goes separately as the cast's embed. */
export function showcasePostText(text: string): string {
  return `${text} ✨ spelled with letters I raised in Lexigotchi`;
}

/**
 * The X post's words: the same sentence, naming the game's X account. Only on X, because
 * "@lexigotchi" in a cast would name someone else's Farcaster account. The link goes in X's `url`
 * parameter, and its page's og:image is this showcase's own card (`showcaseCardUrl`).
 */
export function showcaseXText(text: string): string {
  return `${text} ✨ spelled with letters I raised in @${X_HANDLE}`;
}

/**
 * X's web composer, prefilled. On a phone with the X app, this link opens the app.
 *
 * Every X post the game opens tags @lexigotchi (starl3xx, 2026-11-24: "all X share posts need to tag
 * @lexigotchi"). A text that doesn't name the account gets it appended here, so no future share can
 * skip it. The tag goes in the text rather than X's `via` parameter, which some X clients drop and
 * which would tag it twice next to an in-sentence mention. The `url` must be a page whose og:image
 * shows what is being shared (for a showcase, its own letter card), never just the generic card.
 */
export function xIntentUrl(text: string, url: string): string {
  const tag = `@${X_HANDLE}`;
  const u = new URL("https://x.com/intent/post");
  u.searchParams.set("text", text.toLowerCase().includes(tag) ? text : `${text} ${tag}`);
  u.searchParams.set("url", url);
  return u.toString();
}
