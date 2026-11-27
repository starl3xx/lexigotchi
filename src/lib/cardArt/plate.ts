/**
 * A card's back, as an engraved plate (decisions.md #58, part 2).
 *
 * starl3xx, 2026-11-27: "the cards have *reflections* but they shouldn't be super *shiny* -- the
 * cards are matte finish"; "the 'paper' is like a playing card, and playing card backs are another
 * source of inspo, along with like US dollar bills, especially the engraving and filigree"; and,
 * of three directions drawn for him, "13A dark plate is definitely the way to go".
 *
 * So a back is paper and ink. It is printed solid in a dark ink, and its engraving is in a light
 * ink of the same family. A rarity is told by its inks and by HOW MUCH engraving its plate carries,
 * never by a material: the backs were walnut, satin, brushed foil, polished gold, and a cut gem,
 * with a hot spot and glitter (decisions.md #25, #26), and this replaces them.
 *
 * The engraving, each rank keeping the last one's and adding its own:
 *   0  rules, and a ruled ground (fine even lines that make a tone, as an engraver does)
 *   1  + a border of LACE (braided waves, as on a banknote's edge), a lathe medallion in each corner
 *   2  + LATHE WORK around the seal: one wavy ring turned many times, so its copies weave
 *   3  + a second ring, and FILIGREE in the border's corners, both in a second ink
 *   4  + a third ring, so the rings weave a moiré; and the ink changes along the card
 *
 * Rank 4's changing ink is a banknote's "rainbow printing": one plate, the ink blended across it.
 * It is printed, so it never moves.
 *
 * The drawing keeps the engraving kit's rules (./engrave: plain shapes, gradients, patterns, clip
 * paths, and `<use>`; no text, no filter, nothing fetched; every number finite and rounded), so the
 * game shows it as a background picture and the server's renderer draws it as it stands.
 *
 * A LINE IS NEVER FINER THAN ABOUT A PIXEL where it is shown. The first ruled ground was 7 units
 * apart at weight 1, and in the share video it smeared into streaks that read as brushed metal:
 * the very thing this replaces. 11 apart at 1.5 holds. Keep that floor when changing a weight.
 */
import { CARD_H, CARD_W, n1, rosette } from "./engrave";

/** How much engraving a plate carries: Common's 0 to Mythic's 4. */
export type PlateRank = 0 | 1 | 2 | 3 | 4;

export interface PlateInks {
  /** The dark ink the back is printed solid in. */
  ground: string;
  /** The light ink of its engraving. */
  line: string;
  /** A second light ink, from rank 3: the filigree, the second ring, and (rank 4) the far end of the blend. */
  second: string;
}

/**
 * Where the game's seal sits on a back, in card units: its centre and its width. The lathe work is
 * drawn around it, so the styles (globals.css, .cb-seal) and the server's picture of a back
 * (app/s/[text]/back) place the seal by these (tests/matte-cards.test.ts holds the three equal).
 */
export const PLATE_SEAL = { cx: 868, cy: 337.5, d: 400 } as const;

/**
 * The plate's border, in card units from the card's edge: the edge rule, the band the lace runs in,
 * and where the field inside the border begins. The lettering is set inside the field.
 */
export const PLATE_BORDER = { edge: 16, lace: [25, 55], field: 63 } as const;

/** How strong the engraving is over its ground, of 1: the lines, and the lathe work the lettering lies over. */
const SOFT = 0.62;
const MEDAL = 0.5;

/** A braid of sine waves along a straight run: a banknote's lace. `strands` waves, evenly out of step. */
function lace(x0: number, y0: number, x1: number, y1: number, amp: number, waves: number, strands: number): string {
  const len = Math.hypot(x1 - x0, y1 - y0);
  const ux = (x1 - x0) / len, uy = (y1 - y0) / len;
  const px = -uy, py = ux;
  const steps = Math.round(waves * 16);
  let d = "";
  for (let s = 0; s < strands; s++) {
    const phase = (s / strands) * Math.PI * 2;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const a = Math.sin(t * waves * Math.PI * 2 + phase) * amp;
      d += `${i ? "L" : "M"}${n1(x0 + ux * len * t + px * a)} ${n1(y0 + uy * len * t + py * a)}`;
    }
  }
  return d;
}

/** A spiral from radius r0 to r1 over `turns`, starting at angle a0 (radians), as a path piece. */
function spiral(cx: number, cy: number, r0: number, r1: number, turns: number, a0: number, dir: 1 | -1 = 1): string {
  const steps = Math.round(turns * 28);
  let d = "";
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const r = r0 + (r1 - r0) * t;
    const a = a0 + dir * t * turns * Math.PI * 2;
    d += `${i ? "L" : "M"}${n1(cx + r * Math.cos(a))} ${n1(cy + r * Math.sin(a))}`;
  }
  return d;
}

/** A leaf: a teardrop from (x, y), `len` long, pointing at angle a. */
function leaf(x: number, y: number, len: number, a: number, fat = 0.34): string {
  const c = Math.cos(a), s = Math.sin(a);
  const tx = x + c * len, ty = y + s * len;
  const mx = x + c * len * 0.45, my = y + s * len * 0.45;
  const w = len * fat;
  return `M${n1(x)} ${n1(y)}Q${n1(mx - s * w)} ${n1(my + c * w)} ${n1(tx)} ${n1(ty)}Q${n1(mx + s * w)} ${n1(my - c * w)} ${n1(x)} ${n1(y)}Z`;
}

/** Filigree for one corner: vines that leave the corner along each edge and curl home, with leaves. Drawn for the top left with its corner at (0, 0), `size` units along each edge; turned for the other corners. */
function filigree(size: number): { stroke: string; fill: string } {
  const k = size / 120;
  const P = (x: number, y: number) => `${n1(x * k)} ${n1(y * k)}`;
  const vine = (flip: boolean) => {
    const q = (x: number, y: number) => (flip ? P(y, x) : P(x, y));
    return `M${q(10, 10)}C${q(34, 6)} ${q(62, 8)} ${q(84, 20)}` + (flip ? spiral(34 * k, 100 * k, 16 * k, 3 * k, 1.35, -Math.PI / 2 - 0.5, -1).replace(/^M[^L]+/, "") : spiral(100 * k, 34 * k, 16 * k, 3 * k, 1.35, Math.PI + 0.5, 1).replace(/^M[^L]+/, ""));
  };
  const curl = (flip: boolean) => (flip ? spiral(24 * k, 52 * k, 11 * k, 2 * k, 1.2, -Math.PI / 2, -1) : spiral(52 * k, 24 * k, 11 * k, 2 * k, 1.2, Math.PI, 1));
  const bud = (flip: boolean) => (flip ? spiral(52 * k, 112 * k, 7 * k, 1.5 * k, 1.1, 0, 1) : spiral(112 * k, 52 * k, 7 * k, 1.5 * k, 1.1, Math.PI / 2, -1));
  const stroke = vine(false) + vine(true) + curl(false) + curl(true) + bud(false) + bud(true);
  const fill = leaf(12 * k, 12 * k, 34 * k, Math.PI / 4, 0.3) + leaf(40 * k, 9 * k, 18 * k, -0.5) + leaf(9 * k, 40 * k, 18 * k, Math.PI / 2 + 0.5) + leaf(70 * k, 14 * k, 15 * k, 0.9) + leaf(14 * k, 70 * k, 15 * k, Math.PI / 2 - 0.9);
  return { stroke, fill };
}

/**
 * A back's plate: its ground and its engraving, as SVG markup for svgDoc (the card's size,
 * CARD_W × CARD_H).
 *
 * - `rank`: how much engraving (above).
 * - `inks`: the plate's own. A rarity's are in components/cards/material; a collab set's are its
 *   two colors (lib/collabLook). The drawing never knows which.
 * - `blend`: the line ink changes along the card, from `line` to `second` and back (rank 4's
 *   rainbow printing). Without it every line is `line`.
 */
export function backPlate(rank: PlateRank, inks: PlateInks, blend = false): string {
  const W = CARD_W, H = CARD_H;
  const A = inks.line, B = inks.second;
  const defs: string[] = [];
  const out: string[] = [`<rect width="${W}" height="${H}" fill="${inks.ground}"/>`];
  let stroke = A;
  if (blend) {
    defs.push(`<linearGradient id="iris" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="${W}" y2="${H}"><stop offset="0" stop-color="${A}"/><stop offset="0.5" stop-color="${B}"/><stop offset="1" stop-color="${A}"/></linearGradient>`);
    stroke = "url(#iris)";
  }
  const o = PLATE_BORDER.edge, [lo, li] = PLATE_BORDER.lace, inner = PLATE_BORDER.field;
  const turn = (ref: string, n: number, span: number, cx: number, cy: number) => Array.from({ length: n }, (_, t) => `<use href="#${ref}" xlink:href="#${ref}" transform="rotate(${n1((t * span) / n)} ${cx} ${cy})"/>`).join("");
  // the ruled ground: an engraver's tone, fine and even (and never finer: the note at the top says why)
  defs.push(`<pattern id="rule" width="11" height="11" patternUnits="userSpaceOnUse"><line x1="0" y1="5.5" x2="11" y2="5.5" stroke="${A}" stroke-width="1.5"/></pattern>`, `<clipPath id="field"><rect x="${inner}" y="${inner}" width="${W - 2 * inner}" height="${H - 2 * inner}" rx="8"/></clipPath>`);
  out.push(`<rect x="${inner}" y="${inner}" width="${W - 2 * inner}" height="${H - 2 * inner}" rx="8" fill="url(#rule)" opacity="${n1(0.3 * SOFT * 10) / 10}"/>`);
  // the border: rules, and from rank 1 a band of lace between them
  out.push(`<rect x="${o}" y="${o}" width="${W - 2 * o}" height="${H - 2 * o}" rx="18" fill="none" stroke="${stroke}" stroke-width="3.2"/><rect x="${o + 6}" y="${o + 6}" width="${W - 2 * o - 12}" height="${H - 2 * o - 12}" rx="13" fill="none" stroke="${stroke}" stroke-width="0.9"/>`);
  out.push(`<rect x="${inner - 6}" y="${inner - 6}" width="${W - 2 * inner + 12}" height="${H - 2 * inner + 12}" rx="11" fill="none" stroke="${rank >= 3 ? B : stroke}" stroke-width="0.9"/><rect x="${inner}" y="${inner}" width="${W - 2 * inner}" height="${H - 2 * inner}" rx="8" fill="none" stroke="${stroke}" stroke-width="2"/>`);
  if (rank >= 1) {
    const mid = (lo + li) / 2, amp = (li - lo) / 2 - 2;
    // the lace stops short of a corner that carries filigree (rank 3 and up); below that a medallion closes it
    const gap = rank >= 3 ? 104 : 22;
    const x0 = li + gap, x1 = W - li - gap, y0 = li + gap, y1 = H - li - gap;
    // two braids of different pitch cross, as on a note's border
    const fine = lace(x0, mid, x1, mid, amp, rank >= 3 ? 26 : 30, 3) + lace(x0, H - mid, x1, H - mid, amp, rank >= 3 ? 26 : 30, 3) + lace(mid, y0, mid, y1, amp, rank >= 3 ? 11 : 15, 3) + lace(W - mid, y0, W - mid, y1, amp, rank >= 3 ? 11 : 15, 3);
    const slow = lace(x0, mid, x1, mid, amp, rank >= 3 ? 9 : 10, 2) + lace(x0, H - mid, x1, H - mid, amp, rank >= 3 ? 9 : 10, 2) + lace(mid, y0, mid, y1, amp, rank >= 3 ? 4 : 5, 2) + lace(W - mid, y0, W - mid, y1, amp, rank >= 3 ? 4 : 5, 2);
    out.push(`<path d="${fine}" fill="none" stroke="${stroke}" stroke-width="1.15" opacity="${SOFT}"/><path d="${slow}" fill="none" stroke="${stroke}" stroke-width="1.5" opacity="${SOFT}"/>`);
    if (rank < 3)
      [[mid + 2, mid + 2], [W - mid - 2, mid + 2], [mid + 2, H - mid - 2], [W - mid - 2, H - mid - 2]].forEach(([x, y], n) => {
        defs.push(`<path id="c${n}" d="${rosette(x, y, 15, 5.5, 8, 120)}"/>`);
        out.push(`<circle cx="${x}" cy="${y}" r="23.5" fill="${inks.ground}" stroke="${stroke}" stroke-width="1.6"/><g fill="none" stroke="${stroke}" stroke-width="0.9">${turn(`c${n}`, 4, 45, x, y)}</g><circle cx="${x}" cy="${y}" r="4" fill="${A}"/>`);
      });
  } else {
    out.push(`<rect x="${(lo + li) / 2}" y="${(lo + li) / 2}" width="${W - lo - li}" height="${H - lo - li}" rx="12" fill="none" stroke="${stroke}" stroke-width="0.9"/>`);
  }
  if (rank >= 2) {
    // lathe work around the seal: one rosette turned many times, ring inside ring
    const { cx, cy } = PLATE_SEAL;
    const ring = (r: number, w: number) => `<circle cx="${cx}" cy="${cy}" r="${r}" stroke-width="${w}"/>`;
    defs.push(`<path id="w" d="${rosette(cx, cy, 222, 12, 36, 900)}"/>`);
    let medal = `<g stroke="${stroke}" stroke-width="1">${turn("w", 5, 10, cx, cy)}${ring(236, 1.8)}${ring(207, 1.4)}</g>`;
    if (rank >= 3) {
      defs.push(`<path id="w2" d="${rosette(cx, cy, 190, 12, 24, 720)}"/>`);
      medal += `<g stroke="${rank === 3 ? B : stroke}" stroke-width="0.9">${turn("w2", 6, 15, cx, cy)}${ring(176, 1.2)}</g>`;
    }
    if (rank >= 4) {
      // a third, finer turn, so the rings weave a moiré
      defs.push(`<path id="w3" d="${rosette(cx, cy, 160, 11, 40, 900)}"/>`);
      medal += `<g stroke="${stroke}" stroke-width="0.8">${turn("w3", 4, 9, cx, cy)}${ring(147, 1)}</g>`;
    }
    out.push(`<g clip-path="url(#field)" fill="none" opacity="${MEDAL}">${medal}</g>`);
  }
  if (rank >= 3) {
    const fl = filigree(96);
    const c = lo - 4;
    const at: [number, number, number, number][] = [[c, c, 1, 1], [W - c, c, -1, 1], [c, H - c, 1, -1], [W - c, H - c, -1, -1]];
    out.push(at.map(([x, y, sx, sy]) => `<g transform="translate(${x} ${y}) scale(${sx} ${sy})"><path d="${fl.stroke}" fill="none" stroke="${B}" stroke-width="1.7" stroke-linecap="round"/><path d="${fl.fill}" fill="${B}"/></g>`).join(""));
  }
  return `<defs>${defs.join("")}</defs>${out.join("")}`;
}
