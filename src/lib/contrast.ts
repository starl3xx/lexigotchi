/**
 * Contrast between two colors (WCAG), and moving a color until something reads on it. Used where a
 * color comes from outside the design: a collab set's two colors are whatever an operator typed
 * (lib/collabLook.ts, lib/rarityFinish.ts `collabFinish`). Pure.
 */

const channel = (v: number) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);

/** WCAG relative luminance of "#rrggbb". */
export function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => channel(parseInt(hex.slice(i, i + 2), 16) / 255));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio of two colors, 1 to 21. */
export function contrast(x: string, y: string): number {
  const [hi, lo] = [luminance(x), luminance(y)].sort((p, q) => q - p);
  return (hi + 0.05) / (lo + 0.05);
}

/** Text a player must read: letters on a tile, lettering on a card. */
export const READS = 4.5;
/** A line or a mark that must be seen, not read. */
export const SHOWS = 3;

/** Two hex colors mixed: t = 0 is `a`, 1 is `b`. */
export function mixHex(a: string, b: string, t: number): string {
  const p = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [x, y] = [p(a), p(b)];
  return `#${x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, "0")).join("")}`;
}

/** `color` moved toward `toward` in tenths until `ok(color)`; null when it never is. */
export function moved(color: string, toward: string, ok: (c: string) => boolean): string | null {
  for (let i = 0; i <= 10; i++) {
    const c = mixHex(color, toward, i / 10);
    if (ok(c)) return c;
  }
  return null;
}
