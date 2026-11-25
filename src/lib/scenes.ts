/**
 * Scenes: where a word lives. A word stands in its scene on the Today stage, in the Showcase, and
 * on the card a share links to (`/s/<word>?scene=<id>`).
 *
 * Every player has the Stage. The other scenes unlock together once the player has held
 * SCENE_UNLOCK_WORDS words (starl3xx, 2026-11-24: "an Unlock for reaching, say, 3 words spelled"),
 * and stay open after that ("unlock should stay open after 3 words, even if one is dissolved"). So
 * the count is every word the player has EVER held, counted once (the chain store reads it from the
 * same transfer scan as the bag, readWordsHeld), linked wallets' words included, because a linked
 * wallet is the same player (union bag, decisions.md). A dissolved or sold word still counts.
 *
 * A scene is cosmetic and offchain. Each word's choice is saved in the browser at once, and to the
 * player's profile (table word_scenes, /api/scenes) under a profile session they already have, so
 * it follows them to every device and host; useWordScene says how the two agree. The share link
 * carries the scene, so a share shows the scene the player chose wherever it is opened.
 *
 * Pure (no React), so the server's share card and the client read the same list.
 */

export const SCENE_IDS = ["stage", "trophy", "portrait", "spring", "summer", "fall", "winter"] as const;
export type SceneId = (typeof SCENE_IDS)[number];

export const DEFAULT_SCENE: SceneId = "stage";

/** Words a player must have held before the scenes past the Stage open, for good. */
export const SCENE_UNLOCK_WORDS = 3;

export interface SceneMeta {
  id: SceneId;
  name: string;
  /** One short line for the picker. */
  blurb: string;
}

export const SCENES: readonly SceneMeta[] = [
  { id: "stage", name: "The Stage", blurb: "Curtains up, lights on." },
  { id: "trophy", name: "Trophy Case", blurb: "Behind glass, in the spotlight." },
  { id: "portrait", name: "Picture Day", blurb: "Sit up straight and smile." },
  { id: "spring", name: "Spring", blurb: "Blossoms on the breeze." },
  { id: "summer", name: "Summer", blurb: "Sun, sand, and a sea breeze." },
  { id: "fall", name: "Fall", blurb: "Leaves coming down." },
  { id: "winter", name: "Winter", blurb: "Snow on a quiet night." },
];

export function isSceneId(raw: unknown): raw is SceneId {
  return typeof raw === "string" && (SCENE_IDS as readonly string[]).includes(raw);
}

/** A scene from a link or storage. Anything unknown is the Stage, so an old or mangled link still draws. */
export function parseScene(raw: unknown): SceneId {
  return isSceneId(raw) ? raw : DEFAULT_SCENE;
}

export function sceneMeta(id: SceneId): SceneMeta {
  return SCENES.find((s) => s.id === id) ?? SCENES[0];
}

/** Are the scenes past the Stage open to a player who has held `wordsHeld` words (ever, counted once)? */
export function scenesUnlocked(wordsHeld: number): boolean {
  return wordsHeld >= SCENE_UNLOCK_WORDS;
}

/** Can this player use `id` now? The Stage always; the rest once unlocked. */
export function canUseScene(id: SceneId, wordsHeld: number): boolean {
  return id === DEFAULT_SCENE || scenesUnlocked(wordsHeld);
}

/**
 * The scene to draw for a word: the player’s choice if they can use it, else the Stage (before the
 * unlock, or while the words read is still loading).
 */
export function shownScene(chosen: SceneId | null | undefined, wordsHeld: number): SceneId {
  return chosen && canUseScene(chosen, wordsHeld) ? chosen : DEFAULT_SCENE;
}
