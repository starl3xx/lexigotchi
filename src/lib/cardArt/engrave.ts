/**
 * An engraver's kit: the pieces a card's art is drawn from, as SVG markup (strings).
 *
 * A card's art is a still picture (decisions.md #34), so it is built once as one SVG document and
 * shown as an image: a CSS background in the game, an `<img>` on the share picture. No elements in
 * the page, nothing to redraw. Tone comes from line patterns, the way an engraving makes grey out
 * of black, so a whole scene is a few dozen to a few hundred shapes, not the thousand a scene was.
 *
 * Everything is in the card's own space: CARD_W × CARD_H units, the game's 16:9 card.
 *
 * Rules a drawing keeps (tests/card-art.test.ts holds them):
 * - plain shapes, gradients, patterns, clip paths, and `<use>`; no `<text>`, no filters, no CSS,
 *   no scripts, nothing fetched (the server's renderer, resvg, draws it as it stands);
 * - every number is finite and rounded (a `NaN` in a path drops the path without a word);
 * - an id is unique inside its own document (each art is its own document, so two scenes may
 *   both call a pattern "wood");
 * - a row of beads is drawn as circles (`beadRing`, `beadsOnCurve`), never as a dashed stroke with
 *   zero-length dashes and round caps. Browsers and today's resvg draw that as dots, but it is the
 *   kind of corner a renderer gets wrong, and a share picture that lost its beads would say nothing.
 */
export const CARD_W = 1200;
export const CARD_H = 675;

/** One decimal, as a number: paths stay short and never carry a float's long tail. */
export const n1 = (v: number) => Number(v.toFixed(1));

/** A sunburst: `n` wedges from r0 to r1, each `duty` of its slot wide, as ONE path. */
export function sunburst(cx: number, cy: number, r0: number, r1: number, n: number, duty = 0.5): string {
  let d = "";
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2;
    const a1 = ((i + duty) / n) * Math.PI * 2;
    d += `M${n1(cx + r0 * Math.cos(a0))} ${n1(cy + r0 * Math.sin(a0))}L${n1(cx + r1 * Math.cos(a0))} ${n1(cy + r1 * Math.sin(a0))}L${n1(cx + r1 * Math.cos(a1))} ${n1(cy + r1 * Math.sin(a1))}L${n1(cx + r0 * Math.cos(a1))} ${n1(cy + r0 * Math.sin(a1))}Z`;
  }
  return d;
}

/** A rosette, r = a + b·cos(petals·θ): one closed curve. Turned copies of it weave a guilloche. */
export function rosette(cx: number, cy: number, a: number, b: number, petals: number, pts = 360): string {
  let d = "";
  for (let i = 0; i <= pts; i++) {
    const t = (i / pts) * Math.PI * 2;
    const r = a + b * Math.cos(petals * t);
    d += `${i ? "L" : "M"}${n1(cx + r * Math.cos(t))} ${n1(cy + r * Math.sin(t))}`;
  }
  return d + "Z";
}

/** A guilloche band: one rosette, drawn `turns` times, each turned a little (a banknote's weave). */
export function guilloche(id: string, cx: number, cy: number, a: number, b: number, petals: number, turns: number, stroke: string, sw: number, opacity: number): string {
  const step = 360 / petals / turns;
  const uses = Array.from({ length: turns }, (_, k) => `<use href="#${id}" xlink:href="#${id}" transform="rotate(${n1(k * step)} ${cx} ${cy})"/>`).join("");
  return `<defs><path id="${id}" d="${rosette(cx, cy, a, b, petals)}"/></defs><g fill="none" stroke="${stroke}" stroke-width="${sw}" opacity="${opacity}">${uses}</g>`;
}

/** Parallel lines as a fill: an engraver's tone. `gap` between lines, `w` their weight. */
export function hatch(id: string, angle: number, gap: number, color: string, w: number, opacity = 1): string {
  return `<pattern id="${id}" width="${gap}" height="${gap}" patternUnits="userSpaceOnUse" patternTransform="rotate(${angle})"><line x1="0" y1="${gap / 2}" x2="${gap}" y2="${gap / 2}" stroke="${color}" stroke-width="${w}" stroke-opacity="${opacity}"/></pattern>`;
}

/** A ruled rounded rectangle. */
export function rule(x: number, y: number, w: number, h: number, r: number, color: string, sw: number): string {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="none" stroke="${color}" stroke-width="${sw}"/>`;
}

/** One round bead of radius `size` at (x, y), as a piece of a path. */
const bead = (x: number, y: number, size: number) => `M${n1(x - size)} ${n1(y)}a${size} ${size} 0 1 0 ${n1(size * 2)} 0a${size} ${size} 0 1 0 ${n1(-size * 2)} 0Z`;

/** A ring of round beads, `gap` apart along a circle of radius r, as ONE path (the rules above say why not a dashed stroke). */
export function beadRing(cx: number, cy: number, r: number, gap: number, size: number, color: string, opacity = 1): string {
  const count = Math.max(1, Math.round((2 * Math.PI * r) / gap));
  let d = "";
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    d += bead(cx + r * Math.cos(a), cy + r * Math.sin(a), size);
  }
  return `<path d="${d}" fill="${color}" opacity="${opacity}"/>`;
}

/**
 * Round beads `gap` apart along a quadratic curve from (x0, y0) to (x1, y1) with its control point
 * at (qx, qy), one at each end, as ONE path.
 */
export function beadsOnCurve(x0: number, y0: number, qx: number, qy: number, x1: number, y1: number, gap: number, size: number, color: string): string {
  // the curve as short straight pieces, each with the length walked so far
  const STEPS = 80;
  const pts: [number, number, number][] = [];
  let len = 0;
  for (let i = 0; i <= STEPS; i++) {
    const t = i / STEPS;
    const x = (1 - t) * (1 - t) * x0 + 2 * (1 - t) * t * qx + t * t * x1;
    const y = (1 - t) * (1 - t) * y0 + 2 * (1 - t) * t * qy + t * t * y1;
    if (i) len += Math.hypot(x - pts[i - 1][0], y - pts[i - 1][1]);
    pts.push([x, y, len]);
  }
  const count = Math.max(1, Math.round(len / gap));
  let d = "";
  let k = 1;
  for (let i = 0; i <= count; i++) {
    const at = (i / count) * len;
    while (k < STEPS && pts[k][2] < at) k++;
    const [ax, ay, al] = pts[k - 1];
    const [bx, by, bl] = pts[k];
    const f = bl > al ? (at - al) / (bl - al) : 0;
    d += bead(ax + (bx - ax) * f, ay + (by - ay) * f, size);
  }
  return `<path d="${d}" fill="${color}"/>`;
}

/** A small four-point star (a compass point), for a sky or an ornament. */
export function star(x: number, y: number, r: number, color: string, thin = 0.22): string {
  const t = r * thin;
  return `<path d="M${n1(x)} ${n1(y - r)}L${n1(x + t)} ${n1(y - t)}L${n1(x + r)} ${n1(y)}L${n1(x + t)} ${n1(y + t)}L${n1(x)} ${n1(y + r)}L${n1(x - t)} ${n1(y + t)}L${n1(x - r)} ${n1(y)}L${n1(x - t)} ${n1(y - t)}Z" fill="${color}"/>`;
}

/** A small seeded generator, so a scene is the same picture every time, on the server and in the browser. */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A chain border: two waves crossing, a bead in each link. A pattern one link pair long (`len`)
 * and `h` tall; `transform` places it (and turns it, for a card's sides).
 */
export function chain(id: string, len: number, h: number, ink: string, transform: string): string {
  const m = h / 2;
  const q = len / 4;
  const a = h * 0.72;
  const wave = (dir: 1 | -1) => `M0 ${n1(m)}Q${n1(q)} ${n1(m - dir * a)} ${n1(len / 2)} ${n1(m)}T${n1(len)} ${n1(m)}`;
  return `<pattern id="${id}" width="${len.toFixed(3)}" height="${h}" patternUnits="userSpaceOnUse" patternTransform="${transform}"><path d="${wave(1)}${wave(-1)}" fill="none" stroke="${ink}" stroke-width="1.5"/><circle cx="${n1(q)}" cy="${n1(m)}" r="${n1(h * 0.085)}" fill="${ink}"/><circle cx="${n1(3 * q)}" cy="${n1(m)}" r="${n1(h * 0.085)}" fill="${ink}"/></pattern>`;
}

/** The art's markup as one SVG document, the card's size. */
export function svgDoc(inner: string, w = CARD_W, h = CARD_H): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">${inner}</svg>`;
}

/** A document as an address an image can load: a browser's `<img>` or CSS `url()`. */
export function svgDataUri(doc: string): string {
  return `data:image/svg+xml,${encodeURIComponent(doc).replace(/'/g, "%27")}`;
}
