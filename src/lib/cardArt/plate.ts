/**
 * A card's back, as an engraved plate (decisions.md #58, part 2).
 *
 * starl3xx, 2026-11-27: "the cards have *reflections* but they shouldn't be super *shiny* -- the
 * cards are matte finish"; "the 'paper' is like a playing card, and playing card backs are another
 * source of inspo, along with like US dollar bills, especially the engraving and filigree"; and,
 * of three directions drawn for him, "13A dark plate is definitely the way to go".
 *
 * So a back is paper and ink. It is printed solid in a dark ink, and its engraving is in a light
 * ink of the same family. A rarity is told by its INKS, never by a material: the backs were walnut, satin, brushed foil, polished gold, and a cut gem,
 * with a hot spot and glitter (decisions.md #25, #26), and this replaces them.
 *
 * THERE ARE TWO BORDERS, AND ONLY TWO:
 *   "rules"  Common's: plain rules, round a ruled ground (fine even lines that make a tone)
 *   "lace"   every other back's, THE SAME ON ALL OF THEM: a band of lace (braided waves, as on a
 *            banknote's edge) with a lathe medallion in each corner
 * As first built, each rarity added engraving of its own, and Legendary and Mythic had filigree
 * in their corners in place of the medallions, with a lace cut short to make room. starl3xx, the
 * day it shipped: "the 'border of lace' on uncommon and rare should be the border on the back of
 * every one but common". So Uncommon, Rare, Legendary, Mythic, and a collab set's back carry one
 * drawing, and differ only in their inks. Never give a rarity a border of its own again.
 *
 * Mythic's ink changes along the card (`blend`): a banknote's "rainbow printing", one plate with
 * the ink blended across it. It is an ink, so it is Mythic's to keep, and it is printed, so it
 * never moves.
 *
 * THE GAME'S EMBLEM IS THE SAME ON EVERY RARITY, AND THE PLATE DRAWS NOTHING ROUND IT. As first
 * built, Rare, Legendary, and Mythic turned one, two, and three rings of lathe work around the seal.
 * starl3xx, the day it shipped: "I don't like the Lexigotchi emblem on the back getting more rings
 * for more rarity... I think that should look the same on all rarities, standard". So the seal
 * stands alone on every back, as it always had before the plates. Never mark a rarity on, in, or
 * around the emblem.
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

/** A plate's border: Common's plain rules, or the lace every other back carries (the note at the top). */
export type PlateEdge = "rules" | "lace";

export interface PlateInks {
  /** The dark ink the back is printed solid in. */
  ground: string;
  /** A second dark ink for the border, where a plate is printed in two (a collab set's two colors). Without it the border is the ground's. */
  band?: string;
  /** The light ink of its engraving. */
  line: string;
  /** A second light ink: the far end of a blended ink (Mythic's). A plate with no blend never draws in it. */
  second: string;
}

/**
 * Where the game's seal sits on a back, in card units: its centre and its width, the same on every
 * rarity. It stands inside the plate's field, clear of the border, so the styles (globals.css,
 * .cb-seal) and the server's picture of a back (app/s/[text]/back) place it by these
 * (tests/matte-cards.test.ts holds them equal). The plate itself draws nothing here.
 */
export const PLATE_SEAL = { cx: 868, cy: 337.5, d: 400 } as const;

/**
 * The plate's border, in card units from the card's edge: the edge rule, the band the lace runs in,
 * and where the field inside the border begins. The lettering is set inside the field.
 */
export const PLATE_BORDER = { edge: 16, lace: [25, 55], field: 63 } as const;

/** How strong the fine engraving (the lace) is over its ground, of 1. */
const SOFT = 0.62;

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

/**
 * A back's plate: its ground and its engraving, as SVG markup for svgDoc (the card's size,
 * CARD_W × CARD_H).
 *
 * - `edge`: its border, "rules" or "lace" (above).
 * - `inks`: the plate's own. A rarity's are in components/cards/material; a collab set's are its
 *   two colors (lib/collabLook). The drawing never knows which.
 * - `blend`: the line ink changes along the card, from `line` to `second` and back (Mythic's
 *   rainbow printing). Without it every line is `line`.
 */
export function backPlate(edge: PlateEdge, inks: PlateInks, blend = false): string {
  const W = CARD_W, H = CARD_H;
  const A = inks.line, B = inks.second;
  const defs: string[] = [];
  const out: string[] = [`<rect width="${W}" height="${H}" fill="${inks.ground}"/>`];
  const border = inks.band ?? inks.ground;
  let stroke = A;
  if (blend) {
    defs.push(`<linearGradient id="iris" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="${W}" y2="${H}"><stop offset="0" stop-color="${A}"/><stop offset="0.5" stop-color="${B}"/><stop offset="1" stop-color="${A}"/></linearGradient>`);
    stroke = "url(#iris)";
  }
  const o = PLATE_BORDER.edge, [lo, li] = PLATE_BORDER.lace, inner = PLATE_BORDER.field;
  // a border printed in its own ink: everything outside the field's outer hairline
  if (inks.band) out.push(`<path fill-rule="evenodd" fill="${inks.band}" d="M0 0H${W}V${H}H0ZM${inner - 6 + 11} ${inner - 6}h${W - 2 * inner + 12 - 22}a11 11 0 0 1 11 11v${H - 2 * inner + 12 - 22}a11 11 0 0 1 -11 11h${-(W - 2 * inner + 12 - 22)}a11 11 0 0 1 -11 -11v${-(H - 2 * inner + 12 - 22)}a11 11 0 0 1 11 -11Z"/>`);
  const turn = (ref: string, n: number, span: number, cx: number, cy: number) => Array.from({ length: n }, (_, t) => `<use href="#${ref}" xlink:href="#${ref}" transform="rotate(${n1((t * span) / n)} ${cx} ${cy})"/>`).join("");
  // the ruled ground: an engraver's tone, fine and even (and never finer: the note at the top says why)
  defs.push(`<pattern id="rule" width="11" height="11" patternUnits="userSpaceOnUse"><line x1="0" y1="5.5" x2="11" y2="5.5" stroke="${A}" stroke-width="1.5"/></pattern>`);
  out.push(`<rect x="${inner}" y="${inner}" width="${W - 2 * inner}" height="${H - 2 * inner}" rx="8" fill="url(#rule)" opacity="${n1(0.3 * SOFT * 10) / 10}"/>`);
  // the border: rules, and on every back but Common's a band of lace between them
  out.push(`<rect x="${o}" y="${o}" width="${W - 2 * o}" height="${H - 2 * o}" rx="18" fill="none" stroke="${stroke}" stroke-width="3.2"/><rect x="${o + 6}" y="${o + 6}" width="${W - 2 * o - 12}" height="${H - 2 * o - 12}" rx="13" fill="none" stroke="${stroke}" stroke-width="0.9"/>`);
  out.push(`<rect x="${inner - 6}" y="${inner - 6}" width="${W - 2 * inner + 12}" height="${H - 2 * inner + 12}" rx="11" fill="none" stroke="${stroke}" stroke-width="0.9"/><rect x="${inner}" y="${inner}" width="${W - 2 * inner}" height="${H - 2 * inner}" rx="8" fill="none" stroke="${stroke}" stroke-width="2"/>`);
  if (edge === "lace") {
    const mid = (lo + li) / 2, amp = (li - lo) / 2 - 2;
    // the lace stops just short of each corner, where a medallion closes it
    const gap = 22;
    const x0 = li + gap, x1 = W - li - gap, y0 = li + gap, y1 = H - li - gap;
    // two braids of different pitch cross, as on a note's border
    const fine = lace(x0, mid, x1, mid, amp, 30, 3) + lace(x0, H - mid, x1, H - mid, amp, 30, 3) + lace(mid, y0, mid, y1, amp, 15, 3) + lace(W - mid, y0, W - mid, y1, amp, 15, 3);
    const slow = lace(x0, mid, x1, mid, amp, 10, 2) + lace(x0, H - mid, x1, H - mid, amp, 10, 2) + lace(mid, y0, mid, y1, amp, 5, 2) + lace(W - mid, y0, W - mid, y1, amp, 5, 2);
    out.push(`<path d="${fine}" fill="none" stroke="${stroke}" stroke-width="1.15" opacity="${SOFT}"/><path d="${slow}" fill="none" stroke="${stroke}" stroke-width="1.5" opacity="${SOFT}"/>`);
    [[mid + 2, mid + 2], [W - mid - 2, mid + 2], [mid + 2, H - mid - 2], [W - mid - 2, H - mid - 2]].forEach(([x, y], n) => {
      defs.push(`<path id="c${n}" d="${rosette(x, y, 15, 5.5, 8, 120)}"/>`);
      out.push(`<circle cx="${x}" cy="${y}" r="23.5" fill="${border}" stroke="${stroke}" stroke-width="1.6"/><g fill="none" stroke="${stroke}" stroke-width="0.9">${turn(`c${n}`, 4, 45, x, y)}</g><circle cx="${x}" cy="${y}" r="4" fill="${A}"/>`);
    });
  } else {
    out.push(`<rect x="${(lo + li) / 2}" y="${(lo + li) / 2}" width="${W - lo - li}" height="${H - lo - li}" rx="12" fill="none" stroke="${stroke}" stroke-width="0.9"/>`);
  }
  return `<defs>${defs.join("")}</defs>${out.join("")}`;
}
