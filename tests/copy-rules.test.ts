/**
 * The house copy rules, enforced on every string a player can see: no em dashes (use the mark the
 * sentence needs: a colon, a comma, a period, or brackets), curly apostrophes, and "onchain" as one
 * word. The scan reads the TypeScript syntax tree, so code comments, class names, imports, and other
 * code positions are skipped; JSX text, titles, aria-labels, toasts, and notification copy are not.
 *
 * A lone placeholder for a missing value uses an en dash ("–"), never an em dash.
 */
import { describe, it, expect } from "vitest";
import ts from "typescript";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOTS = ["src/components/game", "src/components/landing", "src/components/scenes", "src/lib/scenes.ts", "src/lib/howItWorks.ts", "src/lib/notify/templates.ts"];
const CODE_ATTR = /^(className|href|src|key|id|type|d|viewBox|fill|stroke|style|rel|target|role|method|name|htmlFor|transform|points|xmlns|preserveAspectRatio|mode|as|lang|dir|inputMode|autoComplete)$/;

function files(p: string): string[] {
  if (statSync(p).isDirectory()) return readdirSync(p).flatMap((f) => files(join(p, f)));
  return /\.tsx?$/.test(p) && !/\.test\./.test(p) ? [p] : [];
}

/** Every rendered string in the player-facing UI, with where it lives. */
function renderedStrings(): { where: string; text: string }[] {
  const out: { where: string; text: string }[] = [];
  for (const f of ROOTS.flatMap(files)) {
    const src = readFileSync(f, "utf8");
    const sf = ts.createSourceFile(f, src, ts.ScriptTarget.Latest, true, f.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const visit = (n: ts.Node) => {
      const p = n.parent;
      let text: string | null = null;
      if (ts.isJsxText(n)) text = n.getText();
      else if (
        ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) ||
        ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n)
      ) {
        const code =
          (p && (ts.isImportDeclaration(p) || ts.isExportDeclaration(p) || ts.isLiteralTypeNode(p) || ts.isCaseClause(p) || ts.isElementAccessExpression(p))) ||
          (p && ts.isJsxAttribute(p) && CODE_ATTR.test(p.name.getText())) ||
          (p && ts.isPropertyAssignment(p) && p.name === n);
        if (!code) text = n.text;
      }
      if (text?.trim()) out.push({ where: `${f}:${sf.getLineAndCharacterOfPosition(n.getStart()).line + 1}`, text });
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  return out;
}

/** The player docs (docs-site/, served at lexigotchi.fun/docs by Mintlify): every page's prose, with
 *  fenced and inline code taken out. */
function docsProse(): { where: string; text: string }[] {
  return readdirSync("docs-site")
    .filter((f) => f.endsWith(".mdx"))
    .map((f) => ({
      where: `docs-site/${f}`,
      text: readFileSync(join("docs-site", f), "utf8").replace(/```[\s\S]*?```/g, "").replace(/`[^`]*`/g, ""),
    }));
}

describe("player docs", () => {
  const pages = docsProse();
  it("finds the pages", () => expect(pages.length).toBeGreaterThan(5));
  it("have no em dashes", () => expect(pages.filter((p) => /—|&mdash;|&#8212;/.test(p.text)).map((p) => p.where)).toEqual([]));
  it("use curly apostrophes", () => expect(pages.filter((p) => /[A-Za-z]'[A-Za-z]/.test(p.text)).map((p) => p.where)).toEqual([]));
  it("spell onchain as one word", () => expect(pages.filter((p) => /\bon-chain\b/i.test(p.text)).map((p) => p.where)).toEqual([]));
  // Mintlify reads text between two dollar signs as LaTeX math: "paid in $WORD. As the price of $WORD"
  // rendered as an italic equation on 7 live pages. A backslash keeps a dollar sign literal in body
  // text; in frontmatter and tag attributes it would show as a backslash, so those stay bare.
  const FRONTMATTER = /^---\n[\s\S]*?\n---\n/;
  const TAG = /<\/?[A-Za-z][^>]*>/g;
  it("escape every dollar sign in body text, so Mintlify never sets it as math", () => {
    const bare = pages.filter((p) => /(?<!\\)\$/.test(p.text.replace(FRONTMATTER, "").replace(TAG, "")));
    expect(bare.map((p) => p.where)).toEqual([]);
  });
  it("leave dollar signs bare in frontmatter and tag attributes", () => {
    const escaped = pages.filter((p) => /\\\$/.test((p.text.match(FRONTMATTER)?.[0] ?? "") + (p.text.match(TAG) ?? []).join(" ")));
    expect(escaped.map((p) => p.where)).toEqual([]);
  });
});

describe("player-facing copy", () => {
  const strings = renderedStrings();

  it("finds the strings it is meant to check", () => {
    expect(strings.length).toBeGreaterThan(500);
  });

  it("has no em dashes", () => {
    expect(strings.filter((s) => /—|&mdash;|&#8212;/.test(s.text)).map((s) => s.where)).toEqual([]);
  });

  it("uses curly apostrophes", () => {
    expect(strings.filter((s) => /[A-Za-z]'[A-Za-z]|&apos;/.test(s.text)).map((s) => s.where)).toEqual([]);
  });

  it("spells onchain as one word", () => {
    expect(strings.filter((s) => /\bon-chain\b/i.test(s.text)).map((s) => s.where)).toEqual([]);
  });
});
