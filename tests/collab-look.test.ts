/**
 * A collab set's card look, as numbers (lib/collabLook.ts; decisions.md, "Collab sets", item 3).
 * The two colors are any two colors, so every color drawn from them is held to what must stay
 * readable on it: a tile's letter, a card's lettering on paper, cream type on the back. The spec's
 * test: "the card theme falls back safely on low-contrast colors".
 */
import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { BACK_TEXT, collabBack, collabCardLook, collabLooksOf, lookOf } from "@/lib/collabLook";
import { READS, SHOWS, contrast, luminance, mixHex } from "@/lib/contrast";
import { CARD_PAPER, GRAPHITE } from "@/lib/cardArt/looks";
import { FINISH, TILE_CASE, collabFinish, finishFor } from "@/lib/rarityFinish";
import { STANDARD_FIELDS, publicSets, type WordSet } from "@/lib/sets/rules";
import { collabWordsOf } from "@/lib/rarity";

/** Pairs chosen to break things: both dark, both pale, one of each, the same color twice, mid greys, pure hues. */
const HARD: [string, string][] = [
  ["#000000", "#000000"],
  ["#ffffff", "#ffffff"],
  ["#000000", "#ffffff"],
  ["#ffffff", "#000000"],
  ["#777777", "#777777"],
  ["#767676", "#959595"],
  ["#ffff00", "#fffde0"],
  ["#0000ff", "#ff0000"],
  ["#00ff00", "#ff00ff"],
  ["#1f6f8b", "#f2a65a"], // the test collab's
  ["#fcf7ea", "#f8efdd"], // the paper's and the tile's own colors
  ["#111827", "#2a1e1a"], // the two inks
];
/** A sweep of the color cube too: every corner and edge midpoint against every other. */
const GRID = ["00", "80", "ff"].flatMap((r) => ["00", "80", "ff"].flatMap((g) => ["00", "80", "ff"].map((b) => `#${r}${g}${b}`)));
const ALL: [string, string][] = [...HARD, ...GRID.flatMap((a) => GRID.map((b): [string, string] => [a, b]))];

describe("contrast", () => {
  it("is the WCAG ratio", () => {
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrast("#ffffff", "#000000")).toBeCloseTo(21, 5);
    expect(contrast("#777777", "#777777")).toBe(1);
    expect(contrast("#767676", "#ffffff")).toBeGreaterThanOrEqual(4.5); // the well-known lightest grey that reads on white
    expect(luminance("#ffffff")).toBeCloseTo(1, 5);
  });
});

describe("the tile: the letter always reads", () => {
  it("on both cases, at both ends of the tint and its middle, for any two colors", () => {
    for (const [a, b] of ALL) {
      const fin = collabFinish({ a, b });
      for (const k of ["upper", "lower"] as const) {
        for (const stop of fin.face) {
          const face = mixHex(TILE_CASE[k].face, stop, fin.alpha);
          expect(contrast(TILE_CASE[k].ink, face), `${a} ${b} ${k} ${stop} at ${fin.alpha}`).toBeGreaterThanOrEqual(READS);
        }
      }
    }
  });
  it("tints as strongly as the letter allows: pale colors keep the full tint, dark ones are thinned", () => {
    expect(collabFinish({ a: "#ffe9a6", b: "#c8f0ff" }).alpha).toBe(0.62);
    const dark = collabFinish({ a: "#000000", b: "#101010" });
    expect(dark.alpha).toBeLessThan(0.62); // thinned: at full strength a dark letter would sit on a dark tile
    expect(dark.alpha).toBeGreaterThan(0); // and still a tint
  });
  it("is a stock, not a material: its own kind, three stops from the two colors, and a calm beat", () => {
    const fin = collabFinish({ a: "#1f6f8b", b: "#f2a65a" });
    expect(fin.material).toBe("collab");
    expect(fin.face).toEqual(["#1f6f8b", mixHex("#1f6f8b", "#f2a65a", 0.5), "#f2a65a"]);
    expect(fin.period).toBeGreaterThan(0);
    for (const c of [fin.glow, fin.deep]) expect(c).toMatch(/^#[0-9a-f]{6}$/);
  });
  it("a tile is given it IN PLACE of a rarity: the two colors where a tier would go", () => {
    expect(finishFor({ a: "#1f6f8b", b: "#f2a65a" })).toEqual(collabFinish({ a: "#1f6f8b", b: "#f2a65a" }));
    expect(finishFor({ a: "#1f6f8b", b: "#f2a65a" })).toBe(finishFor({ a: "#1f6f8b", b: "#f2a65a" })); // worked out once a pair
    expect(finishFor("Legendary")).toBe(FINISH.Legendary); // a rarity is what it was
    expect(finishFor("Common")).toBeUndefined();
    expect(finishFor(undefined)).toBeUndefined();
  });
  it("uses the tile's own face and ink, as TileCharacter draws them", () => {
    const src = readFileSync(join(__dirname, "..", "src/components/game/TileCharacter.tsx"), "utf8");
    const named = (name: string) => new RegExp(`const ${name} = "(#[0-9a-fA-F]{6})"`).exec(src)?.[1];
    expect(TILE_CASE.lower).toEqual({ face: named("TILE_FACE"), ink: named("INK") });
    expect(TILE_CASE.upper.ink).toBe(named("LHAW_INK"));
    expect(src).toContain('const faceFill = upper ? "#ffffff" : TILE_FACE;');
  });
});

describe("the card's front: the lettering always reads on the paper", () => {
  it("for any two colors: the ink on paper, the ink on the ribbon's tails, and the diamonds show", () => {
    for (const [a, b] of ALL) {
      const L = collabCardLook({ a, b });
      expect(contrast(L.ink, CARD_PAPER), `ink ${a} ${b}`).toBeGreaterThanOrEqual(READS);
      expect(contrast(L.ink, L.ground), `tails ${a} ${b}`).toBeGreaterThanOrEqual(READS);
      expect(contrast(L.accent, CARD_PAPER), `accent ${a} ${b}`).toBeGreaterThanOrEqual(SHOWS);
      for (const c of [L.ink, L.tint, L.tint2, L.ground, L.accent]) expect(c).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
  it("keeps a color that already reads, darkens one that doesn't, and never leaves the two colors' wash", () => {
    expect(collabCardLook({ a: "#1f6f8b", b: "#f2a65a" }).ink).toBe("#1f6f8b"); // the darker of the two reads as it is
    const pale = collabCardLook({ a: "#fff6c9", b: "#e8fbff" });
    expect(pale.ink).not.toBe("#fff6c9");
    expect(contrast(pale.ink, CARD_PAPER)).toBeGreaterThanOrEqual(READS);
    expect(pale.tint).toBe("#fff6c9"); // the wash is still the partner's colors
    expect(pale.tint2).toBe("#e8fbff");
    expect(GRAPHITE).toMatch(/^#/); // the last resort exists; darkening reaches it for no color in the sweep above
  });
});

describe("the card's back: cream type always reads", () => {
  it("for any two colors: on both grounds, and the frame's line shows on both", () => {
    for (const [a, b] of ALL) {
      const B = collabBack({ a, b });
      for (const ground of [B.base, B.base2]) {
        expect(contrast(BACK_TEXT, ground), `text ${a} ${b}`).toBeGreaterThanOrEqual(7);
        expect(contrast(B.line, ground), `line ${a} ${b}`).toBeGreaterThanOrEqual(READS); // it letters the rarity's name and "No."
      }
      expect(B.rack).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
  it("a deep color is kept as it is; a pale one is deepened", () => {
    expect(collabBack({ a: "#10243a", b: "#2a0f1f" }).base).toBe("#10243a");
    expect(luminance(collabBack({ a: "#ffe9a6", b: "#c8f0ff" }).base)).toBeLessThan(luminance("#ffe9a6"));
  });
});

describe("the one lookup: a word to its look", () => {
  const five = ["CRANE", "MOTEL", "GRAPE", "BLAZE", "QUILT"];
  const set = (id: number, status: WordSet["status"], type: WordSet["type"], words: string[]): WordSet => ({
    id, name: `S${id}`, status, revealAt: null, releaseAt: null, gateHours: 24, perPlayerLimit: 1, sort: id,
    revealedAt: null, releasedAt: null, gateUntil: null, releaseBlock: null, releaseRoot: null,
    words: words.map((word) => ({ word, headliner: false })),
    ...STANDARD_FIELDS, type,
    ...(type === "collab" ? { partnerName: "Test partner", partnerUrl: "https://partner.example/", colorA: "#1f6f8b", colorB: "#f2a65a", stampAt: new Date(1_800_000_000_000) } : {}),
  });
  it("gives every word of a revealed or released collab set its set's look; a draft and a standard set give none", () => {
    const sets = [set(1, "draft", "collab", ["ABOUT"]), set(2, "revealed", "collab", five), set(3, "released", "standard", ["OTHER"])];
    const looks = collabLooksOf(publicSets(sets));
    expect([...looks.keys()].sort()).toEqual([...five].sort());
    expect(looks.get("CRANE")).toEqual({
      setId: 2, partner: "Test partner", url: "https://partner.example/", a: "#1f6f8b", b: "#f2a65a",
      stamp: "/api/sets/2/stamp?v=1800000000", mark: "2-1800000000",
    });
    expect(looks.get("ABOUT")).toBeUndefined();
    expect(looks.get("OTHER")).toBeUndefined();
  });
  it("holds exactly the words the rarity layer raises (one membership, asked two ways)", () => {
    for (const status of ["draft", "revealed", "released"] as const) {
      for (const type of ["standard", "collab"] as const) {
        const sets = [set(1, status, type, five)];
        expect([...collabLooksOf(publicSets(sets)).keys()].sort(), `${status} ${type}`).toEqual([...collabWordsOf(sets).keys()].sort());
      }
    }
  });
  it("the mark for a picture's address names the set and its stamp, so a new stamp is a new address", () => {
    const c = { partner: "P", url: null, colorA: "#112233", colorB: "#aabbcc" };
    expect(lookOf(7, { ...c, stamp: "/api/sets/7/stamp?v=123" }).mark).toBe("7-123");
    expect(lookOf(7, { ...c, stamp: "/api/sets/7/stamp?v=456" }).mark).toBe("7-456");
    expect(lookOf(7, { ...c, stamp: null }).mark).toBe("7-0");
  });
});
