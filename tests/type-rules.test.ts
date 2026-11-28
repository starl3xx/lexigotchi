/**
 * The interface's type, four rules (decisions.md #66, part 4; the design audit's 3G, starl3xx,
 * 2026-11-27: "3C and 3G are g2g"):
 *
 * 1. THREE WEIGHTS. Regular for reading, medium for labels and for emphasis inside a sentence,
 *    extra bold for headings and buttons only.
 * 2. ONE GREY. Secondary text is ink at 70% (6.0 : 1 on paper). The game used ten strengths, and
 *    the two most used failed the 4.5 : 1 its own palette asks of small text.
 * 3. A 12 PX FLOOR for running text. Chips, tags, and compact figures may go under it.
 * 4. NO DECORATIVE CAPITALS. Capitals mean a raised letter in this game.
 *
 * Not the interface, and so not swept: what is on a letter (the rig, the flat tiles), a card's
 * own lettering, the pictures the server draws, and the operator console.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import config from "../tailwind.config";
import { contrast, mixHex, READS } from "@/lib/contrast";

const SKIP = [
  /components\/admin\//, // the operator console
  /app\/admin\//,
  /app\/_og\//, // the server's pictures
  /app\/s\/\[text\]\/(card|back|loop)/,
  /app\/e\/\[token\]\/card/,
  /app\/(embed-image|icon-image)/,
  /TileCharacter\.tsx$/, // on the letter
  /TileFinish\.tsx$/,
  /MiniTiles\.tsx$/,
  /tileShapes\.ts$/,
  /scenes\/SceneFrame\.tsx$/, // the card
  /brand\//,
  /app\/tile-lab\//, // a workbench for the letter rig, not a screen of the game
];
function files(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name).replaceAll("\\", "/");
    if (statSync(path).isDirectory()) files(path, out);
    else if (/\.tsx?$/.test(name) && !SKIP.some((r) => r.test(path))) out.push(path);
  }
  return out;
}
const FILES = [...files("src/components"), ...files("src/app")];
const all = (re: RegExp) => FILES.flatMap((f) => [...readFileSync(f, "utf8").matchAll(re)].map((m) => `${f}: ${m[0]}`));
const css = readFileSync("src/app/globals.css", "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

describe("1. three weights", () => {
  it("no screen asks for a weight between or beyond them", () => {
    expect(all(/\bfont-(thin|extralight|light|semibold|bold|black)\b/g)).toEqual([]);
    // an arbitrary weight would dodge the rule
    expect(all(/\bfont-\[\d+\]/g)).toEqual([]);
  });

  it("emphasis inside a sentence is medium: `strong` and `b` are 500, never the browser's \"bolder\"", () => {
    expect(css).toMatch(/\nb,\s*strong \{\s*font-weight: 500;\s*\}/);
    // and no strong carries a heavier class of its own
    expect(all(/<(strong|b)\b[^>]*\bfont-extrabold\b[^>]*>/g)).toEqual([]);
  });

  it("that rule stops at the interface: the operator console and every card's own lettering keep their weights", () => {
    // the console is wrapped and named, and keeps the browser's own bold
    expect(readFileSync("src/app/admin/layout.tsx", "utf8")).toContain('<div className="operator contents">{children}</div>');
    expect(css).toMatch(/\.operator b,\s*\.operator strong \{\s*font-weight: bolder;\s*\}/);
    // Every bold element a card or its case letters has a weight of its OWN in the styles. Left to
    // the base rule, the case's label went from 700 to 500 with nobody choosing it.
    const cardBolds: Record<string, string[]> = { "src/components/cards/CardBack.tsx": [".cb-oneof b", ".cb-foot b"], "src/components/cards/CardCase.tsx": [".cc-small b"] };
    for (const [file, rules] of Object.entries(cardBolds)) {
      const src = readFileSync(file, "utf8");
      expect(src, file).toMatch(/<b>/);
      for (const sel of rules) expect(css, sel).toMatch(new RegExp(`${sel.replace(".", "\\.")} \\{[^}]*font-weight: \\d+`));
    }
    expect(css).toMatch(/\.cc-small b \{\s*font-weight: 700;\s*\}/);
    // and no other card component letters a bold of its own without one
    for (const f of readdirSync("src/components/cards")) {
      if (!/\.tsx?$/.test(f) || Object.keys(cardBolds).some((k) => k.endsWith(f))) continue;
      expect(readFileSync(join("src/components/cards", f), "utf8"), f).not.toMatch(/<(b|strong)[\s>]/);
    }
  });

  it("the stylesheet's own interface text keeps to them (a card's lettering and a letter set their own)", () => {
    // every rule that sets a weight, but for the faces themselves, the card (cb-, cc-, cf-), and the letter (mini-tile, need-letter, lk-slot, tc-)
    const own = /^(\.cb-|\.cc-|\.cf-|\.mini-tile|\.need-letter|\.lk-slot|\.tc-|\.fig|\.fact|\.tm-val|\.mail-serif|@font-face)/;
    for (const m of css.matchAll(/(?:^|\n)([^{}\n]+)\{([^{}]*font-weight:\s*(\d+)[^{}]*)\}/g)) {
      const selector = m[1].trim();
      if (own.test(selector)) continue;
      expect(["400", "500", "800"], `${selector} sets ${m[3]}`).toContain(m[3]);
    }
  });
});

describe("2. one grey", () => {
  it("secondary text is ink at 70%, which reads on the page, on a card, and on every tint", () => {
    type Palette = Record<string, string | Record<string, string>>;
    const colors = config.theme!.extend!.colors as Palette;
    const ink = colors.ink as string;
    const grounds = [(colors.paper as Record<string, string>).DEFAULT, colors.card as string, ...Object.values(colors.wash as Record<string, string>)];
    for (const ground of grounds) expect(contrast(mixHex(ground, ink, 0.7), ground), ground).toBeGreaterThanOrEqual(READS);
    // the two strengths it replaced did not, on the page: 55% (86 uses) and 60% (172 uses)
    const page = grounds[0];
    expect(contrast(mixHex(page, ink, 0.55), page)).toBeLessThan(READS);
    expect(contrast(mixHex(page, ink, 0.6), page)).toBeLessThan(READS);
  });

  it("text is never another strength of ink: 70% for text, and 40% only for what is not text", () => {
    const strengths = new Set(all(/(?<![\w-])text-ink\/\d+\b/g).map((s) => s.split(": ")[1]));
    expect([...strengths].sort()).toEqual(["text-ink/40", "text-ink/70"]);
    // 40% is for an icon, a mark not yet earned, a placeholder, a disabled control, and a list's bullet: never a sentence
    for (const f of FILES) {
      const src = readFileSync(f, "utf8");
      for (const m of src.matchAll(/(?<![\w:-])text-ink\/40\b/g)) {
        const open = src.lastIndexOf("<", m.index);
        const tag = /^<([A-Za-z][\w.]*)/.exec(src.slice(open))?.[1] ?? "";
        const selfClosing = /^[^<]*\/>/.test(src.slice(m.index));
        const line = src.slice(src.lastIndexOf("\n", m.index) + 1, src.indexOf("\n", m.index)).trim();
        expect(/^[A-Z]/.test(tag) && selfClosing, `${f}: 40% ink on something that is not an icon: ${line.slice(0, 120)}`).toBe(true);
      }
    }
    // on a dark ground, the same: paper at 70%
    expect([...new Set(all(/(?<![\w-])text-paper\/\d+\b/g).map((s) => s.split(": ")[1]))]).toEqual(["text-paper/70"]);
  });
});

describe("3. a 12 px floor for running text", () => {
  it("only a chip, a tag, a compact figure, and the envelope's own lettering go under 12 px", () => {
    const small = all(/text-\[(?:9|10|11)px\]/g).map((s) => s.split(": ")[0]);
    const count = (file: string) => small.filter((f) => f.endsWith(file)).length;
    // each of these is a chip, a tag, or a compact figure: its file, and how many
    const ALLOWED: Record<string, number> = {
      "game/PlayerChip.tsx": 1, // the "you" chip
      "game/GameApp.tsx": 3, // the header's streak chip, its test chip, and the balance's second line
      "game/sheets/WalletsCard.tsx": 1, // the "Game wallet" chip
      "game/sheets/MailSheet.tsx": 2, // the envelope's own lettering, and a letter's tag
      "game/market/LettersBoard.tsx": 3, // the shelf: a count badge, the lowest price, how many
    };
    for (const [file, n] of Object.entries(ALLOWED)) expect(count(file), file).toBe(n);
    expect(small.length).toBe(Object.values(ALLOWED).reduce((a, b) => a + b, 0));
  });
});

describe("4. no decorative capitals", () => {
  it("no label is set in capitals: the one `uppercase` is the Market's word search, which shows a word as the game writes it", () => {
    // the class, in a class list (the word is also in plenty of comments about raised letters)
    const inClassList = /["`][^"`\n]*\b(?:text|font|px|py|rounded|tracking|border)-[^"`\n]*?(?<![\w:-])uppercase(?![\w-])|["`\s]uppercase(?![\w-])[^"`\n]*\b(?:text|font|px|py|rounded|tracking|border)-[^"`\n]*["`]/g;
    expect(all(inClassList).map((s) => s.split(": ")[0])).toEqual(["src/components/game/market/WordsBoard.tsx"]);
    // letter-spacing was the capitals' companion
    expect(all(/\btracking-(wider|widest)\b/g)).toEqual([]);
  });
});

describe("a letter is always Söhne", () => {
  it("a tile drawn as plain text names its face, so it never inherits the card's serif from a figure around it", () => {
    expect(css).toContain(".mini-tile, .need-letter, .lk-slot { font-family: var(--font-body); }");
  });
});
