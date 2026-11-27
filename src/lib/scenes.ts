/**
 * Scenes: what a word's card shows behind it. A word stands in its scene on the Today stage, on
 * its card in the Bag, and on the picture a share links to (`/s/<word>?scene=<id>`).
 *
 * The line-up (decisions.md #34; starl3xx, 2026-11-25):
 * - **The stock card** is where every word starts: no place at all, the card's own engraving in
 *   grey with the word's rarity as an overtone. Every player has it.
 * - **The dark stock face** is the stock face's other side (decisions.md #56; starl3xx, 2026-11-27):
 *   the same engraving on a pewter plate in pale line, the rarity still an overtone. Every player
 *   has it. Its id, "darkstock", is in share links and saved picks, so it never changes.
 * - **The Stage** is free for everyone too.
 * - **The Trophy Case and Spring** unlock together once the player has held SCENE_UNLOCK_WORDS
 *   words (starl3xx, 2026-11-24: "an Unlock for reaching, say, 3 words spelled"), and stay open
 *   after that ("unlock should stay open after 3 words, even if one is dissolved"). So the count is
 *   every word the player has EVER held, counted once (the chain store reads it from the same
 *   transfer scan as the bag, readWordsHeld), linked wallets' words included, because a linked
 *   wallet is the same player (union bag, decisions.md). A dissolved or sold word still counts.
 * - **The Bookshelf and Outer Space are the Shop's** (decisions.md #41; starl3xx, 2026-11-25: "add
 *   bookshelf, outer space (maybe as shop items, but still good to build)"). A player has one only
 *   once their profile has bought it (lib/shop/scenes says what "bought" is). Until the Shop lists
 *   one, nobody has it and the picker doesn't show it. Outer Space is listed on Base Sepolia
 *   (2026-11-27); the Bookshelf is not. A bought scene is the PROFILE's, for every word it holds,
 *   and never the word's: a word that is sold reaches its buyer on the stock card.
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

export const SCENE_IDS = ["stock", "darkstock", "stage", "trophy", "spring", "bookshelf", "space"] as const;
export type SceneId = (typeof SCENE_IDS)[number];

/** Where a word stands when nobody picked a scene for it: the stock card. */
export const DEFAULT_SCENE: SceneId = "stock";

/**
 * What a share link with no `scene` in it means: the Stage. Links were made that way before the
 * stock card existed (the Stage was the default and took no parameter), and they are posted for
 * good, so they keep their meaning. Every scene but the Stage is written into its link.
 */
export const LINK_DEFAULT_SCENE: SceneId = "stage";

/** The faces every player has from their first word. */
export const FREE_SCENES: readonly SceneId[] = ["stock", "darkstock", "stage"];

/** The scenes that open with the 3-word unlock. */
export const UNLOCK_SCENES: readonly SceneId[] = ["trophy", "spring"];

/** The scenes the Shop sells: a player's only once their profile has bought one. */
export const SHOP_SCENES: readonly SceneId[] = ["bookshelf", "space"];

export function isShopScene(id: SceneId): boolean {
  return SHOP_SCENES.includes(id);
}

/** Words a player must have held before the scenes past the free ones open, for good. */
export const SCENE_UNLOCK_WORDS = 3;

export interface SceneMeta {
  id: SceneId;
  name: string;
  /** One short line for the picker. */
  blurb: string;
}

export const SCENES: readonly SceneMeta[] = [
  { id: "stock", name: "Stock (light)", blurb: "The card’s own engraving, in the word’s rarity." },
  { id: "darkstock", name: "Stock (dark)", blurb: "The same engraving, on a pewter plate." },
  { id: "stage", name: "The Stage", blurb: "Curtains up, lights on." },
  { id: "trophy", name: "Trophy Case", blurb: "On the shelf with the cups." },
  { id: "spring", name: "Spring", blurb: "A green hill under the blossom." },
  { id: "bookshelf", name: "Bookshelf", blurb: "A shelf of its own, among the books." },
  { id: "space", name: "Outer Space", blurb: "A small world under the stars." },
];

export function isSceneId(raw: unknown): raw is SceneId {
  return typeof raw === "string" && (SCENE_IDS as readonly string[]).includes(raw);
}

/** The scenes that were retired (decisions.md #34). Kept by name, because picks of them are still stored. */
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

/** Are the 3-word scenes open to a player who has held `wordsHeld` words (ever, counted once)? */
export function scenesUnlocked(wordsHeld: number): boolean {
  return wordsHeld >= SCENE_UNLOCK_WORDS;
}

/**
 * Can this player use `id` now? The free scenes always; the 3-word scenes once unlocked; a Shop
 * scene only when the player's profile has bought it (`bought`: the Shop scenes it has).
 */
export function canUseScene(id: SceneId, wordsHeld: number, bought: ReadonlySet<SceneId> = NONE): boolean {
  if (FREE_SCENES.includes(id)) return true;
  if (isShopScene(id)) return bought.has(id);
  return scenesUnlocked(wordsHeld);
}
const NONE: ReadonlySet<SceneId> = new Set();

/**
 * Whether a word's saved pick SHOWS, in the running game, where an answer may not be in yet:
 * - a free scene always;
 * - a 3-word scene once `unlocked` (the caller counts "words not known yet" as unlocked);
 * - a Shop scene when the profile has bought it, or while that isn't known (`shopKnown` false: the
 *   wardrobe is loading, its read failed, or the Shop is switched off). Unknown is not "no": taking
 *   a paid scene off a buyer's card because a read failed would be the worse mistake.
 * What the picker OFFERS is stricter: a Shop scene only on a positive answer.
 */
export function sceneShows(id: SceneId, a: { unlocked: boolean; bought: ReadonlySet<SceneId>; shopKnown: boolean }): boolean {
  if (FREE_SCENES.includes(id)) return true;
  if (isShopScene(id)) return a.bought.has(id) || !a.shopKnown;
  return a.unlocked;
}

/**
 * The scene to draw for a word: the player’s choice if they can use it, else the stock card
 * (before the unlock, without the purchase, or while the words read is still loading).
 */
export function shownScene(chosen: SceneId | null | undefined, wordsHeld: number, bought: ReadonlySet<SceneId> = NONE): SceneId {
  return chosen && canUseScene(chosen, wordsHeld, bought) ? chosen : DEFAULT_SCENE;
}
