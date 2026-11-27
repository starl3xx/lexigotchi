/**
 * The placeholder collab set for a TEST network (decisions.md, "Collab sets", item 7): "Test
 * collab", two arbitrary colors, a plain stamp, and five dictionary words. It exists so testers can
 * see a collab card and the owner can review it. It names no real partner, and it is never made on
 * mainnet (the admin action refuses there).
 *
 * The five words are picked when the set is made, never written here: a set's words are private
 * until it is revealed, and this file is public.
 */
import { deflateSync } from "node:zlib";
import type { Tier } from "@/lib/economy";
import { COLLAB_WORDS } from "./rules";

export const TEST_COLLAB = {
  name: "Test collab",
  partnerName: "Test partner",
  /** Arbitrary: a deep teal and a warm amber. No partner's colors. */
  colorA: "#1f6f8b",
  colorB: "#f2a65a",
} as const;

/**
 * Pick the five words from `candidates` (words in no set, not held back, and owned by nobody). One
 * Mythic word when there is one, so the test set also shows "a higher rarity is kept"; the rest
 * from the tiers below Legendary, where the collab's Legendary rarity is a visible change.
 * `pick` chooses an index (random in the app, fixed in tests). Null: not enough words.
 */
export function pickTestWords(candidates: readonly string[], tierOf: (w: string) => Tier, pick: (n: number) => number = (n) => Math.floor(Math.random() * n)): string[] | null {
  const take = (from: string[], n: number): string[] => {
    const pool = from.slice();
    const out: string[] = [];
    while (out.length < n && pool.length > 0) out.push(pool.splice(pick(pool.length), 1)[0]);
    return out;
  };
  const mythic = take(candidates.filter((w) => tierOf(w) === "Mythic"), 1);
  const lower = candidates.filter((w) => tierOf(w) !== "Mythic" && tierOf(w) !== "Legendary");
  const rest = take(lower, COLLAB_WORDS - mythic.length);
  const words = [...mythic, ...rest];
  return words.length === COLLAB_WORDS ? words.sort() : null;
}

// --- the plain stamp ---------------------------------------------------------------------------

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/**
 * A plain placeholder stamp, drawn here so no picture file ships: a ring with a dot at its centre,
 * graphite on clear, 96 px square. A stamp is drawn as it is given (a partner's mark has its own
 * colors), so the placeholder is dark: it shows on the stock card's pale paper.
 */
export function placeholderStamp(size = 96): Uint8Array {
  const raw = new Uint8Array(size * (size * 4 + 1));
  const mid = (size - 1) / 2;
  // How much of a pixel lies inside a band from radius `a` to `b` (one-pixel soft edges).
  const band = (r: number, a: number, b: number) => Math.max(0, Math.min(1, r - a + 0.5)) * Math.max(0, Math.min(1, b - r + 0.5));
  for (let y = 0; y < size; y++) {
    const row = y * (size * 4 + 1);
    raw[row] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const r = Math.hypot(x - mid, y - mid);
      const alpha = Math.max(band(r, size * 0.36, size * 0.46), band(r, 0, size * 0.13));
      const at = row + 1 + x * 4;
      raw[at] = 0x3a; // graphite (cardArt/looks.ts GRAPHITE)
      raw[at + 1] = 0x37;
      raw[at + 2] = 0x34;
      raw[at + 3] = Math.round(alpha * 255);
    }
  }
  const head = new Uint8Array(13);
  const view = new DataView(head.buffer);
  view.setUint32(0, size);
  view.setUint32(4, size);
  head[8] = 8; // bit depth
  head[9] = 6; // RGBA
  const parts = [Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a), chunk("IHDR", head), chunk("IDAT", deflateSync(raw)), chunk("IEND", new Uint8Array(0))];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}
