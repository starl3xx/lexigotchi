/**
 * A Showcase share: one of the player's words, in its case and its scene, as a link with its own
 * card.
 *
 * Built for X first, Farcaster second. X shows a large picture only when the shared link's page
 * carries its own `og:image`, and the old share posted `/play`, whose card is the generic logo. So
 * each showcase gets a page, `/s/<word>`, whose card draws that word (`/s/<word>/card`): a 1.91:1
 * picture for X's large card, and a 3:2 one for the Farcaster embed, whose spec requires 3:2. The
 * case in the path is the case of each tile: `/s/CRAne` is C, R, and A UPPERCASE. `?scene=` names
 * the scene the word stands in (lib/scenes); with none, it stands on the Stage.
 *
 * A showcase is a dictionary word (starl3xx, 2026-11-24: "Showcase should only be for words you
 * own (people could tweet all sorts of crazy shit otherwise!)"). The app offers only the player's
 * own words, and the page and card draw only dictionary words, so a hand-typed link can't put any
 * other text on the game's card. The dictionary is the guard, not ownership. The page doesn't ask
 * who owns the word: a word changes hands, its case changes as its letters are rolled up, and a
 * posted link must keep drawing after both. So a hand-typed link can still draw a dictionary word
 * the sender doesn't own, in any case and scene. That is the limit, and it is harmless.
 */
import { isWord } from "./dictionary";
import { LINK_DEFAULT_SCENE, type SceneId } from "./scenes";
import { SITE_URL, X_HANDLE } from "./site";

/**
 * The game's own cards, drawn though they are not dictionary words: the beta group's welcome
 * (`/s/HEYOO/card`, lib/telegram.ts). Add to this list only for a card the game itself sends.
 */
export const HOUSE_CARDS: readonly string[] = ["HEYOO"];

export interface ShowcaseTile {
  char: string;
  upper: boolean;
}

/** A dictionary word (or a house card), A to Z in either case. Anything else is not a showcase. */
export function parseShowcase(raw: string): ShowcaseTile[] | null {
  let text = raw;
  try {
    text = decodeURIComponent(raw);
  } catch {
    return null;
  }
  if (!/^[A-Za-z]+$/.test(text)) return null;
  const key = text.toUpperCase();
  if (!isWord(key) && !HOUSE_CARDS.includes(key)) return null;
  return [...text].map((c) => ({ char: c.toUpperCase(), upper: c === c.toUpperCase() }));
}

/** The tiles back as the path text: UPPERCASE tiles as capitals, lowercase as small letters. */
export function showcaseText(tiles: readonly ShowcaseTile[]): string {
  return tiles.map((t) => (t.upper ? t.char.toUpperCase() : t.char.toLowerCase())).join("");
}

/** A word's path text from its letters and their case: CRANE with C, R, A raised is "CRAne". */
export function showcaseWordText(word: string, upper: readonly boolean[]): string {
  return [...word].map((c, i) => (upper[i] ? c.toUpperCase() : c.toLowerCase())).join("");
}

/**
 * The Stage takes no parameter: a link made before the other scenes existed is a Stage link, and
 * such links are posted for good (lib/scenes, LINK_DEFAULT_SCENE). Every other scene is named,
 * the stock card too, though it is where a word starts.
 */
function sceneQuery(scene: SceneId | undefined, more: Record<string, string> = {}): string {
  const q = new URLSearchParams(more);
  if (scene && scene !== LINK_DEFAULT_SCENE) q.set("scene", scene);
  const s = q.toString();
  return s ? `?${s}` : "";
}

export function showcaseUrl(text: string, scene?: SceneId): string {
  return `${SITE_URL}/s/${text}${sceneQuery(scene)}`;
}

/**
 * The card picture's look, as a number in its address (`v`). A word's card is the same picture
 * forever, so it is cached hard: a day in a browser, a week at the edge, and for good by X and
 * Farcaster. "Forever" ends when the card is redrawn, and then every one of those caches is wrong
 * at once: the share video drew its front from the browser's copy and showed the old letters for a
 * day after the letters changed (starl3xx, 2026-11-25). So raise this whenever the picture's look
 * changes (the letters, a scene, the frame), and every cache starts again.
 *
 * 2: the letter review (decisions.md #28).
 * 3: the card as an object: its frame, its ribbon, the engraved scenes (decisions.md #34).
 * 4: the back relettered, with the game's seal (decisions.md #35, #37). The back's picture had no
 *    version in its address until now, so the share video kept drawing the old back from a cached
 *    copy after #35 shipped (starl3xx, 2026-11-26: "the back of the card isn't in the share video
 *    yet"). Every picture of a card, front or back, carries this number.
 * 5: the letters' ground shadow as ruled lines (decisions.md #48).
 */
export const CARD_LOOK = 5;

/** The card picture. X: 1200×630 (1.91:1). Farcaster: 1200×800 (3:2, the embed spec). */
export function showcaseCardUrl(text: string, ratio: "x" | "fc" = "x", scene?: SceneId, saved = false): string {
  return `${SITE_URL}${showcaseCardPath(text, ratio, scene, saved)}`;
}

/**
 * The card's path on this site. The game reads the picture through it (Save image), because
 * `SITE_URL` may name another origin than the page's (a preview build, localhost).
 *
 * `saved`: the picture travels alone (Save image, and later the share video), so it carries a
 * quiet wordmark in its corner. A link card carries no name: X shows the site under it and the
 * post names @lexigotchi, and Farcaster's card has the game's button (decisions.md #23).
 */
export function showcaseCardPath(text: string, ratio: "x" | "fc" = "x", scene?: SceneId, saved = false): string {
  return `/s/${text}/card${sceneQuery(scene, { ...(ratio === "fc" ? { ratio: "3x2" } : {}), ...(saved ? { saved: "1" } : {}), v: String(CARD_LOOK) })}`;
}

/**
 * The card's front alone, 1200×675 with clear corners: no table under it. The share loop turns it
 * over (components/cards/loop), so it wants the card itself, the size of the back's picture.
 */
export function showcaseFacePath(text: string, scene?: SceneId): string {
  return `/s/${text}/card${sceneQuery(scene, { face: "1", v: String(CARD_LOOK) })}`;
}

/**
 * The back of the word's card, for the share loop's turning card (`/s/<word>/back`, same origin).
 * Its look is in its address too (CARD_LOOK): the picture is kept for minutes by browsers and the
 * edge, and a redrawn back must not be served from an old copy.
 */
export function showcaseBackPath(text: string): string {
  return `/s/${text}/back?v=${CARD_LOOK}`;
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
