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

const ROOTS = ["src/components/game", "src/components/landing", "src/lib/howItWorks.ts", "src/lib/notify/templates.ts"];
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
