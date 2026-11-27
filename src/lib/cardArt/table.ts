/**
 * The dark table a card lies on in a link picture, a saved picture, the Telegram welcome, and the
 * earnings picture, engraved (decisions.md #48, part 9). It was a soft pool of light: a radial
 * gradient. The table is around the card, so it is drawn like the cards: a ruled ground, fine rays
 * from behind the card, and two bands of guilloche, in one lighter ink on the dark.
 *
 * The old pool of light is kept the engraver's way: tone is made by how much line there is. The
 * rays and the bands are densest near the card's middle and thin out toward the corners.
 *
 * One still picture, built as a string like every scene (./engrave says the rules): no text, no
 * filter, nothing fetched. The pictures place it with `<img>`, as they place a scene.
 */
import { guilloche, hatch, n1, sunburst, svgDoc } from "./engrave";

export const TABLE = { ground: "#16293a", line: "#4f7f9e" } as const;

/** The table, `w` by `h`. The card lies a little above its middle (42% down), where the old light was. */
export function tableDoc(w: number, h: number): string {
  const cx = n1(w / 2);
  const cy = n1(h * 0.42);
  const reach = Math.hypot(w, h); // past every corner
  return svgDoc(
    `<defs>${hatch("tb-rule", 0, 6, TABLE.line, 1, 0.2)}</defs>` +
      `<rect width="${w}" height="${h}" fill="${TABLE.ground}"/>` +
      `<rect width="${w}" height="${h}" fill="url(#tb-rule)"/>` +
      // fine rays from behind the card: two sets, the second shorter, so there is more line near the card
      `<path d="${sunburst(cx, cy, 120, reach, 96, 0.22)}" fill="${TABLE.line}" opacity="0.14"/>` +
      `<path d="${sunburst(cx, cy, 120, n1(reach * 0.46), 96, 0.5)}" fill="${TABLE.line}" opacity="0.1"/>` +
      // two woven bands: one that shows in the margins beside the card, one out toward the corners
      guilloche("tb-g1", cx, cy, n1(w * 0.455), n1(w * 0.02), 36, 5, TABLE.line, 1.1, 0.4) +
      guilloche("tb-g2", cx, cy, n1(w * 0.52), n1(w * 0.014), 48, 3, TABLE.line, 1, 0.26),
    w,
    h,
  );
}

const kept = new Map<string, string>();
/** The table as an address a server picture's `<img>` takes (Satori), kept per size. Server only: it uses Buffer. */
export function tableImage(w: number, h: number): string {
  const key = `${w}x${h}`;
  let img = kept.get(key);
  if (!img) {
    img = `data:image/svg+xml;base64,${Buffer.from(tableDoc(w, h)).toString("base64")}`;
    kept.set(key, img);
  }
  return img;
}
