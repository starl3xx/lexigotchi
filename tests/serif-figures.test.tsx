// @vitest-environment jsdom
/**
 * Figures and facts are in the card's serif; everything else is Söhne (decisions.md #66, part 3;
 * the design audit's 3C, starl3xx, 2026-11-27: "3C and 3G are g2g"). And his own rule, which this
 * builds: STATUS IS NEVER BOLD.
 *
 * The serif in the interface is two classes (globals.css): `.fig`, a figure that stands as a
 * value, bold as the card's back sets its number; and `.fact`, a fact in words or a quiet value
 * in a ledger, regular. Neither ever letters a word or a letter of the game, or a name.
 */
import { describe, it, expect, afterEach } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { StatusMarks } from "@/components/game/StatusMarks";
import { stageMarks } from "@/components/game/stageMarks";

afterEach(cleanup);

const css = readFileSync("src/app/globals.css", "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const rule = (sel: string) => new RegExp(`(?:^|\\n)${sel.replace(/[.*+?^$(){}|[\]\\>]/g, "\\$&")} \\{([^}]*)\\}`).exec(css)?.[1] ?? "";

function files(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (path === join("src", "components", "admin") || path === join("src", "app", "admin")) continue;
      files(path, out);
    } else if (/\.tsx$/.test(name)) out.push(path);
  }
  return out;
}
const FILES = [...files(join("src", "components")), ...files(join("src", "app"))];
/** Every class list in a file that asks for the serif, with the rest of its line. */
function serifLines(): { file: string; line: string; classes: string }[] {
  const out: { file: string; line: string; classes: string }[] = [];
  for (const file of FILES) {
    for (const line of readFileSync(file, "utf8").split("\n")) {
      for (const m of line.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\}|\{([^}]*)\})/g)) {
        // a class list written as an expression (a choice of two lists) is read list by list
        const lists = m[1] !== undefined || m[2] !== undefined ? [m[1] ?? m[2]] : [...(m[3] ?? "").matchAll(/"([^"]*)"|'([^']*)'|`([^`]*)`/g)].map((q) => q[1] ?? q[2] ?? q[3]);
        for (const classes of lists) if (/(^|\s)(fig|fact)(?=$|\s)/.test(classes)) out.push({ file: file.replaceAll("\\", "/"), line: line.trim(), classes });
      }
    }
  }
  return out;
}

describe("the serif's two voices", () => {
  it("a figure is bold and a fact is regular, both in the card's serif, with figures all one width", () => {
    const fig = rule(".fig");
    const fact = rule(".fact");
    for (const r of [fig, fact]) {
      expect(r).toContain("font-family: var(--font-card);");
      expect(r).toContain("font-variant-numeric: lining-nums tabular-nums;");
    }
    expect(fig).toContain("font-weight: 700;");
    expect(fact).toContain("font-weight: 400;");
  });

  it("the weight is the class's own: a figure or a fact never carries a weight or a face of its own", () => {
    const lines = serifLines();
    expect(lines.length).toBeGreaterThan(30);
    for (const { file, classes } of lines) expect(classes, file).not.toMatch(/\bfont-(thin|light|normal|medium|semibold|bold|extrabold|black|display|body)\b/);
  });

  it("never a word, a letter, or a name: the serif is asked for by what the value IS", () => {
    // what a serif element holds, read from its line: none of these is a word of the game, a letter, or a player
    for (const { file, line } of serifLines()) {
      const held = /className=[^>]*>(.*)$/.exec(line)?.[1] ?? "";
      expect(held, `${file}: ${line}`).not.toMatch(/\{[^}]*\b(word|w|letter|char|name|theme|label)\b\s*\}|\.word\b|\.letter\b|\.name\b|<PlayerChip|<WordTiles|<MiniTiles|<LetterTile/);
    }
  });

  it("a shared value slot stays Söhne where it can hold a word or a name", () => {
    // Let's Have A Word!: last round's WORD stands in the same place as the pot's figure
    const lhaw = readFileSync("src/components/game/screens/LhawScreen.tsx", "utf8");
    expect(lhaw).toMatch(/<Stat label=\{`Round \$\{d\.last\.round\}’s word`\} big>\s*\{d\.last\.word\}/);
    expect(lhaw).toContain("<Stat label={`Round ${d.live.round} pot`} big fig>");
    // the $WORD page's ledger: where it trades is a name
    expect(readFileSync("src/components/game/screens/WordScreen.tsx", "utf8")).toContain('["Where it trades", "Uniswap v4 on Base", "name"],');
    // the card's facts: who found it, its set, and its partner are names
    const more = readFileSync("src/components/cards/CardBack.tsx", "utf8");
    expect(more).toContain('<Row label="Found by">{s.found}</Row>');
    expect(more).toContain('{f.set && <Row label="Set">{f.set}</Row>}');
    expect(more).toContain('{f.collab && <Row label="Collab">{collabLine(f.collab)}</Row>}');
    expect(more).toContain('<Row label="Points" fact>{f.points}</Row>');
    // a word's ledger: its owner, its set, and the bounty's theme (a theme may name a letter: "Ends in Y")
    const look = readFileSync("src/components/game/sheets/LookupSheet.tsx", "utf8");
    expect(look).toContain('<Fact label="Owner">');
    expect(look).toContain('{ahead && <Fact label="Set">{ahead.name}</Fact>}');
    expect(look).toContain('<Fact label="Fits this week’s bounty">{theme.name}</Fact>');
    // and the bounty's theme is Söhne wherever it stands
    expect(readFileSync("src/components/game/screens/BountySection.tsx", "utf8")).toContain('<div className="font-display text-xl font-extrabold">{theme.name}</div>');
  });

  it("a button, a tab, and a chip keep Söhne: no figure class inside the game's Button", () => {
    for (const file of FILES) {
      const src = readFileSync(file, "utf8");
      for (const m of src.matchAll(/<Button\b[^>]*>([\s\S]*?)<\/Button>/g)) expect(m[1], file).not.toMatch(/className="[^"]*\b(fig|fact)\b/);
    }
  });
});

describe("status is never bold", () => {
  const marks = stageMarks({ mood: "hungry", raised: 5, of: 5, daysUnfed: 3 });

  it("a status value is a fact: the card's serif, regular, at the size the owner saw", () => {
    const val = rule(".tm-val");
    expect(val).toContain("font-family: var(--font-card);");
    expect(val).toContain("font-weight: 400;");
    expect(val).toContain("font-size: 13.5px;");
    // the mark's own name is the label: Söhne, medium
    expect(rule(".tm-mark small")).toContain("font-weight: 500;");
    // nothing about a mark is heavier than that
    for (const m of css.matchAll(/\.tm[\w-]*[^{}]*\{([^}]*)\}/g)) expect(m[1]).not.toMatch(/font-weight: (6|7|8|9)00/);
  });

  it("the value is not a bold element, and carries no weight class", () => {
    const { container } = render(<StatusMarks marks={marks} />);
    expect(container.querySelector("b, strong")).toBeNull();
    const vals = [...container.querySelectorAll(".tm-val")];
    expect(vals.map((v) => v.textContent)).toEqual(["Asleep, day 3", "Out while asleep", "Nothing while asleep"]);
    for (const v of vals) expect(v.className).toBe("tm-val");
    expect(css).not.toMatch(/\.tm-mark b\b/);
  });

  it("no status value ever names the word or a letter, so the serif never letters one", () => {
    const moods = ["full", "peckish", "hungry", "forSale", "unstaked"] as const;
    for (const mood of moods) {
      for (const raised of [0, 3, 5]) {
        for (const m of stageMarks({ mood, raised, of: 5, daysUnfed: 2, earned: { amount: "40.2K", when: "today" } })) {
          // no five-letter word in capitals, and no single letter standing alone
          expect(m.value, m.value).not.toMatch(/\b[A-Z]{5}\b/);
          expect(m.value, m.value).not.toMatch(/(^|\s)[A-Za-z](\s|$)/);
        }
      }
    }
  });
});
