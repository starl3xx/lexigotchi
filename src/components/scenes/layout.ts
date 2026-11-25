/**
 * Where a word's characters stand in a scene, shared by the app (SceneFrame) and the share card
 * (`/s/<word>/card`), so both put the feet on the scene's floor line at the same size.
 *
 * The box is W × H pixels and the scene is drawn W/SCENE_W pixels per unit (the caller draws it
 * with h = H × SCENE_W / W, so the drawing fills the box exactly).
 */
import { SCENE_FLOOR, SCENE_W } from "./kit";

/** The characters' row may span this many scene units: inside the Stage's curtains. */
const ROW_UNITS = 800;
/** A character is never wider than this many scene units. */
const MAX_TILE_UNITS = 190;
/** Full-body characters hold hands: each overlaps the last by this share of its width (TileWord). */
export const LINK_OVERLAP = 0.14;
/** The character rig's box is 240 × 340 and its shoes rest on y = 302 (TileCharacter's FOOT_Y + 2). */
export const TILE_ASPECT = 340 / 240;
export const FOOT_SHARE = 302 / 340;

export function sceneLayout(n: number, W: number, H: number) {
  const s = W / SCENE_W;
  const units = Math.min(MAX_TILE_UNITS, ROW_UNITS / (n - (n - 1) * LINK_OVERLAP));
  const tileW = Math.round(units * s);
  const tileH = tileW * TILE_ASPECT;
  const overlap = Math.round(tileW * LINK_OVERLAP);
  const rowW = n * tileW - (n - 1) * overlap;
  const feetY = Math.round(H - SCENE_FLOOR * s);
  return {
    /** Pixels per scene unit. */
    s,
    tileW,
    overlap,
    rowW,
    rowLeft: Math.round((W - rowW) / 2),
    feetY,
    /** The row's bottom edge, measured up from the box's bottom: the feet on the line. */
    rowBottom: Math.round(H - feetY - tileH * (1 - FOOT_SHARE)),
    /** The top of the characters' heads (their box top), from the box's top. */
    rowTop: Math.round(feetY - tileH * FOOT_SHARE),
  };
}

/** The scene height (in scene units) that fills a W × H box exactly. */
export function sceneHeightFor(W: number, H: number): number {
  return Math.round((H * SCENE_W) / W);
}
