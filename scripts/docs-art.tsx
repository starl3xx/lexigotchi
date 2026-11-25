/**
 * Draws the player docs' pictures (docs-site/images/*.svg) from the game's own character rig, so
 * the docs show exactly what the game shows. Run `npm run docs:art` after changing the rig, a
 * figure below, or the fee splits, and commit the SVGs it writes.
 *
 * Each file is one standalone SVG:
 * - It sits on a paper card with the game's ink outline and offset shadow, so the ink-colored arms,
 *   legs, and eyes read on the docs' dark theme as well as the light one.
 * - It animates with the rig's own keyframes, read from tailwind.config.ts, and stops under
 *   prefers-reduced-motion.
 * - Labels use a system font, because an SVG shown as an <img> can't load web fonts.
 */
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { stageName } from "@/lib/ascension";

(globalThis as unknown as { React: typeof React }).React = React;
const { TileCharacter } = await import("@/components/game/TileCharacter");
const { DEFAULT_PARAMS } = await import("@/lib/params");
const { default: tailwind } = await import("../tailwind.config");
type TileState = import("@/components/game/TileCharacter").TileState;
type Gild = import("@/components/game/TileCharacter").Gild;
type Tier = import("@/lib/economy").Tier;

const OUT = join(process.cwd(), "docs-site", "images");
const INK = "#1b1714";
const CARD = "#fbf4e3";
const FONT = `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif`;
const COLORS = { burn: "#bd3d35", pool: "#2a9d8f", jackpot: "#e0a93b", treasury: "#6f4e10" };

// ── the rig's keyframes, from tailwind.config.ts ────────────────────────────────────────────────
type Frames = Record<string, Record<string, string>>;
const theme = (tailwind as { theme: { extend: { keyframes: Record<string, Frames>; animation: Record<string, string> } } }).theme.extend;
const kebab = (s: string) => s.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
const ANIMATION_CSS = Object.entries(theme.animation)
  .filter(([name]) => name.startsWith("tc-"))
  .map(([name, value]) => {
    const frames = theme.keyframes[value.split(" ")[0]];
    const body = Object.entries(frames)
      .map(([at, decl]) => `${at}{${Object.entries(decl).map(([k, v]) => `${kebab(k)}:${v}`).join(";")}}`)
      .join("");
    return `@keyframes ${value.split(" ")[0]}{${body}}.animate-${name}{animation:${value}}`;
  })
  .join("\n");
const STYLE = `<style>
${ANIMATION_CSS}
@media (prefers-reduced-motion: reduce){[class*="animate-tc-"]{animation:none!important}}
text{font-family:${FONT};fill:${INK}}
</style>`;

// ── layout ──────────────────────────────────────────────────────────────────────────────────────
interface Ch {
  ch: string;
  upper?: boolean;
  state?: TileState;
  gild?: Gild;
  /** the word's rarity, worn as the tile's finish (its light never passes in a picture: nothing adds .rf-moment) */
  tier?: Tier;
}
interface Group {
  chars: Ch[];
  size: number;
  label?: string;
  sub?: string;
}
interface Placed {
  w: number;
  h: number;
  draw: (x: number, y: number) => string;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

let drawn = 0;

/**
 * One character from the real rig, as a nested <svg> placed at (x, y).
 *
 * Each character is rendered on its own, so React's useId gives every one the same ids (the eye
 * clips). In one file, a url(#id) would then resolve to the FIRST character's clip, and a hungry
 * word could borrow a full word's eyes. Every id gets a per-character prefix.
 */
function character(c: Ch, size: number): Placed {
  const html = renderToStaticMarkup(
    <TileCharacter char={c.ch} upper={c.upper ?? false} state={c.state ?? "idle"} gild={c.gild ?? 0} size={size} detail="full" tier={c.tier} />,
  );
  let svg = html.match(/<svg[\s\S]*<\/svg>/)![0].replace(/ class="overflow-visible"/, ' overflow="visible"');
  const prefix = `c${drawn++}-`;
  for (const id of new Set([...svg.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]))) {
    svg = svg.split(`id="${id}"`).join(`id="${prefix}${id}"`).split(`#${id})`).join(`#${prefix}${id})`).split(`"#${id}"`).join(`"#${prefix}${id}"`);
  }
  const w = Number(svg.match(/width="([\d.]+)"/)![1]);
  const h = Number(svg.match(/height="([\d.]+)"/)![1]);
  return { w, h, draw: (x, y) => svg.replace("<svg", `<svg x="${x.toFixed(1)}" y="${y.toFixed(1)}"`) };
}

/** A word (or one letter) with an optional label and sub-label centered under it. */
function group(g: Group): Placed {
  const parts = g.chars.map((c) => character(c, g.size));
  const overlap = Math.round(g.size * -0.1); // the rig's tiles sit shoulder to shoulder
  const wordW = parts.reduce((s, p) => s + p.w, 0) + overlap * (parts.length - 1);
  const charH = Math.max(...parts.map((p) => p.h));
  const textH = (g.label ? 24 : 0) + (g.sub ? 20 : 0);
  const textW = Math.max((g.label?.length ?? 0) * 9.6, (g.sub?.length ?? 0) * 7.8);
  const w = Math.max(wordW, textW);
  return {
    w,
    h: charH + textH,
    draw: (x, y) => {
      let cx = x + (w - wordW) / 2;
      let out = "";
      for (const p of parts) {
        out += p.draw(cx, y + charH - p.h);
        cx += p.w + overlap;
      }
      const mid = x + w / 2;
      if (g.label) out += `<text x="${mid}" y="${y + charH + 19}" text-anchor="middle" font-size="16" font-weight="800">${esc(g.label)}</text>`;
      if (g.sub) out += `<text x="${mid}" y="${y + charH + (g.label ? 39 : 19)}" text-anchor="middle" font-size="13" font-weight="600" opacity="0.65">${esc(g.sub)}</text>`;
      return out;
    },
  };
}

const ARROW_W = 34;
const arrow = (x: number, y: number) =>
  `<path d="M${x + 6} ${y}h${ARROW_W - 14}m-7 -7l7 7l-7 7" fill="none" stroke="${INK}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" opacity="0.55"/>`;

/** Rows of groups on a paper card. `arrows` puts an arrow between the groups of each row. */
function figure(rows: Group[][], opts: { gap?: number; rowGap?: number; arrows?: boolean; title: string }): string {
  const gap = opts.gap ?? 36;
  const rowGap = opts.rowGap ?? 26;
  const placed = rows.map((r) => r.map(group));
  const between = opts.arrows ? ARROW_W + 16 : gap;
  const rowW = placed.map((r) => r.reduce((s, p) => s + p.w, 0) + between * (r.length - 1));
  const rowH = placed.map((r) => Math.max(...r.map((p) => p.h)));
  const padX = 34, top = 18, bottom = 26; // the rig's own box already leaves room for jumps and confetti
  const W = Math.ceil(Math.max(...rowW) + padX * 2);
  const H = Math.ceil(top + rowH.reduce((s, h) => s + h, 0) + rowGap * (rows.length - 1) + bottom);
  let y = top;
  let body = "";
  placed.forEach((r, i) => {
    let x = (W - rowW[i]) / 2;
    r.forEach((p, j) => {
      body += p.draw(x, y + (rowH[i] - p.h));
      x += p.w;
      if (j < r.length - 1) {
        if (opts.arrows) body += arrow(x + 8, y + (rowH[i] - p.h) + p.h * 0.42);
        x += between;
      }
    });
    y += rowH[i] + rowGap;
  });
  return card(W, H, body, opts.title);
}

function card(W: number, H: number, body: string, title: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img"><title>${esc(title)}</title>${STYLE}<rect x="6" y="6" width="${W - 8}" height="${H - 8}" rx="24" fill="${INK}"/><rect x="2" y="2" width="${W - 8}" height="${H - 8}" rx="24" fill="${CARD}" stroke="${INK}" stroke-width="3"/>${body}</svg>`;
}

/** Where each fee goes, as one stacked bar per fee, from the game's split table. */
function feeChart(): string {
  const s = DEFAULT_PARAMS.splits;
  // Rewards first (decisions.md #19): every paid action splits the same; snacks are 100% burned.
  const rows: [string, { burn: number; pool: number; jackpot: number; treasury: number }][] = [
    ["Pack", s.packMint],
    ["Roll", s.roll],
    ["Claim", s.claim],
    ["Ascend", s.prestige ?? s.roll],
    ["Snack", s.snack],
  ];
  const keys = ["burn", "pool", "jackpot", "treasury"] as const;
  const names = { burn: "Burned", pool: "Rewards Pool", jackpot: "Jackpot", treasury: "Treasury" };
  const W = 640, labelW = 78, barX = 34 + labelW, barW = W - barX - 40, barH = 34, top = 92;
  let body = "";
  // legend
  let lx = 34;
  for (const k of keys) {
    body += `<rect x="${lx}" y="34" width="16" height="16" rx="4" fill="${COLORS[k]}" stroke="${INK}" stroke-width="2"/>`;
    body += `<text x="${lx + 24}" y="47" font-size="15" font-weight="700">${names[k]}</text>`;
    lx += 24 + names[k].length * 8.6 + 26;
  }
  rows.forEach(([label, split], i) => {
    const y = top + i * (barH + 18);
    body += `<text x="34" y="${y + barH / 2 + 6}" font-size="16" font-weight="800">${label}</text>`;
    let x = barX;
    // the segments are square; clipping them to the row's rounded outline rounds the bar's ends
    body += `<clipPath id="fee-row-${i}"><rect x="${barX}" y="${y}" width="${barW}" height="${barH}" rx="8"/></clipPath><g clip-path="url(#fee-row-${i})">`;
    for (const k of keys) {
      const w = split[k] * barW;
      if (w <= 0) continue;
      body += `<rect x="${x}" y="${y}" width="${w}" height="${barH}" fill="${COLORS[k]}"/>`;
      if (w >= 44) {
        const pct = `${Math.round(split[k] * 1000) / 10}%`;
        const fill = k === "jackpot" ? INK : CARD;
        body += `<text x="${x + w / 2}" y="${y + barH / 2 + 5}" text-anchor="middle" font-size="14" font-weight="800" style="fill:${fill}">${pct}</text>`;
      }
      x += w;
    }
    body += `</g><rect x="${barX}" y="${y}" width="${barW}" height="${barH}" rx="8" fill="none" stroke="${INK}" stroke-width="3"/>`;
  });
  const H = top + rows.length * (barH + 18) + 14;
  return card(W, H, body, "Where each fee goes: burned, Rewards Pool, jackpot, and treasury");
}

// ── the figures ─────────────────────────────────────────────────────────────────────────────────
const word = (w: string, o: Omit<Ch, "ch"> | ((i: number) => Omit<Ch, "ch">) = {}): Ch[] =>
  [...w].map((ch, i) => ({ ch, ...(typeof o === "function" ? o(i) : o) }));
const mult = (lvl: number) => `×${(DEFAULT_PARAMS.prestige.yieldMultPerLevel ** lvl).toFixed(2)} share`;
const pctOf = (p: number) => `${Math.round(p * 100)}%`;

const FIGURES: Record<string, string> = {
  "hero-heyoo.svg": figure([[{ chars: word("heyoo", { upper: true, state: "celebrate" }), size: 104 }]], {
    title: "Five letter characters spelling HEYOO, celebrating",
  }),
  "letters-cases.svg": figure(
    [[
      { chars: [{ ch: "a" }], size: 112, label: "lowercase", sub: "how every letter arrives" },
      { chars: [{ ch: "a", upper: true, state: "upgrade" }], size: 112, label: "UPPERCASE", sub: "after a roll hits" },
    ]],
    { arrows: true, title: "A lowercase a, and the same letter raised to UPPERCASE" },
  ),
  "grails.svg": figure([[{ chars: word("vzxjq"), size: 84, label: "The grails", sub: "V, Z, X, J, and Q: the rarest letters" }]], {
    title: "The five rarest letters, V, Z, X, J, and Q",
  }),
  "roll.svg": figure(
    [[
      { chars: [{ ch: "t" }], size: 104, label: "Your letter", sub: "lowercase" },
      { chars: [{ ch: "t", state: "rolling" }], size: 104, label: "Rolling", sub: `${pctOf(DEFAULT_PARAMS.roll.baseSuccess)} on the first try` },
      { chars: [{ ch: "t", upper: true, state: "upgrade" }], size: 104, label: "A hit", sub: "UPPERCASE" },
    ]],
    { arrows: true, title: "A roll: a lowercase t, rolling, then raised to UPPERCASE" },
  ),
  "word-case.svg": figure(
    [
      [{ chars: word("crane"), size: 70, label: "lowercase", sub: "no letters raised" }],
      [{ chars: word("crane", (i) => ({ upper: i < 3 })), size: 70, label: "3/5 raised", sub: "some letters raised" }],
      [{ chars: word("crane", { upper: true }), size: 70, label: "UPPERCASE", sub: "all five raised: it earns $WORD" }],
    ],
    { title: "The word crane in three cases: lowercase, three of five raised, and all UPPERCASE" },
  ),
  "crown.svg": figure([[{ chars: word("jazzy", { upper: true, state: "celebrate", tier: "Mythic" }), size: 92, label: "JAZZY", sub: "the rarest word: Mythic" }]], {
    title: "JAZZY, the rarest word, celebrating in its Mythic amethyst",
  }),
  "finishes.svg": figure(
    [
      (
        [
          ["Common", "plain"],
          ["Uncommon", "satin jade"],
          ["Rare", "sapphire foil"],
          ["Legendary", "polished gold"],
          ["Mythic", "cut amethyst"],
        ] as [Tier, string][]
      ).map(([tier, sub]) => ({ chars: [{ ch: "a", tier }], size: 96, label: tier, sub })),
    ],
    { gap: 22, title: "The letter a in each tier’s finish: Common plain, Uncommon satin jade, Rare sapphire foil, Legendary polished gold, Mythic cut amethyst" },
  ),
  "moods.svg": figure(
    [
      [
        { chars: word("tease"), size: 68, label: "Full", sub: "fed in the last day" },
        { chars: word("tease", { state: "peckish" }), size: 68, label: "Peckish", sub: "1 to 2 days unfed" },
      ],
      [
        { chars: word("tease", { state: "hungry" }), size: 68, label: "Hungry", sub: "3 or more days unfed" },
        { chars: word("tease", { state: "eating" }), size: 68, label: "Eating", sub: "a snack makes it full" },
      ],
    ],
    { gap: 44, title: "The word tease full, peckish, hungry, and eating a snack" },
  ),
  "jackpot.svg": figure([[{ chars: word("lucky", { state: "celebrate" }), size: 96, label: "Today’s secret word", sub: "its owner takes the whole pot" }]], {
    title: "The word lucky celebrating a jackpot win",
  }),
  "ascension.svg": figure(
    [[0, 1, 2, 3, 4, 5].map((g) => ({
      chars: [{ ch: "w", upper: true, gild: g as Gild }],
      size: 80,
      label: stageName(g),
      sub: g === 0 ? "where it starts" : mult(g),
    }))],
    { arrows: true, title: "An UPPERCASE W ascending through four gilded stages, then Holographic" },
  ),
  "fees.svg": feeChart(),
};

mkdirSync(OUT, { recursive: true });
for (const [name, svg] of Object.entries(FIGURES)) writeFileSync(join(OUT, name), svg);
console.log(`wrote ${Object.keys(FIGURES).length} images to docs-site/images`);
