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
 * - **The lockup** (starl3xx, 2026-11-27: "9E is amazing", "let's not use the seal in the lockup"):
 *   A's tile standing where the name's first letter would, then EXIGOTCHI. One word. `lockup()`,
 *   at the foot of this file, says how it is drawn and what may move.
 *
 * Both marks are drawn in a 512 box. The letter is Söhne Fett's "L" as its own outline (a plain polygon in
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

// ── the lockup ───────────────────────────────────────────────────────────────────────────────────

/**
 * The name's letters in Söhne Fett, the face of the L inside the mark: each letter's outline in the
 * font's own units (1000 to the em, the baseline at y = 0, up is negative), its advance, its kerning
 * to the next letter, and its left and right edges. Outlines, so the lockup needs no font and never
 * changes with a device's fonts (taken from public/fonts/soehne-fett.ttf).
 */
const NAME: readonly (readonly [ch: string, d: string, adv: number, kern: number, x1: number, x2: number])[] = [
  ["L", "M554 0L49 0L49 -718L245 -718L245 -166L554 -166L554 0Z", 570, 0, 49, 554],
  ["E", "M49 0L49 -718L572 -718L572 -552L241 -552L241 -445L515 -445L515 -283L241 -283L241 -166L572 -166L572 0L49 0Z", 604, -3, 49, 572],
  ["X", "M493 -718L708 -718L476 -366L720 0L499 0L358 -220L218 0L3 0L247 -366L15 -718L235 -718L363 -514L493 -718Z", 723, 0, 3, 720],
  ["I", "M49 -718L245 -718L245 0L49 0L49 -718Z", 294, 0, 49, 245],
  ["G", "M693 0L523 0L523 -57Q501 -28 456 -8Q411 12 350 12L350 12Q254 12 179.5 -34.5Q105 -81 62 -163.5Q19 -246 19 -354L19 -354Q19 -435 44.5 -503.5Q70 -572 116.5 -623Q163 -674 227 -702Q291 -730 368 -730L368 -730Q492 -730 571 -670Q650 -610 683 -508L683 -508L496 -448Q486 -502 453.5 -531Q421 -560 369 -560L369 -560Q301 -560 258 -504.5Q215 -449 215 -357L215 -357Q215 -264 258.5 -208.5Q302 -153 372 -153L372 -153Q422 -153 454.5 -180.5Q487 -208 497 -248L497 -248L359 -248L359 -403L693 -403L693 0Z", 739, 0, 19, 693],
  ["O", "M19 -359L19 -359Q19 -467 63.5 -551Q108 -635 187.5 -682.5Q267 -730 370 -730L370 -730Q474 -730 553.5 -682.5Q633 -635 677.5 -551Q722 -467 722 -359L722 -359Q722 -251 677.5 -167.5Q633 -84 553.5 -36Q474 12 370 12L370 12Q267 12 187.5 -36Q108 -84 63.5 -167.5Q19 -251 19 -359ZM525 -359L525 -359Q525 -453 482 -506.5Q439 -560 370 -560L370 -560Q302 -560 259 -506.5Q216 -453 216 -359L216 -359Q216 -265 259 -211.5Q302 -158 370 -158L370 -158Q439 -158 482 -211.5Q525 -265 525 -359Z", 741, -36, 19, 722],
  ["T", "M634 -718L634 -552L423 -552L423 0L227 0L227 -552L16 -552L16 -718L634 -718Z", 650, -36, 16, 634],
  ["C", "M215 -359L215 -359Q215 -267 256.5 -212.5Q298 -158 363 -158L363 -158Q413 -158 446 -189Q479 -220 489 -273L489 -273L673 -212Q640 -111 562.5 -49.5Q485 12 364 12L364 12Q263 12 185 -36Q107 -84 63 -167.5Q19 -251 19 -359L19 -359Q19 -467 63 -551Q107 -635 185 -682.5Q263 -730 364 -730L364 -730Q485 -730 562.5 -668.5Q640 -607 673 -506L673 -506L489 -445Q479 -498 446 -529Q413 -560 363 -560L363 -560Q298 -560 256.5 -505.5Q215 -451 215 -359Z", 679, 0, 19, 673],
  ["H", "M498 -447L498 -718L694 -718L694 0L498 0L498 -282L245 -282L245 0L49 0L49 -718L245 -718L245 -447L498 -447Z", 743, 0, 49, 694],
  ["I", "M49 -718L245 -718L245 0L49 0L49 -718Z", 294, 0, 49, 245],
];
const NAME_CAP = 718;

/**
 * The lockup's measures, with the name's capitals 100 units tall and their baseline at y = 0 before
 * the drawing is moved into its box. The tile is A's, 172 tall at its ring and centred on the
 * capitals, so its eyes stand above the name; the name starts 15 units after it and is set tight.
 */
/**
 * The lockup in an email's header: its size on the page in points, and the paper it lies on (the
 * card's own, CARD_PAPER). One place for the two that must agree: the picture `npm run brand:art`
 * makes (public/brand/lockup-email.png) and the `<img>` that shows it (lib/notify/email).
 */
export const EMAIL_MARK = { width: 169, height: 36, paper: "#fcf7ea", path: "/brand/lockup-email.png" } as const;

/** How the eyes stand in a still drawing of the lockup. */
export type LockupPose = "open" | "shut" | "left" | "right";
/** How far the pupils slide in a glance, in A's own units (the live lockup's styles slide them the same: globals.css, .lk). */
const GLANCE: Record<"left" | "right", readonly [number, number]> = { left: [-11, 1], right: [10, -1] };

export const LOCKUP = { cap: 100, tile: 172, gap: 15, track: -14, above: 150, below: 46, pad: 6, ink: "#1b1714", paper: "#f4ead2", height: 196 } as const;

/** The name from its `from`-th letter, its first letter's left edge at x. The path, and where it ends. */
function nameFrom(from: number, x: number, fill: string): { markup: string; end: number } {
  const k = LOCKUP.cap / NAME_CAP;
  const letters = NAME.slice(from);
  let at = x;
  let d = "";
  let end = x;
  letters.forEach(([, path, adv, kern, x1, x2], i) => {
    const ox = at - (i === 0 ? x1 * k : 0);
    d += path.replace(/([MLQCZ])([^MLQCZ]*)/g, (_m, c: string, nums: string) =>
      c === "Z" ? "Z" : c + nums.trim().split(/[ ,]+/).map((v, j) => n1(j % 2 === 0 ? ox + Number(v) * k : Number(v) * k)).join(" "),
    );
    at = ox + (adv + kern + LOCKUP.track) * k;
    end = ox + x2 * k;
  });
  return { markup: `<path d="${d}" fill="${fill}"/>`, end };
}

/** Every id a drawing names, and every use of one, given a prefix: two drawings on one page never share a gradient. */
const ownIds = (markup: string, prefix: string) => (prefix ? markup.replace(/id="([\w-]+)"/g, `id="${prefix}$1"`).replace(/url\(#([\w-]+)\)/g, `url(#${prefix}$1)`) : markup);

/**
 * The lockup, as SVG markup in a box `width` by `height` (LOCKUP.height) whose corner is 0 0.
 *
 * - **The tile is the L.** A separate mark beside the full name read as two things ("L LEXIGOTCHI"),
 *   so the mark stands where the first letter would and the name goes on from E.
 * - `tone`: "paper" letters the name in ink, for a light ground; "dark" in paper, for a dark one.
 *   The tile is the same on both.
 * - `oneInk`: outlines only, in the name's colour. **The eyes never invert** (starl3xx, 2026-11-27):
 *   on any ground an eye is a light eyeball with a dark pupil. In dark ink on a light ground the
 *   eyeball is clear and the pupil is ink; in light ink on a dark ground the eyeball is filled and
 *   the pupil is cut out of it. Clear means cut out, never painted in a ground's colour: the one-ink
 *   drawings hold one colour and work on any ground of their kind.
 * - `alive`: the eyes are grouped so a page can move them (components/brand/Lockup): each eye has
 *   its open drawing (.lk-open, its pupil in .lk-pupil) and a shut one (.lk-shut), swapped for the
 *   moment of a blink, as a letter's are. A file is never alive.
 * - `pose`: a STILL drawing with the eyes shut, or glancing left or right, for something drawn
 *   frame by frame with no stylesheet (the share video's corner, on its written score). "open" is
 *   the plain drawing, and the default: nothing about it changes.
 * - `prefix`: put before every id. Give each drawing on a page its own.
 */
export function lockup({ tone = "paper", oneInk = false, alive = false, pose = "open", prefix = "" }: { tone?: "paper" | "dark"; oneInk?: boolean; alive?: boolean; pose?: LockupPose; prefix?: string } = {}): { markup: string; width: number; height: number } {
  const A = LOGO_A;
  const fg = tone === "paper" ? LOCKUP.ink : LOCKUP.paper;
  const s = LOCKUP.tile / A.ring.s;
  const e = A.eyes;
  const eyePairs = ([-1, 1] as const).map((side) => ({ side, ex: e.cx + side * e.dx, p: pupilOf(e.cx + side * e.dx, e.y, e.rx, e.ry, side) }));
  const pupilAndCut = (p: ReturnType<typeof pupilOf>, pupil: string, cut: string) =>
    `<ellipse cx="${n1(p.cx)}" cy="${n1(p.cy)}" rx="${n1(p.rx)}" ry="${n1(p.ry)}" fill="${pupil}"/><path d="${p.cut}" fill="${cut}"/>`;
  let tile: string;
  if (oneInk) {
    // One ink has no ground colour to fill with (it is printed or pressed onto whatever is under it),
    // so what is clear is CUT OUT with a mask, as in the seal (lib/cardArt/seal), never painted.
    const line = 12;
    const box = `maskUnits="userSpaceOnUse" x="0" y="0" width="${LOGO}" height="${LOGO}"`;
    const all = `<rect width="${LOGO}" height="${LOGO}" fill="#fff"/>`;
    // the tile's lines stop at the eyes
    const behind = `<mask id="behind" ${box}>${all}${eyePairs.map(({ ex }) => `<ellipse cx="${ex}" cy="${e.y}" rx="${e.rx + line / 2}" ry="${e.ry + line / 2}" fill="#000"/>`).join("")}</mask>`;
    const eye = ({ side, ex, p }: (typeof eyePairs)[number]) => {
      const id = side < 0 ? "eyel" : "eyer";
      const pupil = `<ellipse cx="${n1(p.cx)}" cy="${n1(p.cy)}" rx="${n1(p.rx)}" ry="${n1(p.ry)}"`;
      return tone === "dark"
        ? // light ink on a dark ground: the eyeball is the ink, the pupil is taken out of it, and its pie cut is put back
          `<mask id="${id}" ${box}>${all}${pupil} fill="#000"/><path d="${p.cut}" fill="#fff"/></mask><ellipse cx="${ex}" cy="${e.y}" rx="${e.rx}" ry="${e.ry}" fill="${fg}" stroke="${fg}" stroke-width="${line}" mask="url(#${id})"/>`
        : // dark ink on a light ground: the eyeball is clear inside its line, the pupil is the ink, and its pie cut is taken out
          `<mask id="${id}" ${box}>${all}<path d="${p.cut}" fill="#000"/></mask><ellipse cx="${ex}" cy="${e.y}" rx="${e.rx}" ry="${e.ry}" fill="none" stroke="${fg}" stroke-width="${line}"/>${pupil} fill="${fg}" mask="url(#${id})"/>`;
    };
    tile =
      `<defs>${behind}</defs><g mask="url(#behind)" fill="none" stroke="${fg}">` +
      `<rect x="${A.ring.x + 9}" y="${A.ring.y + 9}" width="${A.ring.s - 18}" height="${A.ring.s - 18}" rx="${A.ring.r - 9}" stroke-width="18"/>` +
      `<rect x="${A.face.x}" y="${A.face.y}" width="${A.face.s}" height="${A.face.s}" rx="${A.face.r}" stroke-width="9"/></g>` +
      letterL(253.5, 184.2, 143.6, fg) +
      eyePairs.map(eye).join("");
  } else {
    // A's own drawing, without its paper square and its eyes (the only ellipses in it), which are drawn again in groups
    const art = logoA().replace(`<rect width="${LOGO}" height="${LOGO}" fill="${A.paper}"/>`, "");
    const body = art.slice(0, art.indexOf("<ellipse"));
    const a = e.rx * 0.66;
    const eyes = eyePairs
      .map(({ ex, p }) => {
        const ballOf = (fill: string) => `<ellipse cx="${ex}" cy="${e.y}" rx="${e.rx}" ry="${e.ry}" fill="${fill}" stroke="${A.ink}" stroke-width="${e.line}"/>`;
        const open = `<g class="lk-open">${ballOf("#ffffff")}<g class="lk-pupil">${pupilAndCut(p, A.ink, "#ffffff")}</g></g>`;
        // shut, an eye keeps its shape and its lashes come down (the letters' own blink: TileCharacter, Eye).
        // The drawing hides it itself, so it is right with no stylesheet; the page's blink shows it (globals.css, .lk).
        const shut = `<g class="lk-shut" visibility="hidden">${ballOf("#f4f6fa")}<path d="M ${n1(ex - a)} ${n1(e.y + e.ry * 0.12)} Q ${ex} ${n1(e.y + e.ry * 0.58)} ${n1(ex + a)} ${n1(e.y + e.ry * 0.12)}" fill="none" stroke="${A.ink}" stroke-width="${e.line}" stroke-linecap="round"/></g>`;
        if (pose === "shut") return `<g class="lk-eye">${shut.replace(' visibility="hidden"', "")}</g>`;
        if (pose !== "open") return `<g class="lk-eye">${open.replace('<g class="lk-pupil">', `<g class="lk-pupil" transform="translate(${GLANCE[pose].join(" ")})">`)}</g>`;
        return `<g class="lk-eye">${open}${alive ? shut : ""}</g>`;
      })
      .join("");
    tile = body + eyes;
  }
  const name = nameFrom(1, LOCKUP.tile + LOCKUP.gap, fg);
  const placed = `<g transform="translate(${(-A.ring.x * s).toFixed(2)} ${(-LOCKUP.cap / 2 - (A.ring.y + A.ring.s / 2) * s).toFixed(2)}) scale(${s.toFixed(4)})">${tile}</g>`;
  const markup = ownIds(`<g transform="translate(${LOCKUP.pad} ${LOCKUP.above})">${placed}${name.markup}</g>`, prefix);
  return { markup, width: n1(name.end + 2 * LOCKUP.pad), height: LOCKUP.height };
}

/** The lockup as one SVG document: a picture for an `<img>`, a canvas, or a file. */
export function lockupDoc(options: Parameters<typeof lockup>[0] = {}): { svg: string; width: number; height: number } {
  const l = lockup(options);
  return { svg: `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ${l.width} ${l.height}" width="${l.width}" height="${l.height}">${l.markup}</svg>`, width: l.width, height: l.height };
}

/**
 * The lockup as one `<svg>` tag to put straight into a page that is written as a string (the page
 * after linking X, the unsubscribe page): `height` px tall, named for a screen reader.
 */
export function lockupTag(height: number, options: Parameters<typeof lockup>[0] = {}): string {
  const l = lockup(options);
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ${l.width} ${l.height}" width="${Math.round((height * l.width) / l.height)}" height="${height}" role="img" aria-label="Lexigotchi">${l.markup}</svg>`;
}

/** The name alone, for a place too tight for a mark: the same letters, with 12 units of air over and under their capitals. */
export function nameAlone(tone: "paper" | "dark" = "paper"): { markup: string; width: number; height: number } {
  const name = nameFrom(0, 0, tone === "paper" ? LOCKUP.ink : LOCKUP.paper);
  return { markup: `<g transform="translate(${LOCKUP.pad} ${LOCKUP.cap + 2 * LOCKUP.pad})">${name.markup}</g>`, width: n1(name.end + 2 * LOCKUP.pad), height: LOCKUP.cap + 4 * LOCKUP.pad };
}
