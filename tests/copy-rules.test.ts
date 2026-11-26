/**
 * The house copy rules, enforced on every string a player can see: no em dashes (use the mark the
 * sentence needs: a colon, a comma, a period, or brackets), curly apostrophes, and "onchain" as one
 * word. The scan reads the TypeScript syntax tree, so code comments, class names, imports, and other
 * code positions are skipped; JSX text, titles, aria-labels, toasts, and notification copy are not.
 *
 * A lone placeholder for a missing value uses an en dash ("–"), never an em dash.
 *
 * The second half is the messaging guide's word list (docs/messaging.md, decisions.md #24): the
 * never-write words and the "Instead of" terms, over a wider set of player-facing files and the player
 * docs. An exception goes in VOCAB_ALLOW with its reason, never by loosening a pattern.
 */
import { describe, it, expect } from "vitest";
import ts from "typescript";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOTS = ["src/components/game", "src/components/cards", "src/lib/cardFacts.ts", "src/components/landing", "src/components/scenes", "src/lib/scenes.ts", "src/lib/howItWorks.ts", "src/lib/notify/templates.ts", "src/lib/market/deals.ts", "src/lib/earningsShare.ts", "src/lib/notify/kinds.ts"];
const CODE_ATTR = /^(className|href|src|key|id|type|d|viewBox|fill|stroke|style|rel|target|role|method|name|htmlFor|transform|points|xmlns|preserveAspectRatio|mode|as|lang|dir|inputMode|autoComplete)$/;

function files(p: string): string[] {
  if (statSync(p).isDirectory()) return readdirSync(p).flatMap((f) => files(join(p, f)));
  return /\.tsx?$/.test(p) && !/\.test\./.test(p) ? [p] : [];
}

/**
 * Every rendered string in the player-facing UI, with where it lives. `jsx` marks JSX text, which is
 * always prose; a string literal can also be a code value (an enum member, a key), which the word
 * check tells apart by its shape.
 */
function renderedStrings(roots: readonly string[] = ROOTS): { where: string; text: string; jsx: boolean }[] {
  const out: { where: string; text: string; jsx: boolean }[] = [];
  for (const f of roots.flatMap(files)) {
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
      if (text?.trim()) out.push({ where: `${f}:${sf.getLineAndCharacterOfPosition(n.getStart()).line + 1}`, text, jsx: ts.isJsxText(n) });
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

// ---------------------------------------------------------------------------
// The messaging guide's words (docs/messaging.md, decisions.md #24)
// ---------------------------------------------------------------------------

/**
 * Words player-facing copy never uses: the guide's never-write list and its "Instead of" terms. The
 * Tamagotchi and Pokémon comparison stays internal (both are guarded trademarks). "Yield" is the
 * contracts' and the operators' word; a player reads "earns $WORD every day".
 */
const BANNED: readonly { term: string; re: RegExp; sample: string; everywhere?: boolean }[] = [
  { term: "lottery", re: /\blotter(y|ies)\b/i, sample: "It’s a daily lottery." },
  { term: "invest", re: /\binvest(s|ed|ing|ment|ments|or|ors)?\b/i, sample: "A smart investment." },
  { term: "NFT", re: /\bNFTs?\b/i, sample: "Your letters lock inside a Word NFT." },
  { term: "APR", re: /\bAPR\b/, sample: "Up to 40% APR." },
  { term: "APY", re: /\bAPY\b/, sample: "A 12% APY." },
  { term: "passive income", re: /\bpassive income\b/i, sample: "Earn passive income." },
  { term: "yield", re: /\byield(s|ed|ing)?\b/i, sample: "A peckish word earns half its yield." },
  { term: "pump", re: /\bpump(s|ed|ing)?\b/i, sample: "Watch $WORD pump." },
  { term: "moon", re: /\bmoon(s|ing)?\b/i, sample: "To the moon." },
  // Never a code value either, so these are checked in every string, single words included: the
  // manifest's discovery tag "tamagotchi" was one (decisions.md #24).
  { term: "Lexidex", re: /\blexidex\b/i, sample: "Fill your Lexidex.", everywhere: true },
  { term: "Tamagotchi", re: /tamagotchi/i, sample: "A tamagotchi-style game.", everywhere: true },
  { term: "Pokémon", re: /pok[eé]mon/i, sample: "Like Pokemon, but letters.", everywhere: true },
  { term: "Pokédex", re: /pok[eé]dex/i, sample: "Complete your Pokédex.", everywhere: true },
  // A character of theirs is the same comparison: the Mint tab's old odds card ended on this one.
  { term: "Charizard", re: /charizard/i, sample: "Q is the Charizard.", everywhere: true },
];

/** Player-facing code: wider than the copy-rule roots, because a description or a reminder is copy too. */
const VOCAB_ROOTS = [
  "src/components",
  "src/app",
  "src/lib/howItWorks.ts",
  "src/lib/notify",
  "src/lib/site.ts",
  "src/lib/showcase.ts",
  "src/lib/scenes.ts",
  "src/lib/themes.ts",
  "src/lib/telegram.ts",
  "src/lib/ascension.ts",
  "src/lib/market/deals.ts", // the sell forms' price ideas and the comparisons
  "src/lib/earningsShare.ts", // the earnings share card's words and the post's
];

/** Docs pages that keep their technical terms (the guide: token standards belong there). */
const DOCS_TECHNICAL = new Set(["docs-site/contracts.mdx", "docs-site/fairness.mdx"]);

/**
 * The exceptions, each with its reason. `where` is a path prefix: a folder, a file, or a file and
 * line ("src/x.tsx:12"). Keep it small: a new entry needs a reason a reviewer would accept.
 */
const VOCAB_ALLOW: readonly { where: string; term: string; reason: string }[] = [
  {
    where: "src/components/admin/",
    term: "yield",
    reason: "the operator console, not player-facing: operators read the contracts' own word (the Broadcast tab, whose text is posted, is not excused)",
  },
];
const allowed = (where: string, term: string) =>
  VOCAB_ALLOW.some((a) => a.term === term && where.startsWith(a.where) && !where.startsWith("src/components/admin/tabs/BroadcastTab.tsx"));

/** A string literal shaped like a code value (an enum member, a key, a path), not prose. */
const CODE_VALUE = /^[a-z0-9_:./#?=&-]*$/;

describe("the messaging guide's words", () => {
  it.each(BANNED)("the pattern for $term catches it", ({ re, sample }) => expect(re.test(sample)).toBe(true));
  it("every exception names a banned term and a reason", () => {
    for (const a of VOCAB_ALLOW) {
      expect(BANNED.map((b) => b.term)).toContain(a.term);
      expect(a.reason.length).toBeGreaterThan(20);
    }
  });

  const every = renderedStrings(VOCAB_ROOTS);
  const strings = every.filter((s) => s.jsx || !CODE_VALUE.test(s.text.trim()));
  const prose = new Set(strings);
  it("finds the strings it is meant to check", () => expect(strings.length).toBeGreaterThan(1000));

  it("player-facing code never uses them", () => {
    const hits = every.flatMap((s) =>
      BANNED.filter((b) => (b.everywhere || prose.has(s)) && b.re.test(s.text) && !allowed(s.where, b.term)).map(
        (b) => `${s.where} (${b.term}): ${s.text.trim().slice(0, 80)}`,
      ),
    );
    expect(hits).toEqual([]);
  });

  it("the player docs never use them (contracts and fairness keep their technical terms)", () => {
    const hits = docsProse()
      .filter((p) => !DOCS_TECHNICAL.has(p.where))
      .flatMap((p) =>
        p.text.split("\n").flatMap((line, i) =>
          BANNED.filter((b) => b.re.test(line) && !allowed(`${p.where}:${i + 1}`, b.term)).map((b) => `${p.where}:${i + 1} (${b.term})`),
        ),
      );
    expect(hits).toEqual([]);
  });
});
