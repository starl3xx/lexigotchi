/**
 * The front of the share video's card, with LIVING letters (decisions.md #48, part 7).
 *
 * The video used to turn two still pictures, so its letters were frozen. Here the card's front is
 * put together again for every frame: the server's picture of the card WITHOUT its letters (the
 * scene, the frame, the ribbon: lib/showcase, showcaseStagePath), and over it the letters, drawn by
 * the game's own rig and moved by the score (./score).
 *
 * The letters are the game's, not a copy of them: TileCharacter is drawn once as one drawing
 * (`flat`, held still), and that drawing is cut into its layers (the floor, the rings, the legs,
 * the body, the joined hands), each kept as a picture; the body once for each thing its eyes can
 * do. A frame then only places pictures: the body rises, the legs stretch under it, the eyes are
 * whichever picture the score names. So a gilded word wears its gilding, a rarity its material.
 *
 * - A picture of a drawing can't see the page's fonts, so Söhne is put inside each piece.
 * - Every picture here comes from this site or from the page itself, so the frames can be encoded.
 * - `draw(t)` is the same picture for the same `t`, on every device.
 *
 * Loaded only when a video is made (with ./makeLoop).
 */
import type { ReactElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { TileCharacter, type Gild } from "../../game/TileCharacter";
import { FOOT_Y, VB, leanFor } from "../../game/tileShapes";
import { FOOT_SHARE, wordFootings, wordLayout } from "../../scenes/layout";
import { CARD_H, CARD_W } from "@/lib/cardArt/engrave";
import type { SceneId } from "@/lib/scenes";
import type { Tier } from "@/lib/economy";
import { BREATH_UNITS, GLANCE_UNITS, LEG_STRETCH, breathAt, eyesAt, type Eyes } from "./score";

interface Sprite {
  floor: CanvasImageSource | null;
  rings: CanvasImageSource | null;
  legs: CanvasImageSource | null;
  body: Record<Eyes, CanvasImageSource>;
  top: CanvasImageSource | null;
}

const XMLNS = "http://www.w3.org/2000/svg";
function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("could not load a piece"));
    img.src = src;
  });
}

/** The rig's own drawing of a letter, as it stands in the page for a moment: one <svg>, its layers as named groups. */
function drawLetter(el: ReactElement): SVGSVGElement {
  const host = document.createElement("div");
  const root = createRoot(host);
  flushSync(() => root.render(el));
  const svg = host.querySelector("svg");
  if (!svg) {
    root.unmount();
    throw new Error("the rig drew nothing");
  }
  const copy = svg.cloneNode(true) as SVGSVGElement;
  root.unmount();
  return copy;
}

/**
 * One layer of a letter's drawing, as markup that STANDS ALONE: it becomes a picture of its own,
 * with no page around it and none of the drawing's other layers. So:
 * - **It brings the drawing's definitions with it.** A layer may point at a gradient or a clip that
 *   another layer defines (the Holographic foil's gradient and a rarity's glow are defined in the
 *   body, and the rings point at them). In the page that works, since an id is the page's. Alone,
 *   a paint that points at nothing draws nothing: the foil rings would be missing.
 * - **The printed letter names its font outright:** no page is there to say what --font-body is.
 * - **Nothing in it runs on its own clock** (a drifting foil would be drawn wherever it had got to).
 * `tests/living-video.test.tsx` holds all three, for every rarity, stage, and case.
 */
export function pieceOf(svg: SVGSVGElement, layer: string, change?: (g: Element) => void): string | null {
  const g = [...svg.children].find((c) => c.getAttribute("data-layer") === layer);
  if (!g) return null;
  const copy = g.cloneNode(true) as Element;
  const others = [...svg.querySelectorAll("defs")].filter((d) => !g.contains(d)).map((d) => d.cloneNode(true) as Element);
  for (const part of [copy, ...others]) part.querySelectorAll("animate, animateTransform, animateMotion, set").forEach((el) => el.remove());
  copy.querySelectorAll("text").forEach((t) => t.setAttribute("font-family", PIECE_FONT));
  change?.(copy);
  const xml = new XMLSerializer();
  return others.map((d) => xml.serializeToString(d)).join("") + xml.serializeToString(copy);
}
/** The font a piece's letter is printed in: the family the piece's own @font-face names. */
const PIECE_FONT = "Soehne, sans-serif";
/** The body, with the eyes one way: open (the shut drawing taken out), shut, or open and glancing. */
export const withEyes = (eyes: Eyes) => (g: Element) => {
  g.querySelectorAll(eyes === "shut" ? ".tc-eye-open" : ".tc-eye-shut").forEach((el) => el.remove());
  g.querySelectorAll(".tc-eye-shut").forEach((el) => el.removeAttribute("visibility"));
  if (eyes === "left" || eyes === "right") g.querySelectorAll(".tc-pupil").forEach((el) => el.setAttribute("transform", `translate(${eyes === "left" ? -GLANCE_UNITS : GLANCE_UNITS} 0)`));
};

export interface LiveFrontSpec {
  /** The word, and each letter's case. */
  word: string;
  upper: readonly boolean[];
  tier?: Tier;
  /** Its ascension stage: its letters wear it. */
  gild: number;
  scene: SceneId;
  /** The card's front without its letters (lib/showcase, showcaseStagePath), from this site. */
  stage: CanvasImageSource;
  /** Söhne 800 as a data: address. */
  fontDataUrl: string;
}

export interface LiveFront {
  /** The front, the card's own size (1200×675). Redrawn by `draw`. */
  canvas: HTMLCanvasElement;
  /** Draw the front as it is at time `t` (seconds into the loop). */
  draw(t: number): void;
}

/**
 * Build the living front. It rejects if a piece can't be made or read (the caller then keeps the
 * server's still picture of the front: a video is always made).
 */
export async function makeLiveFront(spec: LiveFrontSpec): Promise<LiveFront> {
  const n = spec.word.length;
  const L = wordLayout(n, 1);
  const footings = wordFootings(spec.scene, n, 1);
  const fontCss = `@font-face{font-family:"Soehne";src:url("${spec.fontDataUrl}") format("woff2");font-weight:800;font-style:normal}`;
  // twice the size it is drawn at, so a letter stays sharp as the card comes toward the viewer
  const px = L.tileW * 2;
  const py = Math.round((px * VB.h) / VB.w);
  const gild = Math.max(0, Math.min(5, Math.round(spec.gild))) as Gild;

  const raster = async (piece: string | null, font = fontCss): Promise<HTMLCanvasElement | null> => {
    if (!piece) return null;
    const doc = `<svg xmlns="${XMLNS}" viewBox="0 0 ${VB.w} ${VB.h}" width="${px}" height="${py}"><style>${font}</style>${piece}</svg>`;
    const img = await loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(doc)}`);
    const c = document.createElement("canvas");
    c.width = px;
    c.height = py;
    c.getContext("2d")!.drawImage(img, 0, 0, px, py);
    return c;
  };
  // Is a piece's letter really printed in Söhne? A line of text is drawn twice, with the font
  // inside it and without: in Söhne the two must differ. (The same line for every word, so the
  // answer never hangs on which letter a word starts with.)
  const PROBE = `<text x="8" y="${VB.h * 0.6}" font-family="${PIECE_FONT}" font-weight="800" font-size="${VB.h * 0.34}">RaQg</text>`;
  const inSoehne = async () => {
    const [a, b] = await Promise.all([raster(PROBE), raster(PROBE, "")]);
    const x = a!.getContext("2d")!.getImageData(0, 0, px, py).data;
    const y = b!.getContext("2d")!.getImageData(0, 0, px, py).data;
    let diff = 0;
    for (let k = 3; k < x.length; k += 4) if (Math.abs(x[k] - y[k]) > 60) diff++;
    return diff > px * py * 0.004;
  };

  const drawings = [...spec.word].map((ch, i) =>
    drawLetter(<TileCharacter char={ch} upper={spec.upper[i] ?? false} gild={gild} tier={spec.tier} index={i} linkLeft={i > 0} linkRight={i < n - 1} lean={leanFor(spec.word, i)} size={L.tileW} detail="full" flat still />),
  );
  const build = async (): Promise<Sprite[]> => {
    const sprites: Sprite[] = [];
    for (const svg of drawings) {
      const body = async (eyes: Eyes) => {
        const c = await raster(pieceOf(svg, "body", withEyes(eyes)));
        if (!c) throw new Error("a letter has no body");
        return c;
      };
      sprites.push({
        floor: await raster(pieceOf(svg, "floor")),
        rings: await raster(pieceOf(svg, "rings")),
        legs: await raster(pieceOf(svg, "legs")),
        body: { open: await body("open"), shut: await body("shut"), left: await body("left"), right: await body("right") },
        top: await raster(pieceOf(svg, "top")),
      });
    }
    return sprites;
  };
  // A browser may draw a piece before the font inside it is ready (older Safari did). So the font
  // is asked for first, a few times; and if it never comes, there is no living front: a letter in
  // the wrong font is worse than a still one (the caller keeps the server's picture).
  let ready = await inSoehne();
  for (let tries = 0; !ready && tries < 4; tries++) {
    await new Promise((r) => setTimeout(r, 120));
    ready = await inSoehne();
  }
  if (!ready) throw new Error("the letters' font did not load inside their pictures");
  const sprites = await build();

  const canvas = document.createElement("canvas");
  canvas.width = CARD_W;
  canvas.height = CARD_H;
  const g = canvas.getContext("2d")!;
  const unit = L.tileW / VB.w; // pixels a rig unit
  const feetLine = L.rowTop + (FOOT_Y - 6) * unit; // where the legs stretch from
  const draw = (t: number) => {
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.drawImage(spec.stage, 0, 0, CARD_W, CARD_H);
    for (let i = 0; i < n; i++) {
      const s = sprites[i];
      const x = L.rowLeft + i * (L.tileW - L.overlap);
      const y = L.rowTop;
      const f = footings[i];
      g.save();
      if (f.drop || f.deg) {
        // a letter on curved ground stands on the curve, turned to it about its feet (as the card's picture does)
        const ox = x + L.tileW / 2;
        const oy = y + L.tileH * FOOT_SHARE;
        g.translate(ox, oy + f.drop);
        g.rotate((f.deg * Math.PI) / 180);
        g.translate(-ox, -oy);
      }
      const rise = breathAt(i, t);
      const up = BREATH_UNITS * rise * unit;
      if (s.floor) g.drawImage(s.floor, x, y, L.tileW, L.tileH);
      // the rings rise with the body; the legs stand in front of them and stretch from the feet
      if (s.rings) g.drawImage(s.rings, x, y - up, L.tileW, L.tileH);
      if (s.legs) {
        g.save();
        g.translate(0, feetLine);
        g.scale(1, 1 + LEG_STRETCH * rise);
        g.translate(0, -feetLine);
        g.drawImage(s.legs, x, y, L.tileW, L.tileH);
        g.restore();
      }
      g.drawImage(s.body[eyesAt(i, n, t)], x, y - up, L.tileW, L.tileH);
      if (s.top) g.drawImage(s.top, x, y, L.tileW, L.tileH);
      g.restore();
    }
  };
  draw(0);
  // the frames must be readable, or they can't be encoded: this throws if any piece spoiled the canvas
  g.getImageData(0, 0, 1, 1);
  return { canvas, draw };
}
