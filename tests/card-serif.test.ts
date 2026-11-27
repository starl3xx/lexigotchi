/**
 * The card's serif is Source Serif 4, shipped (decisions.md #52; starl3xx, 2026-11-27: "let's go
 * 3H for consistency"): one face for every player and on the server's pictures.
 *
 * It was a device font: Iowan Old Style on Apple devices, the device's own serif elsewhere, and a
 * third face on the server's pictures. A tester on Windows never saw what a Mac shows.
 */
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { CARD_SERIF, CARD_SERIF_FILE } from "@/app/_og/wordCard";

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const css = read("src/app/globals.css");

describe("the card's serif", () => {
  it("is shipped: two web files for the game, one plain file for the pictures, and its license", () => {
    for (const f of ["sourceserif4-roman.woff2", "sourceserif4-italic.woff2", "sourceserif4-bold.ttf", "sourceserif4-LICENSE.txt"]) expect(existsSync(join(ROOT, "public/fonts", f)), f).toBe(true);
    expect(read("public/fonts/sourceserif4-LICENSE.txt")).toContain("SIL Open Font License, Version 1.1");
    // a font file is what it says: woff2 for the browser, TrueType for the picture renderer
    expect(readFileSync(join(ROOT, "public/fonts/sourceserif4-roman.woff2")).subarray(0, 4).toString("latin1")).toBe("wOF2");
    expect(readFileSync(join(ROOT, "public/fonts/sourceserif4-bold.ttf")).readUInt32BE(0)).toBe(0x00010000);
    // the page's first download stays small: each web file under 150 KB
    for (const f of ["sourceserif4-roman.woff2", "sourceserif4-italic.woff2"]) expect(statSync(join(ROOT, "public/fonts", f)).size, f).toBeLessThan(150_000);
  });

  it("is the first face of the card's serif in the game, with every weight and both styles declared", () => {
    expect(css).toMatch(/--font-card:\s*"Source Serif 4",/);
    const faces = [...css.matchAll(/@font-face \{ font-family: "Source Serif 4"; src: url\("\/fonts\/(sourceserif4-\w+\.woff2)"\) format\("woff2"\); font-weight: 200 900; font-style: (normal|italic); font-display: swap; \}/g)];
    expect(faces.map((m) => `${m[1]} ${m[2]}`)).toEqual(["sourceserif4-roman.woff2 normal", "sourceserif4-italic.woff2 italic"]);
  });

  it("is the same face on every picture the server draws, loaded from one named file", () => {
    expect(CARD_SERIF).toBe("Source Serif 4");
    expect(CARD_SERIF_FILE).toBe("public/fonts/sourceserif4-bold.ttf");
    for (const route of ["src/app/s/[text]/card/route.tsx", "src/app/s/[text]/back/route.tsx", "src/app/e/[token]/card/route.tsx"]) {
      const src = read(route);
      expect(src, route).toContain("readFileSync(join(process.cwd(), CARD_SERIF_FILE))");
      expect(src, route).toMatch(/\{ name: (CARD_SERIF|SERIF), data: serifBold, weight: 700, style: "normal" \}/);
    }
    // the file's path is a value, not text the build can follow, so every route that reads it names it
    const config = read("next.config.mjs");
    for (const route of ["/s/[text]/card", "/s/[text]/back", "/e/[token]/card"]) expect(config, route).toContain(`"${route}": ["./public/fonts/soehne-*.ttf", "./public/fonts/sourceserif4-bold.ttf"]`);
  });

  it("left no other serif behind in the code that draws", () => {
    const walk = (d: string): string[] => readdirSync(join(ROOT, d)).flatMap((f) => (statSync(join(ROOT, d, f)).isDirectory() ? walk(`${d}/${f}`) : [`${d}/${f}`]));
    for (const f of [...walk("src/app"), ...walk("src/components"), "next.config.mjs"].filter((p) => /\.(tsx?|mjs|css)$/.test(p))) expect(read(f), f).not.toMatch(/pagella/i);
    expect(readdirSync(join(ROOT, "public/fonts")).filter((f) => /pagella/i.test(f))).toEqual([]);
  });
});
