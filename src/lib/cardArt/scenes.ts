/**
 * The card scenes, as still pictures (./engrave says how; decisions.md #34), and the frame every
 * card wears. Each scene returns the art for the card's window; the frame is its own picture, drawn
 * over it.
 *
 * - **The letters stand with their feet on y = FEET_Y,** or, where a scene's ground is curved
 *   (GROUND), on the curve itself.
 * - **Every floor is a surface seen from a little above,** never a flat line: the letters stand ON
 *   something (starl3xx, 2026-11-25).
 * - **Nothing in a scene moves.** The only motion a card has is its own light (the card's front
 *   says how), so a scene is drawn once.
 */
import type { Tier } from "../economy";
import type { SceneId } from "../scenes";
import { tierMarkPaths } from "../tierMark";
import { CARD_H as H, CARD_W as W, beadRing, beadsOnCurve, chain, guilloche, hatch, n1, rng, rule, star, sunburst } from "./engrave";
import { CARD_LOOKS, CARD_PAPER, FEET_Y, GRAPHITE, NEUTRAL, WINDOW as WIN, type CardLook } from "./looks";

const X0 = WIN.x;
const X1 = WIN.x + WIN.w;
const Y0 = WIN.y;
const Y1 = WIN.y + WIN.h;
const clip = (id: string) => `<clipPath id="${id}"><rect x="${WIN.x}" y="${WIN.y}" width="${WIN.w}" height="${WIN.h}" rx="${WIN.r}"/></clipPath>`;

/**
 * Stock: no place at all, and nearly no colour. A grey engraving (a sunburst, a woven medallion)
 * over a tiled floor drawn in perspective, with the rarity as an overtone: a wash of its tint
 * behind the word, and its ink on the medallion's beads and the line where wall meets floor.
 */
export function stock(L: CardLook): string {
  const cx = W / 2;
  const cy = 296;
  const yh = FEET_Y - 64; // where the wall meets the floor (the floor's horizon)
  const g = GRAPHITE;
  // The floor: tiles in one-point perspective. Columns fan out from the vanishing point, so a
  // fixed number of them covers the card's width only near the front; each row takes as many as
  // reach both edges at its own depth (starl3xx, 2026-11-25: the checks ended at the word's ends).
  const TILE = 128;
  const colAt = (k: number, y: number) => cx + (k * TILE * (y - yh)) / (Y1 - yh);
  const reach = (y: number) => Math.min(90, Math.ceil(((WIN.w / 2) * (Y1 - yh)) / (TILE * (y - yh))) + 1);
  const rows = Array.from({ length: 13 }, (_, j) => yh + (Y1 + 34 - yh) / (1 + j * 0.52));
  let checks = "";
  for (let j = 0; j < rows.length - 1; j++) {
    const ya = rows[j];
    const yb = rows[j + 1];
    const n = reach(yb);
    for (let k = -n; k < n; k++) {
      if ((k + j + 1000) % 2) continue;
      checks += `M${n1(colAt(k, ya))} ${n1(ya)}L${n1(colAt(k + 1, ya))} ${n1(ya)}L${n1(colAt(k + 1, yb))} ${n1(yb)}L${n1(colAt(k, yb))} ${n1(yb)}Z`;
    }
  }
  const far = rows[rows.length - 1];
  let lines = "";
  const nFar = reach(far);
  for (let k = -nFar; k <= nFar; k++) lines += `M${n1(colAt(k, far))} ${n1(far)}L${n1(colAt(k, Y1 + 34))} ${n1(Y1 + 34)}`;
  for (const y of rows) lines += `M${X0} ${n1(y)}H${X1}`;
  return `<defs>${clip("w")}${hatch("far", 0, 4, g, 1, 0.26)}
    <radialGradient id="glow" cx="0.5" cy="0.42" r="0.55"><stop offset="0" stop-color="#ffffff" stop-opacity="0.9"/><stop offset="0.6" stop-color="#ffffff" stop-opacity="0"/></radialGradient>
    <radialGradient id="tint" cx="0.5" cy="0.56" r="0.72"><stop offset="0" stop-color="${L.tint}" stop-opacity="${n1(0.28 * L.wash * 100) / 100}"/><stop offset="0.55" stop-color="${L.tint}" stop-opacity="${n1(0.11 * L.wash * 100) / 100}"/><stop offset="1" stop-color="${L.tint}" stop-opacity="${n1(0.03 * L.wash * 100) / 100}"/></radialGradient>
    <linearGradient id="deep" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${g}" stop-opacity="0.16"/><stop offset="0.5" stop-color="${g}" stop-opacity="0"/></linearGradient>
    <linearGradient id="haze" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${NEUTRAL.floor}" stop-opacity="0.9"/><stop offset="0.4" stop-color="${NEUTRAL.floor}" stop-opacity="0"/></linearGradient></defs>
  <g clip-path="url(#w)">
    <rect x="${X0}" y="${Y0}" width="${WIN.w}" height="${WIN.h}" fill="${NEUTRAL.field}"/>
    <path d="${sunburst(cx, cy, 250, 900, 48, 0.5)}" fill="${g}" opacity="0.055"/>
    <rect x="${X0}" y="${Y0}" width="${WIN.w}" height="${yh - Y0}" fill="url(#glow)"/>
    ${guilloche("r1", cx, cy, 194, 26, 18, 6, g, 1.1, 0.3)}
    ${guilloche("r2", cx, cy, 136, 32, 12, 5, g, 1.1, 0.22)}
    <circle cx="${cx}" cy="${cy}" r="232" fill="none" stroke="${g}" stroke-width="2" opacity="0.5"/>
    ${beadRing(cx, cy, 241, 10.1, 1.8, L.ink, 0.85)}
    <circle cx="${cx}" cy="${cy}" r="250" fill="none" stroke="${g}" stroke-width="1" opacity="0.5"/>
    <!-- the floor: far tiles blur into a ruled tone, near tiles are drawn one by one -->
    <rect x="${X0}" y="${yh}" width="${WIN.w}" height="${Y1 - yh}" fill="${NEUTRAL.floor}"/>
    <rect x="${X0}" y="${yh}" width="${WIN.w}" height="${n1(far - yh)}" fill="url(#far)"/>
    <path d="${checks}" fill="${g}" opacity="0.065"/>
    <path d="${lines}" fill="none" stroke="${g}" stroke-width="1" opacity="0.2"/>
    <!-- distance: the far tiles fade into the floor's own tone -->
    <rect x="${X0}" y="${yh}" width="${WIN.w}" height="${Y1 - yh}" fill="url(#haze)"/>
    <rect x="${X0}" y="${yh}" width="${WIN.w}" height="${Y1 - yh}" fill="url(#deep)"/>
    <rect x="${X0}" y="${Y0}" width="${WIN.w}" height="${WIN.h}" fill="url(#tint)"/>
    <line x1="${X0}" y1="${yh}" x2="${X1}" y2="${yh}" stroke="${L.ink}" stroke-width="3.2"/>
    <line x1="${X0}" y1="${yh + 6}" x2="${X1}" y2="${yh + 6}" stroke="${g}" stroke-width="1" opacity="0.6"/>
  </g>`;
}


/** The Stage, engraved and quiet: a hatched backdrop, a swagged valance, tied curtains, boards
 *  running to the back, footlights. The colours are a print's, not a poster's. */
export function stage(): string {
  const ink = "#33211f";
  const red = "#a9564f";
  const redDeep = "#8a4742";
  const gold = "#c9a65c";
  const back = "#4c6072";
  let swags = "";
  const sw = WIN.w / 5;
  for (let k = 0; k < 5; k++) {
    const a = X0 + k * sw;
    swags += `<path d="M${n1(a)} ${Y0}H${n1(a + sw)}V${Y0 + 38}Q${n1(a + sw / 2)} ${Y0 + 104} ${n1(a)} ${Y0 + 38}Z" fill="${red}" stroke="${ink}" stroke-width="2.6" stroke-linejoin="round"/>
      <path d="M${n1(a + 14)} ${Y0 + 36}Q${n1(a + sw / 2)} ${Y0 + 84} ${n1(a + sw - 14)} ${Y0 + 36}M${n1(a + 34)} ${Y0 + 33}Q${n1(a + sw / 2)} ${Y0 + 64} ${n1(a + sw - 34)} ${Y0 + 33}" fill="none" stroke="${ink}" stroke-width="1.2" opacity="0.55"/>
      ${beadsOnCurve(a + 6, Y0 + 42, a + sw / 2, Y0 + 106, a + sw - 6, Y0 + 42, 9.5, 2.2, gold)}`;
  }
  // The side curtains, drawn well back: they hug the card's edges and leave the stage to the word
  // (starl3xx, 2026-11-25: "too close ... drawn more / closer to the edges").
  const k = 0.56;
  const o = (v: number) => n1(X0 + v * k);
  const shape = `M${X0} ${Y0}H${o(250)}C${o(236)} 250 ${o(150)} 330 ${o(104)} 372C${o(150)} 410 ${o(186)} 500 ${o(196)} ${Y1}H${X0}Z`;
  const side = `<path d="${shape}" fill="${red}" stroke="${ink}" stroke-width="2.8" stroke-linejoin="round"/><path d="${shape}" fill="url(#fold)"/>
    <path d="M${o(60)} ${Y0}C${o(58)} 200 ${o(48)} 300 ${o(62)} 366M${o(124)} ${Y0}C${o(122)} 200 ${o(98)} 310 ${o(82)} 366M${o(190)} ${Y0}C${o(184)} 210 ${o(132)} 320 ${o(100)} 368M${o(52)} 384C${o(60)} 470 ${o(62)} 560 ${o(60)} ${Y1}M${o(86)} 384C${o(112)} 460 ${o(124)} 560 ${o(126)} ${Y1}" fill="none" stroke="${ink}" stroke-width="1.5" opacity="0.6"/>
    <path d="M${X0 - 4} 362C${o(40)} 384 ${o(84)} 384 ${o(112)} 366" fill="none" stroke="${gold}" stroke-width="12" stroke-linecap="round"/>
    <path d="M${X0 - 4} 362C${o(40)} 384 ${o(84)} 384 ${o(112)} 366" fill="none" stroke="${ink}" stroke-width="1.8" stroke-dasharray="2 7" opacity="0.5"/>
    <path d="M${o(100)} 372v56" stroke="${gold}" stroke-width="6.5" stroke-linecap="round"/><path d="M${n1(X0 + 100 * k - 12)} 430h24l-5 34h-14z" fill="${gold}" stroke="${ink}" stroke-width="1.8" stroke-linejoin="round"/>`;
  // the boards: the floor starts behind the letters (its far edge is above their feet)
  const yf = FEET_Y - 44;
  let boards = "";
  for (let k = -11; k <= 11; k++) boards += `M${n1(W / 2 + k * 40)} ${yf}L${n1(W / 2 + k * 96)} ${Y1}`;
  for (const y of [yf + 16, yf + 40, yf + 78, yf + 132]) boards += `M${X0} ${y}H${X1}`;
  let lights = "";
  for (let k = 0; k < 9; k++) {
    const x = X0 + 62 + k * ((WIN.w - 124) / 8);
    lights += `<path d="M${n1(x - 30)} ${Y1}A30 26 0 0 1 ${n1(x + 30)} ${Y1}Z" fill="#fbf1cf" stroke="${ink}" stroke-width="2.2"/><path d="M${n1(x - 17)} ${Y1}A17 15 0 0 1 ${n1(x + 17)} ${Y1}" fill="none" stroke="${ink}" stroke-width="1" opacity="0.5"/>`;
  }
  return `<defs>${clip("w")}${hatch("drape", 90, 9, "#2a3a48", 2, 0.34)}${hatch("fold", 100, 7, ink, 1.2, 0.22)}${hatch("wood", 0, 6, ink, 1, 0.24)}
    <linearGradient id="spot" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff6d6" stop-opacity="0.46"/><stop offset="1" stop-color="#fff6d6" stop-opacity="0.08"/></linearGradient></defs>
  <g clip-path="url(#w)">
    <rect x="${X0}" y="${Y0}" width="${WIN.w}" height="${WIN.h}" fill="${back}"/>
    <rect x="${X0}" y="${Y0}" width="${WIN.w}" height="${yf - Y0}" fill="url(#drape)"/>
    <path d="M${W / 2 - 70} ${Y0}L${W / 2 + 70} ${Y0}L${W / 2 + 340} ${yf}L${W / 2 - 340} ${yf}Z" fill="url(#spot)"/>
    <rect x="${X0}" y="${yf}" width="${WIN.w}" height="${Y1 - yf}" fill="#e3cfa6"/>
    <rect x="${X0}" y="${yf}" width="${WIN.w}" height="${Y1 - yf}" fill="url(#wood)"/>
    <path d="${boards}" stroke="${ink}" stroke-width="1.6" opacity="0.5" fill="none"/>
    <ellipse cx="${W / 2}" cy="${FEET_Y + 8}" rx="380" ry="46" fill="#fff6d6" opacity="0.4"/>
    <line x1="${X0}" y1="${yf}" x2="${X1}" y2="${yf}" stroke="${ink}" stroke-width="2.8"/>
    ${side}<g transform="translate(${W} 0) scale(-1 1)">${side}</g>
    ${swags}
    <rect x="${X0}" y="${Y0}" width="${WIN.w}" height="20" fill="${redDeep}" stroke="${ink}" stroke-width="2.6"/>
    ${lights}
    <rect x="${X0}" y="${Y0}" width="${WIN.w}" height="${WIN.h}" fill="${CARD_PAPER}" opacity="0.08"/>
  </g>`;
}


/**
 * The Trophy Case: a cabinet seen from a little above. Cups and plaques on the shelf overhead, a
 * quilted green wall, and the word on its own velvet-topped shelf, over a brass plate.
 */
export function trophy(): string {
  const ink = "#2b2620";
  const baize = "#5d776d";
  const wood = "#bf9968";
  const woodTop = "#d3b487";
  const woodDark = "#8d6c47";
  const velvet = "#a8635d";
  const gold = "#d4b062";
  const lite = "#f2e2b0";
  const d = 44;
  const topY = 196;
  const yb = FEET_Y - 30;
  const yf = FEET_Y + 26;
  const cup = (x: number, b: number, k: number) => {
    const p = (dx: number, dy: number) => `${n1(x + dx * k)} ${n1(b + dy * k)}`;
    return `<path d="M${p(-24, -84)}C${p(-46, -84)} ${p(-44, -56)} ${p(-18, -56)}M${p(24, -84)}C${p(46, -84)} ${p(44, -56)} ${p(18, -56)}" fill="none" stroke="${ink}" stroke-width="5.4" stroke-linecap="round"/>
      <path d="M${p(-24, -84)}C${p(-46, -84)} ${p(-44, -56)} ${p(-18, -56)}M${p(24, -84)}C${p(46, -84)} ${p(44, -56)} ${p(18, -56)}" fill="none" stroke="${gold}" stroke-width="2.4" stroke-linecap="round"/>
      <path d="M${p(-25, -94)}L${p(25, -94)}C${p(25, -62)} ${p(14, -46)} ${p(0, -46)}C${p(-14, -46)} ${p(-25, -62)} ${p(-25, -94)}Z" fill="${gold}" stroke="${ink}" stroke-width="2.2" stroke-linejoin="round"/>
      <path d="M${p(-16, -86)}C${p(-16, -70)} ${p(-12, -60)} ${p(-6, -54)}" fill="none" stroke="${lite}" stroke-width="${n1(3.2 * k)}" stroke-linecap="round"/>
      <path d="M${p(-4, -46)}L${p(-7, -30)}L${p(7, -30)}L${p(4, -46)}Z" fill="${gold}" stroke="${ink}" stroke-width="2"/>
      <rect x="${n1(x - 17 * k)}" y="${n1(b - 30 * k)}" width="${n1(34 * k)}" height="${n1(8 * k)}" rx="2" fill="${gold}" stroke="${ink}" stroke-width="2"/>
      <rect x="${n1(x - 23 * k)}" y="${n1(b - 22 * k)}" width="${n1(46 * k)}" height="${n1(22 * k)}" rx="2" fill="${woodDark}" stroke="${ink}" stroke-width="2.2"/>
      <rect x="${n1(x - 13 * k)}" y="${n1(b - 15 * k)}" width="${n1(26 * k)}" height="${n1(8 * k)}" rx="1.5" fill="${gold}" stroke="${ink}" stroke-width="1.2"/>`;
  };
  const starCup = (x: number, b: number, k: number) => {
    let pts = "";
    for (let i = 0; i < 10; i++) {
      const a = (Math.PI / 5) * i - Math.PI / 2;
      const r = (i % 2 ? 12 : 28) * k;
      pts += `${n1(x + r * Math.cos(a))},${n1(b - 66 * k + r * Math.sin(a))} `;
    }
    return `<rect x="${n1(x - 3.5 * k)}" y="${n1(b - 44 * k)}" width="${n1(7 * k)}" height="${n1(24 * k)}" fill="${gold}" stroke="${ink}" stroke-width="2"/><polygon points="${pts}" fill="${gold}" stroke="${ink}" stroke-width="2.2" stroke-linejoin="round"/>
      <rect x="${n1(x - 21 * k)}" y="${n1(b - 22 * k)}" width="${n1(42 * k)}" height="${n1(22 * k)}" rx="2" fill="${woodDark}" stroke="${ink}" stroke-width="2.2"/>`;
  };
  const shield = (x: number, b: number, k: number) => {
    const y = b - 58 * k;
    const sh = (w: number, t: number) => `M${n1(x - w)} ${n1(y - t)}H${n1(x + w)}V${n1(y + t * 0.2)}C${n1(x + w)} ${n1(y + t * 0.8)} ${n1(x + w * 0.4)} ${n1(y + t * 1.15)} ${n1(x)} ${n1(y + t * 1.3)}C${n1(x - w * 0.4)} ${n1(y + t * 1.15)} ${n1(x - w)} ${n1(y + t * 0.8)} ${n1(x - w)} ${n1(y + t * 0.2)}Z`;
    return `<path d="${sh(27 * k, 34 * k)}" fill="${woodDark}" stroke="${ink}" stroke-width="2.2" stroke-linejoin="round"/><path d="${sh(18 * k, 24 * k)}" fill="${gold}" stroke="${ink}" stroke-width="1.6" stroke-linejoin="round"/>
      <path d="M${n1(x - 9 * k)} ${n1(y - 8 * k)}H${n1(x + 9 * k)}M${n1(x - 9 * k)} ${n1(y)}H${n1(x + 9 * k)}" stroke="${ink}" stroke-width="1.4" opacity="0.6"/>
      <path d="M${n1(x - 20 * k)} ${n1(b)}L${n1(x - 10 * k)} ${n1(b - 16 * k)}H${n1(x + 10 * k)}L${n1(x + 20 * k)} ${n1(b)}Z" fill="${woodDark}" stroke="${ink}" stroke-width="2"/>`;
  };
  const rosette = (x: number, b: number, k: number, fill: string) =>
    `<path d="M${n1(x - 10 * k)} ${n1(b - 62 * k)}L${n1(x - 17 * k)} ${n1(b - 4 * k)}L${n1(x - 6 * k)} ${n1(b - 14 * k)}L${n1(x)} ${n1(b - 2 * k)}L${n1(x + 6 * k)} ${n1(b - 14 * k)}L${n1(x + 17 * k)} ${n1(b - 4 * k)}L${n1(x + 10 * k)} ${n1(b - 62 * k)}Z" fill="${fill}" stroke="${ink}" stroke-width="2" stroke-linejoin="round"/>
      <circle cx="${n1(x)}" cy="${n1(b - 72 * k)}" r="${n1(27 * k)}" fill="${fill}" stroke="${ink}" stroke-width="2.2"/>${beadRing(x, b - 72 * k, 27 * k, 8.4 * k, n1(1.5 * k), lite)}
      <circle cx="${n1(x)}" cy="${n1(b - 72 * k)}" r="${n1(15 * k)}" fill="${gold}" stroke="${ink}" stroke-width="1.8"/>`;
  const prizes = `${shield(196, topY, 1)}${cup(338, topY, 0.86)}${starCup(468, topY, 1)}${cup(600, topY, 1.18)}${rosette(736, topY, 0.92, "#7f9f93")}${cup(868, topY, 0.86)}${rosette(1004, topY, 0.92, "#b97a72")}`;
  const over = `<path d="M${X0} ${topY + 16}H${X1}L${X1 - d} ${topY + 30}H${X0 + d}Z" fill="${woodDark}" stroke="${ink}" stroke-width="2"/>
    <rect x="${X0}" y="${topY}" width="${WIN.w}" height="16" fill="${wood}" stroke="${ink}" stroke-width="2.6"/><rect x="${X0}" y="${topY}" width="${WIN.w}" height="16" fill="url(#grain)"/>`;
  const sideWall = `<path d="M${X0} ${topY + 16}L${X0 + d} ${topY + 30}V${yb}L${X0} ${yf}Z" fill="${woodDark}" stroke="${ink}" stroke-width="2"/><path d="M${X0} ${topY + 16}L${X0 + d} ${topY + 30}V${yb}L${X0} ${yf}Z" fill="url(#grainv)"/>`;
  const shelf = `<path d="M${X0 + d} ${yb}H${X1 - d}L${X1} ${yf}H${X0}Z" fill="${velvet}" stroke="${ink}" stroke-width="2.4" stroke-linejoin="round"/>
    <path d="M${X0 + d} ${yb}H${X1 - d}L${X1} ${yf}H${X0}Z" fill="url(#nap)"/><path d="M${X0 + d} ${yb}H${X1 - d}L${X1} ${yf}H${X0}Z" fill="url(#lit)"/>
    <rect x="${X0}" y="${yf}" width="${WIN.w}" height="30" fill="${wood}" stroke="${ink}" stroke-width="2.8"/><rect x="${X0}" y="${yf}" width="${WIN.w}" height="30" fill="url(#grain)"/>
    <rect x="${W / 2 - 104}" y="${yf + 6}" width="208" height="18" rx="4" fill="${gold}" stroke="${ink}" stroke-width="2"/><path d="M${W / 2 - 78} ${yf + 15}H${W / 2 + 78}" stroke="${ink}" stroke-width="1.6" stroke-dasharray="10 5" opacity="0.6"/>
    <circle cx="${W / 2 - 93}" cy="${yf + 15}" r="2.6" fill="${ink}"/><circle cx="${W / 2 + 93}" cy="${yf + 15}" r="2.6" fill="${ink}"/>`;
  // the drawers below
  const dy = yf + 38;
  const drawer = (x: number, w: number) => `<rect x="${x}" y="${dy}" width="${w}" height="${Y1 - dy + 20}" rx="5" fill="${woodTop}" stroke="${ink}" stroke-width="2.2"/><rect x="${x + 12}" y="${dy + 12}" width="${w - 24}" height="${Y1 - dy}" rx="3" fill="none" stroke="${ink}" stroke-width="1.2" opacity="0.5"/><circle cx="${x + w / 2}" cy="${dy + 44}" r="9" fill="${gold}" stroke="${ink}" stroke-width="2"/>`;
  const half = (WIN.w - 42) / 2;
  return `<defs>${clip("w")}${hatch("q1", 58, 30, lite, 1.4, 0.3)}${hatch("q2", -58, 30, lite, 1.4, 0.3)}${hatch("grain", 0, 5, ink, 1, 0.3)}${hatch("grainv", 90, 5, ink, 1, 0.26)}${hatch("nap", 90, 4, ink, 1, 0.14)}
    <linearGradient id="lit" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${ink}" stop-opacity="0.26"/><stop offset="1" stop-color="${ink}" stop-opacity="0"/></linearGradient>
    <radialGradient id="wglow" cx="0.5" cy="0.62" r="0.62"><stop offset="0" stop-color="#ffffff" stop-opacity="0.42"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/></radialGradient></defs>
  <g clip-path="url(#w)">
    <rect x="${X0}" y="${Y0}" width="${WIN.w}" height="${WIN.h}" fill="${baize}"/>
    <rect x="${X0}" y="${Y0}" width="${WIN.w}" height="${yb - Y0}" fill="url(#q1)"/><rect x="${X0}" y="${Y0}" width="${WIN.w}" height="${yb - Y0}" fill="url(#q2)"/>
    <rect x="${X0}" y="${topY}" width="${WIN.w}" height="${yb - topY}" fill="url(#wglow)"/>
    ${prizes}${over}
    ${sideWall}<g transform="translate(${W} 0) scale(-1 1)">${sideWall}</g>
    ${shelf}
    <rect x="${X0}" y="${dy - 8}" width="${WIN.w}" height="${Y1 - dy + 8}" fill="${woodDark}"/>
    ${drawer(X0 + 14, half)}${drawer(X0 + 28 + half, half)}
    <rect x="${X0}" y="${Y0}" width="${WIN.w}" height="${WIN.h}" fill="${CARD_PAPER}" opacity="0.07"/>
  </g>`;
}


/**
 * Spring: a low green hill under a pale sky, blossom boughs in the upper corners, far hills ruled
 * in line. The word stands on the hill's curve (GROUND), as it does on the little planet.
 */
export function spring(): string {
  const ink = "#34412f";
  const sky = "#dfe9e6";
  const far = "#bcd0b3";
  const near = "#a8c49b";
  const grass = "#b9d09c";
  const pink = "#e9bcc3";
  const rose = "#d6919d";
  const bark = "#80634c";
  const r = rng(23);
  const cx = W / 2;
  const cy = FEET_Y + KNOLL;
  const on = (deg: number, depth: number) => {
    const a = (deg * Math.PI) / 180;
    return [cx + (KNOLL - depth) * Math.sin(a), cy - (KNOLL - depth) * Math.cos(a)];
  };
  const cloud = (x: number, y: number, k: number) =>
    `<path d="M${n1(x - 62 * k)} ${n1(y)}a${n1(24 * k)} ${n1(24 * k)} 0 0 1 ${n1(30 * k)} ${n1(-22 * k)}a${n1(30 * k)} ${n1(30 * k)} 0 0 1 ${n1(56 * k)} ${n1(-8 * k)}a${n1(22 * k)} ${n1(22 * k)} 0 0 1 ${n1(38 * k)} ${n1(30 * k)}Z" fill="#ffffff" fill-opacity="0.92" stroke="${ink}" stroke-width="2" stroke-linejoin="round"/>
     <path d="M${n1(x - 44 * k)} ${n1(y + 8 * k)}H${n1(x + 50 * k)}M${n1(x - 26 * k)} ${n1(y + 16 * k)}H${n1(x + 34 * k)}" stroke="${ink}" stroke-width="1.2" opacity="0.4" stroke-linecap="round"/>`;
  const bloom = (x: number, y: number, k: number) => {
    let petals = "";
    for (let i = 0; i < 5; i++) {
      const a = ((Math.PI * 2) / 5) * i - Math.PI / 2;
      petals += `<circle cx="${n1(x + 7.5 * k * Math.cos(a))}" cy="${n1(y + 7.5 * k * Math.sin(a))}" r="${n1(6.4 * k)}" fill="${pink}" stroke="${ink}" stroke-width="1.3"/>`;
    }
    return `${petals}<circle cx="${n1(x)}" cy="${n1(y)}" r="${n1(3.4 * k)}" fill="${rose}" stroke="${ink}" stroke-width="1"/>`;
  };
  // a bough from the upper left corner; the right one mirrors it
  const boughPath = `M${X0 - 6} 150C${X0 + 70} 132 ${X0 + 150} 118 ${X0 + 236} 78M${X0 + 96} 128C${X0 + 126} 150 ${X0 + 150} 170 ${X0 + 196} 176M${X0 + 150} 112C${X0 + 160} 86 ${X0 + 176} 66 ${X0 + 170} ${Y0}`;
  let blooms = "";
  for (const [x, y, k] of [[236, 78, 1.25], [200, 100, 1], [160, 112, 1.15], [112, 128, 0.95], [196, 176, 1.2], [164, 162, 0.9], [128, 150, 1.05], [176, 66, 1.1], [62, 142, 1.2], [84, 104, 0.9], [226, 126, 0.85], [140, 78, 0.9]]) blooms += bloom(X0 + x, y, k);
  const bough = `<path d="${boughPath}" fill="none" stroke="${ink}" stroke-width="9" stroke-linecap="round"/><path d="${boughPath}" fill="none" stroke="${bark}" stroke-width="5" stroke-linecap="round"/>${blooms}`;
  let petals = "";
  for (let i = 0; i < 12; i++) {
    const x = X0 + 60 + r() * (WIN.w - 120);
    const y = Y0 + 90 + r() * 250;
    petals += `<ellipse cx="${n1(x)}" cy="${n1(y)}" rx="6" ry="3.4" transform="rotate(${n1(r() * 180)} ${n1(x)} ${n1(y)})" fill="${pink}" stroke="${ink}" stroke-width="1"/>`;
  }
  // the hill: tufts along its brow, daisies on its slope
  let tufts = "";
  for (let deg = -9.4; deg <= 9.4; deg += 0.62) {
    const [x, y] = on(deg + (r() - 0.5) * 0.2, 6 + r() * 22);
    tufts += `M${n1(x - 5)} ${n1(y)}l3 -9M${n1(x)} ${n1(y)}l0 -11M${n1(x + 5)} ${n1(y)}l-3 -9`;
  }
  let daisies = "";
  for (let i = 0; i < 26; i++) {
    const [x, y] = on(-9.2 + r() * 18.4, 42 + r() * 120);
    const k = 0.8 + r() * 0.6;
    daisies += `<circle cx="${n1(x)}" cy="${n1(y)}" r="${n1(7 * k)}" fill="#ffffff" stroke="${ink}" stroke-width="1.2" stroke-dasharray="${n1(3.4 * k)} ${n1(1.1 * k)}"/><circle cx="${n1(x)}" cy="${n1(y)}" r="${n1(2.6 * k)}" fill="#e8c65a" stroke="${ink}" stroke-width="0.8"/>`;
  }
  let contours = "";
  for (const depth of [34, 74, 122]) contours += `<circle cx="${cx}" cy="${cy}" r="${KNOLL - depth}" fill="none" stroke="${ink}" stroke-width="1" opacity="0.22" stroke-dasharray="18 12"/>`;
  const fly = (x: number, y: number, k: number, fill: string) =>
    `<g transform="translate(${x} ${y}) scale(${k})"><path d="M0 0C-16 -18 -26 -6 -14 6C-22 12 -12 20 0 6Z" fill="${fill}" stroke="${ink}" stroke-width="1.6"/><path d="M0 0C16 -18 26 -6 14 6C22 12 12 20 0 6Z" fill="${fill}" stroke="${ink}" stroke-width="1.6"/><path d="M0 -4V10" stroke="${ink}" stroke-width="2.4" stroke-linecap="round"/></g>`;
  return `<defs>${clip("w")}${hatch("air", 0, 8, ink, 1, 0.12)}${hatch("h1", 62, 7, ink, 1, 0.2)}${hatch("h2", -62, 7, ink, 1, 0.2)}
    <linearGradient id="fade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${sky}" stop-opacity="0"/><stop offset="1" stop-color="${sky}" stop-opacity="1"/></linearGradient>
    <radialGradient id="sun" cx="0.5" cy="0.5" r="0.5"><stop offset="0.45" stop-color="#fff3c8" stop-opacity="0.9"/><stop offset="1" stop-color="#fff3c8" stop-opacity="0"/></radialGradient></defs>
  <g clip-path="url(#w)">
    <rect x="${X0}" y="${Y0}" width="${WIN.w}" height="${WIN.h}" fill="${sky}"/>
    <rect x="${X0}" y="${Y0}" width="${WIN.w}" height="230" fill="url(#air)"/><rect x="${X0}" y="${Y0 + 110}" width="${WIN.w}" height="120" fill="url(#fade)"/>
    <circle cx="806" cy="132" r="96" fill="url(#sun)"/><path d="${sunburst(806, 132, 54, 82, 20, 0.34)}" fill="${ink}" opacity="0.35"/>
    <circle cx="806" cy="132" r="42" fill="#fbf0c6" stroke="${ink}" stroke-width="2.2"/>
    ${cloud(430, 130, 1.1)}${cloud(650, 218, 0.8)}${cloud(1010, 250, 0.95)}
    <path d="M${X0} 372Q260 280 520 356T${X1} 318V${Y1}H${X0}Z" fill="${far}" stroke="${ink}" stroke-width="2"/><path d="M${X0} 372Q260 280 520 356T${X1} 318V${Y1}H${X0}Z" fill="url(#h1)"/>
    <path d="M${X0} 408Q210 392 430 414T860 372Q1010 348 ${X1} 396V${Y1}H${X0}Z" fill="${near}" stroke="${ink}" stroke-width="2"/><path d="M${X0} 408Q210 392 430 414T860 372Q1010 348 ${X1} 396V${Y1}H${X0}Z" fill="url(#h2)"/>
    ${petals}
    <circle cx="${cx}" cy="${cy}" r="${KNOLL}" fill="${grass}" stroke="${ink}" stroke-width="3"/>
    ${contours}<path d="${tufts}" fill="none" stroke="${ink}" stroke-width="1.5" stroke-linecap="round" opacity="0.7"/>${daisies}
    ${bough}<g transform="translate(${W} 0) scale(-1 1)">${bough}</g>
    ${fly(352, 262, 0.9, "#f0d98e")}${fly(962, 172, 0.7, pink)}
    <rect x="${X0}" y="${Y0}" width="${WIN.w}" height="${WIN.h}" fill="${CARD_PAPER}" opacity="0.06"/>
  </g>`;
}


// ---------------------------------------------------------------------------------------------
// The Shop's scenes (lib/scenes, SHOP_SCENES): drawn like the rest, and a player's only once their
// profile has bought the scene in the Shop.
// ---------------------------------------------------------------------------------------------

/**
 * The Bookshelf: a bookcase seen from a little above. Books on the shelf overhead and the one
 * below; the word's own shelf holds no books at all, and its top is drawn in perspective, so the
 * letters stand on a board, not on a line.
 */
export function bookshelf(): string {
  const ink = "#2f221a";
  const paper = "#efe6d2";
  const wood = "#c9a473";
  const woodTop = "#dbbf93";
  const tones = ["#9d6159", "#63826f", "#566b8a", "#c8a85e", "#e6dcc4", "#75607a", "#b28556"];
  const r = rng(11);
  const d = 44; // how much narrower a shelf's back is than its front, each side
  const row = (x0: number, x1: number, base: number, lo: number, hi: number): string => {
    let out = "";
    let x = x0;
    while (x < x1 - 20) {
      const w = Math.min(x1 - x, 22 + Math.floor(r() * 34));
      const h = lo + r() * (hi - lo);
      const fill = tones[Math.floor(r() * tones.length)];
      const y = base - h;
      const pale = fill === "#e6dcc4" ? ink : "#f3e6c0";
      const lean = r() < 0.08 && w < 40 ? ` transform="rotate(${n1(5 + r() * 4)} ${n1(x)} ${base})"` : "";
      const band = (yy: number) => `<path d="M${n1(x + 3)} ${n1(yy)}H${n1(x + w - 3)}M${n1(x + 3)} ${n1(yy + 5)}H${n1(x + w - 3)}" stroke="${pale}" stroke-width="1.5" opacity="0.85"/>`;
      const jewel = w > 30 ? `<path d="M${n1(x + w / 2)} ${n1(y + h * 0.5 - 7)}l6 7-6 7-6-7z" fill="${pale}" opacity="0.85"/>` : `<circle cx="${n1(x + w / 2)}" cy="${n1(y + h * 0.5)}" r="2.6" fill="${pale}" opacity="0.85"/>`;
      out += `<g${lean}><rect x="${n1(x)}" y="${n1(y)}" width="${w}" height="${n1(h)}" rx="2.5" fill="${fill}" stroke="${ink}" stroke-width="2.2"/><rect x="${n1(x + w * 0.62)}" y="${n1(y + 2)}" width="${n1(w * 0.38 - 2)}" height="${n1(h - 4)}" fill="url(#bk)"/>${band(y + 12)}${band(y + h - 20)}${jewel}</g>`;
      x += w + 1.5;
    }
    return out;
  };
  const topY = 188;
  const globe = `<g transform="translate(1004 ${topY - 76})" fill="none" stroke="${ink}" stroke-width="2.2"><circle r="46" fill="#d5e2da"/><ellipse rx="46" ry="16"/><ellipse rx="20" ry="46"/><path d="M-46 0H46M0 -46V46"/><path d="M-58 -30A64 64 0 0 0 30 58" stroke-width="3.6"/><path d="M-16 60h32l8 14h-48z" fill="${wood}"/></g>`;
  // the shelf overhead: we see its front edge and a little of its underside
  const over = `<path d="M${X0} ${topY + 18}H${X1}L${X1 - d} ${topY + 34}H${X0 + d}Z" fill="#a5855a" stroke="${ink}" stroke-width="2"/><path d="M${X0} ${topY + 18}H${X1}L${X1 - d} ${topY + 34}H${X0 + d}Z" fill="url(#grain)"/>
    <rect x="${X0}" y="${topY}" width="${WIN.w}" height="18" fill="${wood}" stroke="${ink}" stroke-width="2.6"/><rect x="${X0}" y="${topY}" width="${WIN.w}" height="18" fill="url(#grain)"/>`;
  // the word's shelf: its top, seen from above, and its front face
  const yb = FEET_Y - 30; // the back edge
  const yf = FEET_Y + 26; // the front edge
  let planks = "";
  for (let k = 1; k < 12; k++) planks += `M${n1(X0 + d + (k / 12) * (WIN.w - 2 * d))} ${yb}L${n1(X0 + (k / 12) * WIN.w)} ${yf}`;
  const shelf = `<path d="M${X0 + d} ${yb}H${X1 - d}L${X1} ${yf}H${X0}Z" fill="${woodTop}" stroke="${ink}" stroke-width="2.4" stroke-linejoin="round"/>
    <path d="${planks}" stroke="${ink}" stroke-width="1" opacity="0.3" fill="none"/>
    <path d="M${X0 + d} ${yb}H${X1 - d}L${X1} ${yf}H${X0}Z" fill="url(#lit)"/>
    <rect x="${X0}" y="${yf}" width="${WIN.w}" height="26" fill="${wood}" stroke="${ink}" stroke-width="2.8"/><rect x="${X0}" y="${yf}" width="${WIN.w}" height="26" fill="url(#grain)"/>
    <line x1="${X0}" y1="${yf + 32}" x2="${X1}" y2="${yf + 32}" stroke="${ink}" stroke-width="1" opacity="0.5"/>`;
  // the bookcase's inner sides, running back to its wall
  const sideWall = `<path d="M${X0} ${topY + 18}L${X0 + d} ${topY + 34}V${yb}L${X0} ${yf}Z" fill="#d9ccae" stroke="${ink}" stroke-width="2"/><path d="M${X0} ${topY + 18}L${X0 + d} ${topY + 34}V${yb}L${X0} ${yf}Z" fill="url(#wallh)"/>`;
  return `<defs>${clip("w")}${hatch("bk", 90, 4, ink, 1, 0.42)}${hatch("grain", 0, 5, ink, 1, 0.3)}${hatch("wall", 45, 9, ink, 1, 0.13)}${hatch("wallh", 0, 6, ink, 1, 0.28)}
    <linearGradient id="lit" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${ink}" stop-opacity="0.22"/><stop offset="1" stop-color="${ink}" stop-opacity="0"/></linearGradient>
    <radialGradient id="wglow" cx="0.5" cy="0.6" r="0.6"><stop offset="0" stop-color="#ffffff" stop-opacity="0.55"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/></radialGradient></defs>
  <g clip-path="url(#w)">
    <rect x="${X0}" y="${Y0}" width="${WIN.w}" height="${WIN.h}" fill="${paper}"/>
    <rect x="${X0}" y="${Y0}" width="${WIN.w}" height="${WIN.h}" fill="url(#wall)"/>
    <rect x="${X0}" y="${topY}" width="${WIN.w}" height="${yb - topY}" fill="url(#wglow)"/>
    ${row(X0 + 8, 924, topY, 90, 138)}${globe}${row(1074, X1 - 6, topY, 86, 130)}
    ${over}
    ${sideWall}<g transform="translate(${W} 0) scale(-1 1)">${sideWall}</g>
    <!-- the word's shelf holds no books at all: it is the word's -->
    ${shelf}
    ${row(X0 + 8, X1 - 6, Y1 + 66, 150, 188)}
  </g>`;
}

/** Outer space: a navy plate cut in pale line. A ringed planet, a moon, a comet, and a small
 *  round world whose curve the word stands on. */
export function space(): string {
  const navy = "#1b2442";
  const line = "#efe5c9";
  const gold = "#dcb45c";
  const r = rng(7);
  let stars = "";
  for (let k = 0; k < 70; k++) {
    const x = X0 + 14 + r() * (WIN.w - 28);
    const y = Y0 + 14 + r() * (FEET_Y - Y0 - 70);
    const big = r();
    stars += big > 0.86 ? star(x, y, 8 + r() * 7, big > 0.95 ? gold : line) : `<circle cx="${n1(x)}" cy="${n1(y)}" r="${n1(1 + r() * 1.6)}" fill="${line}" opacity="${n1(0.5 + r() * 0.5)}"/>`;
  }
  const px = 944;
  const py = 148;
  const ring = (front: boolean) => `<g transform="rotate(-16 ${px} ${py})" fill="none" stroke="${gold}"><path d="M${px - 172} ${py}A172 40 0 0 ${front ? 0 : 1} ${px + 172} ${py}" stroke-width="5"/><path d="M${px - 146} ${py}A146 30 0 0 ${front ? 0 : 1} ${px + 146} ${py}" stroke-width="2"/><path d="M${px - 196} ${py}A196 48 0 0 ${front ? 0 : 1} ${px + 196} ${py}" stroke-width="1.6"/></g>`;
  let lat = "";
  for (let k = -4; k <= 4; k++) lat += `<ellipse cx="${px}" cy="${py + k * 19}" rx="${n1(Math.sqrt(Math.max(0, 96 * 96 - (k * 19) ** 2)))}" ry="${n1(7 - Math.abs(k) * 0.8)}"/>`;
  const planet = `${ring(false)}<circle cx="${px}" cy="${py}" r="96" fill="#2c3b6c" stroke="${line}" stroke-width="3"/><clipPath id="pl"><circle cx="${px}" cy="${py}" r="96"/></clipPath><g clip-path="url(#pl)" fill="none" stroke="${line}" stroke-width="1.5" opacity="0.75" transform="rotate(-16 ${px} ${py})">${lat}</g><path d="M${px + 20} ${py - 92}A96 96 0 0 1 ${px + 20} ${py + 92}A150 150 0 0 0 ${px + 20} ${py - 92}Z" fill="url(#shade)" clip-path="url(#pl)"/>${ring(true)}`;
  const moon = `<g transform="translate(228 138)"><path d="M0 -54A54 54 0 1 0 38 38A42 42 0 1 1 0 -54Z" fill="${line}" stroke="${line}" stroke-width="2"/><path d="M0 -54A54 54 0 1 0 38 38A42 42 0 1 1 0 -54Z" fill="url(#moonh)"/></g>`;
  let tail = "";
  for (let k = 0; k < 7; k++) tail += `M${n1(520 + k * 3)} ${n1(120 + k * 4.5)}L${n1(360 + k * 9)} ${n1(88 + k * 9)}`;
  const comet = `<path d="${tail}" stroke="${line}" stroke-width="1.6" stroke-linecap="round" opacity="0.75"/>${star(530, 134, 17, gold)}`;
  // the world underfoot: a circle whose top is the feet line; its contours and craters follow it
  const cx = W / 2;
  const cy = FEET_Y + PLANET;
  const on = (deg: number, depth: number) => {
    const a = (deg * Math.PI) / 180;
    return [cx + (PLANET - depth) * Math.sin(a), cy - (PLANET - depth) * Math.cos(a)];
  };
  let craters = "";
  for (const [deg, depth, w] of [[-12.5, 34, 64], [-7.4, 62, 96], [-2.6, 30, 50], [2.2, 70, 88], [6.6, 36, 58], [11.4, 58, 84], [14.6, 26, 44], [-15.4, 70, 60]]) {
    const [x, y] = on(deg, depth);
    craters += `<g transform="rotate(${deg} ${n1(x)} ${n1(y)})"><ellipse cx="${n1(x)}" cy="${n1(y)}" rx="${w / 2}" ry="${n1(w / 6.5)}" fill="#111936" stroke="${line}" stroke-width="2"/><path d="M${n1(x - w / 2 + 6)} ${n1(y + 1)}A${w / 2 - 6} ${n1(w / 9)} 0 0 0 ${n1(x + w / 2 - 6)} ${n1(y + 1)}" fill="none" stroke="${line}" stroke-width="1" opacity="0.6"/></g>`;
  }
  let contours = "";
  for (const depth of [14, 30, 50, 74, 102]) contours += `<circle cx="${cx}" cy="${cy}" r="${PLANET - depth}" fill="none" stroke="${line}" stroke-width="1" opacity="${n1(0.34 - depth * 0.002)}" stroke-dasharray="${depth < 40 ? "none" : "14 9"}"/>`;
  return `<defs>${clip("w")}${hatch("shade", 60, 5, "#0b1128", 2, 0.75)}${hatch("moonh", -40, 4.5, navy, 1.3, 0.45)}
    <radialGradient id="neb" cx="0.5" cy="0.62" r="0.62"><stop offset="0" stop-color="#40539c" stop-opacity="0.7"/><stop offset="1" stop-color="#40539c" stop-opacity="0"/></radialGradient>
    <radialGradient id="halo" cx="0.5" cy="1" r="0.75"><stop offset="0.72" stop-color="#8fa4ea" stop-opacity="0.34"/><stop offset="1" stop-color="#8fa4ea" stop-opacity="0"/></radialGradient></defs>
  <g clip-path="url(#w)">
    <rect x="${X0}" y="${Y0}" width="${WIN.w}" height="${WIN.h}" fill="${navy}"/>
    <rect x="${X0}" y="${Y0}" width="${WIN.w}" height="${WIN.h}" fill="url(#neb)"/>
    <path d="${sunburst(cx, FEET_Y + 40, 300, 1000, 40, 0.42)}" fill="${line}" opacity="0.04"/>
    ${stars}
    <path d="M228 138L300 92L410 126M300 92L330 44" fill="none" stroke="${line}" stroke-width="1.2" stroke-dasharray="2 7" stroke-linecap="round" opacity="0.6"/>
    ${moon}${comet}${planet}
    <rect x="${X0}" y="${FEET_Y - 120}" width="${WIN.w}" height="240" fill="url(#halo)"/>
    <circle cx="${cx}" cy="${cy}" r="${PLANET}" fill="#33437c" stroke="${line}" stroke-width="3"/>
    ${contours}${craters}
  </g>`;
}

// ---------------------------------------------------------------------------------------------
// Standing on a curve. A scene whose ground isn't level gives ONE thing: its height under the
// word, as a function of how far along the card you are (s, from the card's centre; down is
// positive; 0 is the feet line). Each letter is lowered to the curve under its own feet and turned
// to the curve's slope there (footingFor, below; the card and the share picture both use it). Nothing else is special-cased, so a new scene with a
// curved ground (a hill, a bridge, a wave) is a new function here and its drawing.
//
// Why the hands hold: a pair's two hands sit at the same height above the ground, each half a
// letter's pitch from its own letter, so by symmetry they stay level with each other; the curve
// only moves them a few units apart (a hill) or together (a dip). That is safe while the curve is
// gentle: a slope under about 12°, and a bend no tighter than a circle of about 1,500 units.
// ---------------------------------------------------------------------------------------------
export interface Footing {
  /** how far below the feet line this letter stands, in scene units */
  drop: number;
  /** how far it turns, in degrees: the ground's slope under it */
  deg: number;
}
export type Ground = (s: number) => Footing;
/** A ground from its height curve. */
export function groundOf(y: (s: number) => number): Ground {
  return (s) => ({ drop: y(s), deg: (Math.atan(y(s + 0.5) - y(s - 0.5)) * 180) / Math.PI });
}
/** The top of a circle of radius r: a small world, or a low hill. */
const dome = (r: number) => (s: number) => r - Math.sqrt(r * r - s * s);

/** Spring's knoll, and Outer Space's little planet. (A rope bridge's sag was drawn the same way in
 *  the proposal, as a proof that a dip works too; it comes with its scene, if it ever does.) */
const KNOLL = 3300;
const PLANET = 2000;
const knollY = dome(KNOLL);
const planetY = dome(PLANET);

export const GROUND: Partial<Record<SceneId, Ground>> = { spring: groundOf(knollY), space: groundOf(planetY) };


/**
 * The frame every card wears, over its art: an edge rule, a chain border in the rarity's ink, and
 * the window's rule. The rarity's mark is set into each corner, the way a note carries its number
 * in its corners, so the rarity is part of the frame and needs no box of its own.
 */
export function frame(L: CardLook, tier: Tier): string {
  const o = 13; // the edge rule
  const c = 33; // a corner piece's side
  const b0 = 17.5; // the border's band
  const bh = 20;
  const hx = o + c;
  const hw = W - 2 * hx;
  const vy = o + c;
  const vh = H - 2 * vy;
  const hl = hw / Math.round(hw / 23);
  const vl = vh / Math.round(vh / 23);
  // the game's own mark (lib/tierMark: three flat paths in a 20 × 20 box), set into the piece
  const m = 23;
  const mark = tierMarkPaths(tier)
    .map((q) => `<path d="${q.d}" fill="${q.fill}" opacity="${q.opacity}" stroke="${q.stroke}" stroke-width="${q.strokeWidth}" stroke-linejoin="round"/>`)
    .join("");
  const corner = (x: number, y: number) => `<rect x="${x}" y="${y}" width="${c}" height="${c}" rx="8" fill="${CARD_PAPER}" stroke="${L.ink}" stroke-width="2.2"/><g transform="translate(${n1(x + (c - m) / 2)} ${n1(y + (c - m) / 2)}) scale(${m / 20})">${mark}</g>`;
  return `<defs>
    ${chain("ct", hl, bh, L.ink, `translate(${hx} ${b0})`)}${chain("cb", hl, bh, L.ink, `translate(${hx} ${H - b0 - bh})`)}
    ${chain("cl", vl, bh, L.ink, `translate(${b0 + bh} ${vy}) rotate(90)`)}${chain("cr", vl, bh, L.ink, `translate(${W - b0} ${vy}) rotate(90)`)}</defs>
    ${rule(o, o, W - 2 * o, H - 2 * o, 18, L.ink, 2.4)}
    <rect x="${hx}" y="${b0}" width="${hw}" height="${bh}" fill="url(#ct)"/><rect x="${hx}" y="${H - b0 - bh}" width="${hw}" height="${bh}" fill="url(#cb)"/>
    <rect x="${b0}" y="${vy}" width="${bh}" height="${vh}" fill="url(#cl)"/><rect x="${W - b0 - bh}" y="${vy}" width="${bh}" height="${vh}" fill="url(#cr)"/>
    ${rule(WIN.x, WIN.y, WIN.w, WIN.h, WIN.r, L.ink, 3)}
    ${corner(o, o)}${corner(W - o - c, o)}${corner(o, H - o - c)}${corner(W - o - c, H - o - c)}`;
}


/** Scenes printed on a dark plate: the card's own light is shown fainter over them (white shows far
 *  more on navy than on a pale scene; globals.css, .cf-dark). */
export const DARK_SCENES: ReadonlySet<SceneId> = new Set<SceneId>(["space"]);

/** Each scene's art for the window. Only the stock card takes the rarity: a place has inks of its own. */
const ART: Record<SceneId, (L: CardLook) => string> = {
  stock,
  stage: () => stage(),
  trophy: () => trophy(),
  spring: () => spring(),
  bookshelf: () => bookshelf(),
  space: () => space(),
};

/** A scene's art (the window's picture) for a word of this rarity, as SVG markup for svgDoc. */
export function cardArt(scene: SceneId, tier: Tier): string {
  return ART[scene](CARD_LOOKS[tier]);
}

/** The frame for a word of this rarity, as SVG markup for svgDoc. */
export function cardFrame(tier: Tier): string {
  return frame(CARD_LOOKS[tier], tier);
}

/**
 * Where a letter stands: `s` is its centre, in card units from the card's centre. On level ground
 * that is the feet line, upright. On curved ground it is lowered to the curve and turned to it,
 * about its own feet.
 */
export function footingFor(scene: SceneId, s: number): Footing {
  return GROUND[scene]?.(s) ?? { drop: 0, deg: 0 };
}
