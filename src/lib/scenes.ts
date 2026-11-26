/**
 * Scenes: what a word's card shows behind it. A word stands in its scene on the Today stage, on
 * its card in the Bag, and on the picture a share links to (`/s/<word>?scene=<id>`).
 *
 * The line-up (decisions.md #33; starl3xx, 2026-11-25):
 * - **The stock card** is where every word starts: no place at all, the card's own engraving in
 *   grey with the word's rarity as an overtone. Every player has it.
 * - **The Stage** is free for everyone too.
 * - **The Trophy Case and Spring** unlock together once the player has held SCENE_UNLOCK_WORDS
 *   words (starl3xx, 2026-11-24: "an Unlock for reaching, say, 3 words spelled"), and stay open
 *   after that ("unlock should stay open after 3 words, even if one is dissolved"). So the count is
 *   every word the player has EVER held, counted once (the chain store reads it from the same
 *   transfer scan as the bag, readWordsHeld), linked wallets' words included, because a linked
 *   wallet is the same player (union bag, decisions.md). A dissolved or sold word still counts.
 * - **Retired:** Picture Day, Summer, Fall, and Winter. They were free, so nobody lost a purchase.
 *   A saved pick or a link that names one reads as the stock card (`storedScene`).
 *
 * A scene is cosmetic and offchain. Each word's choice is saved in the browser at once, and to the
 * player's profile (table word_scenes, /api/scenes) under a profile session they already have, so
 * it follows them to every device and host; useWordScene says how the two agree. The share link
 * carries the scene, so a share shows the scene the player chose wherever it is opened.
 *
 * Pure (no React), so the server's share picture and the client read the same list.
 */

export const SCENE_IDS = ["stock", "stage", "trophy", "spring"] as const;
export type SceneId = (typeof SCENE_IDS)[number];

/** Where a word stands when nobody picked a scene for it: the stock card. */
export const DEFAULT_SCENE: SceneId = "stock";

/**
 * What a share link with no `scene` in it means: the Stage. Links were made that way before the
 * stock card existed (the Stage was the default and took no parameter), and they are posted for
 * good, so they keep their meaning. Every scene but the Stage is written into its link.
 */
export const LINK_DEFAULT_SCENE: SceneId = "stage";

/** The scenes every player has from their first word. */
export const FREE_SCENES: readonly SceneId[] = ["stock", "stage"];

/** Words a player must have held before the scenes past the free ones open, for good. */
export const SCENE_UNLOCK_WORDS = 3;

export interface SceneMeta {
  id: SceneId;
  name: string;
  /** One short line for the picker. */
  blurb: string;
}

export const SCENES: readonly SceneMeta[] = [
  { id: "stock", name: "Stock card", blurb: "The card itself, in the word’s rarity." },
  { id: "stage", name: "The Stage", blurb: "Curtains up, lights on." },
  { id: "trophy", name: "Trophy Case", blurb: "On the shelf with the cups." },
  { id: "spring", name: "Spring", blurb: "A green hill under the blossom." },
];

export function isSceneId(raw: unknown): raw is SceneId {
  return typeof raw === "string" && (SCENE_IDS as readonly string[]).includes(raw);
}

/** The scenes that were retired (decisions.md #33). Kept by name, because picks of them are still stored. */
export const RETIRED_SCENES: readonly string[] = ["portrait", "summer", "fall", "winter"];

/**
 * A stored pick's scene, as it reads today: a scene as itself, a retired scene as the stock card,
 * anything else (a mangled value) as nothing.
 *
 * A retired pick is still a PICK, made at its own time: the player chose to leave whatever they
 * had before it. Dropping it would bring that older scene back (a Stage pick in this browser, then
 * Picture Day picked on another device, would show the Stage again: Bugbot on #226). So it keeps
 * its place in time and shows the stock card.
 */
export function storedScene(raw: unknown): SceneId | null {
  if (isSceneId(raw)) return raw;
  return typeof raw === "string" && RETIRED_SCENES.includes(raw) ? DEFAULT_SCENE : null;
}

/** A scene from storage. Anything unknown (a retired scene, a mangled value) is the stock card. */
export function parseScene(raw: unknown): SceneId {
  return isSceneId(raw) ? raw : DEFAULT_SCENE;
}

/**
 * A scene from a share link's `scene`. None at all is the Stage (LINK_DEFAULT_SCENE says why);
 * one that isn't a scene any more (a link to a retired scene) is the stock card.
 */
export function parseLinkScene(raw: unknown): SceneId {
  if (raw === undefined || raw === null || raw === "") return LINK_DEFAULT_SCENE;
  return parseScene(Array.isArray(raw) ? raw[0] : raw);
}

export function sceneMeta(id: SceneId): SceneMeta {
  return SCENES.find((s) => s.id === id) ?? SCENES[0];
}

/** Are the scenes past the free ones open to a player who has held `wordsHeld` words (ever, counted once)? */
export function scenesUnlocked(wordsHeld: number): boolean {
  return wordsHeld >= SCENE_UNLOCK_WORDS;
}

/** Can this player use `id` now? The free scenes always; the rest once unlocked. */
export function canUseScene(id: SceneId, wordsHeld: number): boolean {
  return FREE_SCENES.includes(id) || scenesUnlocked(wordsHeld);
}

/**
 * The scene to draw for a word: the player’s choice if they can use it, else the stock card
 * (before the unlock, or while the words read is still loading).
 */
export function shownScene(chosen: SceneId | null | undefined, wordsHeld: number): SceneId {
  return chosen && canUseScene(chosen, wordsHeld) ? chosen : DEFAULT_SCENE;
}
