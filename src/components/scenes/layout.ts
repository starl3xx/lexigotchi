/**
 * Where a word's characters stand on its card, shared by the app (SceneFrame) and the share
 * picture (`/s/<word>/card`), so both put the feet on the scene's ground at the same size.
 *
 * Everything is in card units (lib/cardArt: the card is 1200 × 675), times `scale` for a caller
 * that draws in pixels (the share picture). The app passes no scale and turns units into percent.
 */
import { CARD_W } from "@/lib/cardArt/engrave";
import { FEET_Y } from "@/lib/cardArt/looks";
import { footingFor, type Footing } from "@/lib/cardArt/scenes";
import type { SceneId } from "@/lib/scenes";

/** The characters' row may span this many card units: inside the Stage's curtains. */
const ROW_UNITS = 800;
/** A character is never wider than this many card units. */
const MAX_TILE_UNITS = 190;
/** Full-body characters hold hands: each overlaps the last by this share of its width (TileWord). */
export const LINK_OVERLAP = 0.14;
/** The character rig's box is 240 × 340 and its shoes rest on y = 302 (TileCharacter's FOOT_Y + 2). */
export const TILE_ASPECT = 340 / 240;
export const FOOT_SHARE = 302 / 340;

export function wordLayout(n: number, scale = 1) {
  const units = Math.min(MAX_TILE_UNITS, ROW_UNITS / (n - (n - 1) * LINK_OVERLAP));
  const tileW = Math.round(units * scale);
  const tileH = tileW * TILE_ASPECT;
  const overlap = Math.round(tileW * LINK_OVERLAP);
  const rowW = n * tileW - (n - 1) * overlap;
  const rowLeft = Math.round((CARD_W * scale - rowW) / 2);
  const feetY = Math.round(FEET_Y * scale);
  return {
    tileW,
    tileH,
    overlap,
    rowW,
    rowLeft,
    /** The feet line, from the card's top. */
    feetY,
    /** The top of the characters' box, from the card's top: the feet on the line. */
    rowTop: Math.round(feetY - tileH * FOOT_SHARE),
    /** The row's bottom edge, from the card's top (the box runs a little below the shoes). */
    rowBottom: Math.round(feetY + tileH * (1 - FOOT_SHARE)),
  };
}

/**
 * How each letter of an `n`-letter word stands in `scene`: level on most, lowered to the ground
 * and turned to its slope where the ground is curved (lib/cardArt/scenes, GROUND). `drop` comes
 * back in the caller's units (card units × scale); the turn is about the letter's own feet
 * (FOOT_SHARE down its box, at its centre).
 */
export function wordFootings(scene: SceneId, n: number, scale = 1): Footing[] {
  const L = wordLayout(n, 1);
  const pitch = L.tileW - L.overlap;
  return Array.from({ length: n }, (_, i) => {
    const f = footingFor(scene, L.rowLeft + i * pitch + L.tileW / 2 - CARD_W / 2);
    return { drop: f.drop * scale, deg: f.deg };
  });
}
