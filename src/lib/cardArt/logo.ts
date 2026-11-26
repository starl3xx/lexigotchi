/**
 * The game's two marks, as SVG markup (./engrave says how and why). One source for the app icon,
 * the exports in docs/brand, and anywhere the app draws a mark.
 *
 * - **A, the primary logo** (starl3xx, 2026-11-25: "I still like A as the primary logo"): the
 *   glow-up tile on the game's paper, a wooden edge under it, with the eyes the letters now have
 *   (tall ovals, one big pupil each with its pie cut, no brows at rest; decisions.md #28). The app
 *   icon is this drawing under a paper grain (docs/icon).
 * - **B, the seal** ("I LOVE B as a logo... it could be a seal"): the tile gilded as a word's tiles
 *   are once it ascends, on the tile's own blue, engraved like the cards (rays, a woven band, a
 *   ring of beads). Round by design, so a circle cuts nothing that matters. In one ink it is
 *   ./seal's `sealInk`, pressed into every card's back.
 *
 * Both are drawn in a 512 box. The letter is Söhne Fett's "L" as its own outline (a plain polygon in
 * that face: no font is needed to draw a mark, and a mark never changes with the device's fonts).
 */
import { pupilOf } from "@/components/game/tileShapes";
import { beadRing, guilloche, n1, sunburst } from "./engrave";

export const LOGO = 512;

/** Söhne Fett's "L", in the font's own units (1000 to the em): its outline, and its box. */
const L_GLYPH = { points: [[49, 0], [49, 718], [245, 718], [245, 166], [554, 166], [554, 0]], left: 49, right: 554, cap: 718 } as const;

/** The letter, `capHeight` units tall, centred on x = cx, with its top at y = top. */
function letterL(cx: number, top: number, capHeight: number, fill: string): string {
  const k = capHeight / L_GLYPH.cap;
  const x0 = cx - ((L_GLYPH.left + L_GLYPH.right) / 2) * k;
  const d = L_GLYPH.points.map(([x, y], i) => `${i ? "L" : "M"}${n1(x0 + x * k)} ${n1(top + (L_GLYPH.cap - y) * k)}`).join("") + "Z";
  return `<path d="${d}" fill="${fill}"/>`;
}

/** The letters' eyes at (cx ± dx, y): tall ovals, one big pupil each, its pie cut (tileShapes, pupilOf). */
function eyes(cx: number, y: number, dx: number, rx: number, ry: number, line: number, ink: string): string {
  return ([-1, 1] as const)
    .map((side) => {
      const ex = cx + side * dx;
      const p = pupilOf(ex, y, rx, ry, side);
      return `<ellipse cx="${ex}" cy="${y}" rx="${rx}" ry="${ry}" fill="#ffffff" stroke="${ink}" stroke-width="${line}"/><ellipse cx="${n1(p.cx)}" cy="${n1(p.cy)}" rx="${n1(p.rx)}" ry="${n1(p.ry)}" fill="${ink}"/><path d="${p.cut}" fill="#ffffff"/>`;
    })
    .join("");
}

/** A's measures (docs/icon's, unchanged since 2026-08-12 but for the eyes): the grain's mask reads them too. */
export const LOGO_A = {
  ink: "#2a1e1a",
  paper: "#f4ead2",
  /** the tile's outer ring, and its white face */
  ring: { x: 59.4, y: 66.1, s: 388.2, r: 101.5 },
  face: { x: 106.4, y: 113.1, s: 294.2, r: 54.5 },
  /** the wooden edge: the ring swept along this offset */
  edge: { dx: 5, dy: 10 },
  eyes: { cx: 253.5, y: 106, dx: 53, rx: 44, ry: 51, line: 7.3 },
} as const;

/** A, the primary logo. */
export function logoA(): string {
  const A = LOGO_A;
  return `<defs>
    <linearGradient id="wood" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#b69c72"/><stop offset="1" stop-color="#a1865c"/></linearGradient>
    <linearGradient id="ring" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#cdddfe"/><stop offset="1" stop-color="#a9c1f6"/></linearGradient>
    <linearGradient id="blue" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4f95ff"/><stop offset="1" stop-color="#2e6fdd"/></linearGradient>
    <linearGradient id="face" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#eef1f6"/></linearGradient></defs>
  <rect width="${LOGO}" height="${LOGO}" fill="${A.paper}"/>
  <path d="M 436.9 122.2 L 441.9 132.2 A 101.5 101.5 0 0 1 452.6 177.6 L 452.6 362.8 A 101.5 101.5 0 0 1 351.1 464.3 L 165.9 464.3 A 101.5 101.5 0 0 1 75.1 408.2 L 70.1 398.2 A 101.5 101.5 0 0 1 59.4 352.8 L 59.4 167.6 A 101.5 101.5 0 0 1 160.9 66.1 L 346.1 66.1 A 101.5 101.5 0 0 1 436.9 122.2 Z" fill="url(#wood)"/>
  <rect x="${A.ring.x}" y="${A.ring.y}" width="${A.ring.s}" height="${A.ring.s}" rx="${A.ring.r}" fill="url(#ring)"/>
  <rect x="80.4" y="87.1" width="346.2" height="346.2" rx="80.5" fill="url(#blue)"/>
  <rect x="${A.face.x}" y="${A.face.y}" width="${A.face.s}" height="${A.face.s}" rx="${A.face.r}" fill="url(#face)"/>
  ${letterL(253.5, 184.2, 143.6, "#111827")}
  ${eyes(A.eyes.cx, A.eyes.y, A.eyes.dx, A.eyes.rx, A.eyes.ry, A.eyes.line, A.ink)}`;
}

/** B, the seal, in colour. `round`: only the circle (a clear ground outside it), for a round sticker or picture. */
export function logoB({ round = false }: { round?: boolean } = {}): string {
  const C = LOGO / 2;
  const [x, y, s] = [86, 96, 340];
  const pale = "#dbe8ff";
  const ring = (inset: number, fill: string, rx: number) => `<rect x="${x + inset}" y="${y + inset}" width="${s - 2 * inset}" height="${s - 2 * inset}" rx="${rx}" fill="${fill}"/>`;
  const art = `<rect width="${LOGO}" height="${LOGO}" fill="url(#bg)"/>
    <rect width="${LOGO}" height="${LOGO}" fill="url(#ln)"/>
    <path d="${sunburst(C, C, 60, 420, 40, 0.5)}" fill="#ffffff" opacity="0.07"/>
    ${guilloche("g1", C, C, 221, 12, 26, 5, pale, 1.3, 0.6)}${guilloche("g2", C, C, 221, 12, 13, 4, pale, 1.1, 0.4)}
    <circle cx="${C}" cy="${C}" r="205" fill="none" stroke="${pale}" stroke-width="2.4" opacity="0.75"/>
    <circle cx="${C}" cy="${C}" r="237" fill="none" stroke="${pale}" stroke-width="2.4" opacity="0.75"/>
    ${beadRing(C, C, 245, 9.05, 1.8, pale, 0.85)}
    <rect x="${x + 4}" y="${y + 10}" width="${s}" height="${s}" rx="72" fill="#1d4bb0" opacity="0.6"/>
    ${ring(0, "url(#au)", 72)}${ring(17, "#fdf0c4", 56)}${ring(24, "url(#au)", 50)}${ring(31, "url(#blue)", 44)}${ring(52, "#f7f8fa", 26)}
    ${letterL(C, 214.2, 120.6, "#111827")}
    ${eyes(C, 110, 48, 42, 48, 8, "#1b1714")}`;
  return `<defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4a8cf7"/><stop offset="1" stop-color="#2a63d2"/></linearGradient>
    <linearGradient id="blue" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4f90f8"/><stop offset="1" stop-color="#2f6fe0"/></linearGradient>
    <linearGradient id="au" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f6dc8c"/><stop offset="0.38" stop-color="#d9a93a"/><stop offset="0.62" stop-color="#b98720"/><stop offset="1" stop-color="#e8c463"/></linearGradient>
    <pattern id="ln" width="6" height="6" patternUnits="userSpaceOnUse"><line x1="0" y1="3" x2="6" y2="3" stroke="#ffffff" stroke-width="1" stroke-opacity="0.1"/></pattern>
    ${round ? `<clipPath id="disc"><circle cx="${C}" cy="${C}" r="${C}"/></clipPath>` : ""}</defs>
  ${round ? `<g clip-path="url(#disc)">${art}</g>` : art}`;
}
