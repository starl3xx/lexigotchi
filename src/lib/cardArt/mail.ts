/**
 * The mail: a pack of letters comes in an envelope (decisions.md #49).
 *
 * Drawn with the cards' engraving kit (./engrave), because what is around a letter is drawn like
 * the cards (#48): tone from line patterns, one ink, and candy for spending. Each piece that moves
 * is a still picture of its own (an SVG document, shown as an image), so the page moves whole
 * pictures and never a shape inside one. That is the letters' own rule: a shape moving inside a
 * drawing makes WebKit redraw the whole drawing each frame.
 *
 * The pieces, back to front:
 *   back      the inside of the envelope: what shows above the torn edge, behind the letters
 *   front     the face, from the tear line down: the address rules, the window, the contents box
 *   strip     the tear strip along the top, with its pull tab
 *   stamp     the seal (logo B) in a perforated frame: it goes on when the pack is paid
 *   postmark  a ring for the mail's number, and the waves that cancel the stamp
 *   eyes      one pair of the letters' eyes as they show in the dark of the window
 *   sparkles  behind the rarest letter of a pack: the Mint's own mark (rays stay a raise's)
 *
 * Every function returns markup for `svgDoc(markup, w, h)`. The rules a drawing keeps are the
 * cards' (tests/mail-art.test.ts holds them): plain shapes, no text (the page letters the envelope),
 * no filters, nothing fetched, every number finite, every id unique in its own document.
 */
import { beadRing, hatch, n1, rng, rule, star, svgDataUri, svgDoc } from "./engrave";
import { LOGO, logoB } from "./logo";
import { pupilOf } from "@/components/game/tileShapes";

const INK = "#2a1e1a"; // the letters' own outline
const LINE = "#4a3a2c"; // the engraving line: the Common card's ink
const PAPER = "#fcf7ea"; // the card's own paper
const SHADE = "#eadfc3"; // the inside of the envelope
const DARK = "#221815"; // where the letters wait
const CANDY = "#d8463f"; // spend
const GOLD = "#f0a617";
const GOLD_DEEP = "#b07d20";
const POSTMARK_INK = "#3a3734";

/** The spend stripe: candy lines on paper, the tape a pack is opened by. */
const tape = (id: string) => hatch(id, 45, 20, CANDY, 9, 0.92);

/** The envelope's own box, and how far down its face the tear line runs. */
export const ENV = { w: 1020, h: 636, tear: 78 } as const;
/** The window's box for a piece of mail holding `count` letters. */
export const envWindow = (count: number) => (count === 1 ? { x: 86, y: 372, w: 196, h: 176 } : { x: 86, y: 372, w: 600, h: 176 });
/** The contents box, under the stamp: the page letters "Contents:" over "5 letters" in it. */
export const CONTENTS = { x: 738, y: 352, w: 228, h: 128 } as const;
/** Where the stamp goes: a dashed place for it until the pack is paid. */
export const STAMP_PLACE = { x: ENV.w - 266, y: ENV.tear + 62, s: 196 } as const;

/** The inside: what shows above the torn edge, behind the letters as they climb out. */
export function envBack(): string {
  const { w, h, tear } = ENV;
  return `<defs>${hatch("v", 90, 11, LINE, 1.6, 0.3)}${hatch("d", 60, 9, LINE, 1.8, 0.34)}</defs>
    <rect x="5" y="5" width="${w - 10}" height="${h - 10}" rx="30" fill="${SHADE}" stroke="${INK}" stroke-width="9"/>
    <rect x="10" y="10" width="${w - 20}" height="150" rx="24" fill="url(#v)"/>
    <rect x="10" y="${tear - 26}" width="${w - 20}" height="60" fill="url(#d)"/>`;
}

/** The front, below the tear line: its torn top edge, the address rules, the window, the contents box. */
export function envFront(count: number): string {
  const { w, h, tear } = ENV;
  const r = rng(7);
  let edge = `M5 ${tear + 4}`;
  for (let x = 22; x < w - 10; x += 17) edge += `L${x} ${n1(tear + (r() - 0.5) * 9)}`;
  const shape = `${edge}L${w - 5} ${tear + 4}L${w - 5} ${h - 35}Q${w - 5} ${h - 5} ${w - 35} ${h - 5}L35 ${h - 5}Q5 ${h - 5} 5 ${h - 35}Z`;
  const win = envWindow(count);
  const c = CONTENTS;
  const s = STAMP_PLACE;
  return `<defs>${hatch("f", 0, 9, LINE, 1.2, 0.17)}${hatch("b", 45, 8, LINE, 1.5, 0.3)}${hatch("g", 135, 16, "#ffffff", 2.4, 0.07)}
      <clipPath id="c"><path d="${shape}"/></clipPath></defs>
    <path d="${shape}" fill="${PAPER}"/>
    <g clip-path="url(#c)"><rect width="${w}" height="${h}" fill="url(#f)"/><rect y="${h - 74}" width="${w}" height="74" fill="url(#b)"/><rect x="${w - 70}" y="0" width="70" height="${h}" fill="url(#b)" opacity="0.55"/></g>
    <path d="${shape}" fill="none" stroke="${INK}" stroke-width="9" stroke-linejoin="round"/>
    ${rule(34, tear + 30, w - 68, h - tear - 64, 16, LINE, 2.4)}${rule(44, tear + 40, w - 88, h - tear - 84, 10, LINE, 1.1)}
    <g stroke="${LINE}" stroke-linecap="round" opacity="0.55"><path d="M90 228H560M90 286H500" stroke-width="3"/><path d="M90 234H560M90 292H500" stroke-width="1"/></g>
    <rect x="${s.x}" y="${s.y}" width="${s.s}" height="${s.s}" rx="8" fill="none" stroke="${LINE}" stroke-width="2.4" stroke-dasharray="9 8" opacity="0.5"/>
    <rect x="${c.x}" y="${c.y}" width="${c.w}" height="${c.h}" rx="12" fill="${PAPER}" opacity="0.7"/>
    ${rule(c.x, c.y, c.w, c.h, 12, LINE, 2.6)}${rule(c.x + 8, c.y + 8, c.w - 16, c.h - 16, 6, LINE, 1)}
    <rect x="${win.x}" y="${win.y}" width="${win.w}" height="${win.h}" rx="30" fill="${DARK}"/>
    <rect x="${win.x}" y="${win.y}" width="${win.w}" height="${win.h}" rx="30" fill="url(#g)"/>
    <rect x="${win.x}" y="${win.y}" width="${win.w}" height="${win.h}" rx="30" fill="none" stroke="${INK}" stroke-width="8"/>
    ${rule(win.x - 13, win.y - 13, win.w + 26, win.h + 26, 40, LINE, 2)}`;
}

/** The tear strip: the top of the face, a candy tape over a line of perforation, a pull tab. */
export const STRIP = { w: ENV.w, h: 92 } as const;
export function envStrip(): string {
  const { w, h } = STRIP;
  let perf = "";
  for (let x = 20; x < w - 12; x += 15) perf += `M${n1(x - 2.6)} ${h - 9}a2.6 2.6 0 1 0 5.2 0a2.6 2.6 0 1 0 -5.2 0Z`;
  const chev = (x: number) => `<path d="M${x} 33L${x + 14} 46L${x} 59" fill="none" stroke="${PAPER}" stroke-width="6.5" stroke-linecap="round" stroke-linejoin="round"/>`;
  return `<defs>${tape("t")}</defs>
    <path d="M5 ${h}V35Q5 5 35 5H${w - 35}Q${w - 5} 5 ${w - 5} 35V${h}Z" fill="${PAPER}" stroke="${INK}" stroke-width="9" stroke-linejoin="round"/>
    <rect x="22" y="24" width="${w - 44}" height="44" rx="6" fill="url(#t)"/>
    <rect x="22" y="24" width="${w - 44}" height="44" rx="6" fill="none" stroke="${INK}" stroke-width="2.6"/>
    <rect x="22" y="19" width="118" height="54" rx="12" fill="${INK}"/>${chev(52)}${chev(76)}${chev(100)}
    <path d="${perf}" fill="${INK}" opacity="0.7"/>`;
}

/** The stamp: the seal (logo B) in a perforated frame. What is inside is said under it, in the contents box. */
export const STAMP = { w: 216, h: 216 } as const;
export function stampArt(): string {
  const { w, h } = STAMP;
  let holes = "";
  for (let x = 12; x <= w - 12; x += 19.2) holes += `<circle cx="${n1(x)}" cy="0" r="6.4"/><circle cx="${n1(x)}" cy="${h}" r="6.4"/>`;
  for (let y = 12; y <= h - 12; y += 19.2) holes += `<circle cx="0" cy="${n1(y)}" r="6.4"/><circle cx="${w}" cy="${n1(y)}" r="6.4"/>`;
  return `<defs><mask id="m" maskUnits="userSpaceOnUse" x="0" y="0" width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="#fff"/><g fill="#000">${holes}</g></mask></defs>
    <g mask="url(#m)"><rect width="${w}" height="${h}" fill="#fffdf5"/><rect x="1.5" y="1.5" width="${w - 3}" height="${h - 3}" fill="none" stroke="${INK}" stroke-width="3" opacity="0.5"/></g>
    <svg x="20" y="20" width="176" height="176" viewBox="0 0 ${LOGO} ${LOGO}">${logoB()}</svg>
    ${rule(20, 20, 176, 176, 0, INK, 3)}`;
}

/** The postmark: a ring for the mail's number, and the waves that cancel the stamp. */
export const POSTMARK = { w: 360, h: 200, ring: { cx: 100, cy: 100, r: 60 } } as const;
export function postmarkArt(): string {
  let waves = "";
  for (let k = 0; k < 5; k++) {
    waves += `M188 ${52 + k * 24}`;
    for (let x = 188; x < 356; x += 28) waves += "q7 -9 14 0t14 0";
  }
  return `<g fill="none" stroke="${POSTMARK_INK}" opacity="0.86"><circle cx="100" cy="100" r="92" stroke-width="5.5"/><circle cx="100" cy="100" r="83" stroke-width="1.8"/><circle cx="100" cy="100" r="60" stroke-width="2.2"/><path d="${waves}" stroke-width="4" stroke-linecap="round"/></g>
    ${beadRing(100, 100, 71.5, 9.4, 2.1, POSTMARK_INK, 0.8)}`;
}

/** One pair of the letters' eyes, as they show in the dark: the whites and the pupils, nothing else. */
export const EYES = { w: 110, h: 60 } as const;
export type Gaze = "you" | "left" | "right" | "up" | "shut";
export function eyesArt(gaze: Gaze): string {
  const [rx, ry, dx, cy] = [19, 21.5, 23, 30];
  const cx = EYES.w / 2;
  if (gaze === "shut") {
    const lid = (ex: number) => `<path d="M${ex - rx + 3} ${cy + 2}Q${ex} ${cy + 13} ${ex + rx - 3} ${cy + 2}" fill="none" stroke="#f3e9d2" stroke-width="4.5" stroke-linecap="round"/>`;
    return lid(cx - dx) + lid(cx + dx);
  }
  const shift = { you: [0, 0], left: [-6, 1], right: [6, 1], up: [0, -8] }[gaze];
  const eye = (side: -1 | 1) => {
    const ex = cx + side * dx;
    // the letters' own pupil (tileShapes): one big oval set toward the nose, with its pie cut
    const p = pupilOf(ex + shift[0], cy + shift[1], rx, ry, side);
    return `<ellipse cx="${ex}" cy="${cy}" rx="${rx}" ry="${ry}" fill="#ffffff"/><ellipse cx="${n1(p.cx)}" cy="${n1(p.cy)}" rx="${n1(p.rx)}" ry="${n1(p.ry)}" fill="${INK}"/><path d="${p.cut}" fill="#ffffff"/>`;
  };
  return eye(-1) + eye(1);
}

/**
 * A rare pull's sparkles, behind the letter, in the letter's own box (240 × 340): two sets, so they
 * can twinkle in turn. Stars and fine ticks in gold ink, engraved like everything off the letter.
 */
export const SPARKLES = { w: 240, h: 340 } as const;
export function sparklesArt(set: 0 | 1): string {
  const [cx, cy] = [120, 172];
  const spots = set === 0 ? [[-98, -96, 15], [104, -52, 11], [-110, 40, 10], [92, 86, 13]] : [[-62, -122, 10], [112, -112, 14], [118, 22, 9], [-104, -22, 12], [-84, 104, 9]];
  let ticks = "";
  for (let i = 0; i < 28; i++) {
    const a = ((i + (set ? 0.5 : 0)) / 28) * Math.PI * 2;
    const [r0, r1] = [96, i % 2 ? 106 : 114];
    ticks += `M${n1(cx + r0 * Math.cos(a))} ${n1(cy + r0 * 1.02 * Math.sin(a))}L${n1(cx + r1 * Math.cos(a))} ${n1(cy + r1 * 1.02 * Math.sin(a))}`;
  }
  const stars = spots.map(([x, y, r]) => star(cx + x, cy + y, r + 2.2, GOLD_DEEP, 0.26) + star(cx + x, cy + y, r, GOLD, 0.22)).join("");
  return `<path d="${ticks}" fill="none" stroke="${GOLD_DEEP}" stroke-width="1.6" stroke-linecap="round" opacity="0.75"/>${stars}`;
}

/** Every piece by name, for the tests and for anything that wants them all. */
export function mailArt(): { name: string; markup: string; w: number; h: number }[] {
  return [
    { name: "the envelope's inside", markup: envBack(), w: ENV.w, h: ENV.h },
    { name: "the envelope's face, five letters", markup: envFront(5), w: ENV.w, h: ENV.h },
    { name: "the envelope's face, one letter", markup: envFront(1), w: ENV.w, h: ENV.h },
    { name: "the tear strip", markup: envStrip(), w: STRIP.w, h: STRIP.h },
    { name: "the stamp", markup: stampArt(), w: STAMP.w, h: STAMP.h },
    { name: "the postmark", markup: postmarkArt(), w: POSTMARK.w, h: POSTMARK.h },
    ...(["you", "left", "right", "up", "shut"] as const).map((g) => ({ name: `eyes, ${g}`, markup: eyesArt(g), w: EYES.w, h: EYES.h })),
    { name: "sparkles, first set", markup: sparklesArt(0), w: SPARKLES.w, h: SPARKLES.h },
    { name: "sparkles, second set", markup: sparklesArt(1), w: SPARKLES.w, h: SPARKLES.h },
  ];
}

/** A piece as an address an image can load. */
export const mailUri = (markup: string, w: number, h: number): string => svgDataUri(svgDoc(markup, w, h));
