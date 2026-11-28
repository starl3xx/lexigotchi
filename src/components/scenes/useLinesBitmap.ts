"use client";
/**
 * The band's ruled lines, kept as a BITMAP while a card is lit (decisions.md #65).
 *
 * The lines are a drawing (lib/cardArt/light): over a hundred fine strokes the size of the card.
 * As a vector background the browser draws them again whenever their layer moves, and since the
 * pointer moves the band, that is every frame the pointer moves. Measured in WebKit on an opened
 * word's card, with the pointer moving all the time: the lean alone 24% of a processor core, the
 * band following it as a vector picture 53%, and as a bitmap on a layer of its own (globals.css)
 * 25%, which can't be told from no band. (Chromium is indifferent: about two points either way.) So the card in focus draws its lines ONCE into a bitmap exactly the size it
 * is shown at, in the screen's own pixels, and shows that. A bitmap made at any other size would
 * be stretched, and stretched fine lines break up.
 *
 * It is the same picture, only kept: until it is ready, and wherever it can't be made, the vector
 * picture shows, which looks the same and only costs more to move. One card is lit at a time, so
 * at most a couple of these exist.
 */
import { useEffect, useState, type RefObject } from "react";

/** The most screen pixels to a CSS pixel the bitmap is made at. */
const DENSEST = 3;

/**
 * @param el the element the lines are shown on (its size is the card's)
 * @param picture the lines as a CSS image, `url("data:…")`
 * @param on whether the card is lit
 * @returns a CSS image of the bitmap once it is made, else null (show `picture`)
 */
export function useLinesBitmap(el: RefObject<HTMLElement | null>, picture: string, on: boolean): string | null {
  const [made, setMade] = useState<{ of: string; url: string } | null>(null);
  useEffect(() => {
    const node = el.current;
    const source = /^url\("(.*)"\)$/.exec(picture)?.[1];
    if (!on || !node || !source || typeof document === "undefined") return;
    let gone = false;
    let url: string | null = null;
    let wait = 0;
    let drawn = "";
    const draw = async () => {
      const k = Math.min(DENSEST, window.devicePixelRatio || 1);
      const w = Math.round(node.offsetWidth * k);
      const h = Math.round(node.offsetHeight * k);
      const size = `${w}x${h}`;
      if (!w || !h || drawn === size) return;
      drawn = size; // claimed before the first wait, so two calls never draw one size twice
      try {
        const img = new Image();
        img.src = source;
        await img.decode();
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        ctx.drawImage(img, 0, 0, w, h);
        const blob = await new Promise<Blob | null>((done) => canvas.toBlob(done));
        // gone, or the card changed size while this one was being made: a newer one is on its way
        if (gone || drawn !== size || !blob) return;
        const next = URL.createObjectURL(blob);
        if (url) URL.revokeObjectURL(url);
        url = next;
        setMade({ of: picture, url: `url("${next}")` });
      } catch {
        // the vector picture stays: the same lines, only dearer to move
        if (drawn === size) drawn = "";
      }
    };
    void draw();
    // A card that changes size (the window, a sheet opening wide) is drawn again at its new size.
    const watch =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(() => {
            window.clearTimeout(wait);
            wait = window.setTimeout(() => void draw(), 160);
          });
    watch?.observe(node);
    return () => {
      gone = true;
      watch?.disconnect();
      window.clearTimeout(wait);
      if (url) URL.revokeObjectURL(url);
      setMade(null);
    };
  }, [el, picture, on]);
  // only for the picture it was made of: a card that changes ink shows the new vector lines at once
  return made && made.of === picture ? made.url : null;
}
